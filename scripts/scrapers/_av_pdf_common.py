#!/usr/bin/env python3
"""
_av_pdf_common.py — Socle partagé des scrapers de catalogue AV par annexe PDF
=============================================================================
Les assureurs français de bancassurance (CNP, Predica/CA, Abeille, Groupama/Gan,
MACSF, MAAF…) publient la liste des supports en unités de compte de chaque
contrat dans une « annexe financière » PDF publique (obligation L.522-5). Le
schéma de collecte est identique pour tous :

    1. Découvrir les couples (contrat, URL PDF) — spécifique à chaque assureur.
    2. Pour chaque PDF : télécharger (curl_cffi, TLS-impersonation) → pdftotext
       → extraire les ISIN.
    3. Ne garder que les ISIN DÉJÀ présents dans investissement_funds
       (ÉLIGIBILITÉ-ONLY : on n'insère jamais de fonds, zéro écrasement).
    4. Dédupliquer (isin, contract_name) puis upsert dans
       investissement_av_lux_eligibility (scraped_at=now() → protège du
       délistage Tier 4).

Ce module factorise 2→4 ; chaque scraper av-fr-<assureur>-catalog.py ne fournit
que l'étape 1 (sa fonction de découverte) et appelle run_eligibility().

DRY-RUN (sans --apply) : ne touche PAS la DB (get_client n'est jamais appelé) —
valide uniquement le fetch+parse en affichant le nb d'ISIN par contrat. Le filtre
« en base » et l'écriture n'ont lieu qu'en mode --apply (creds réels = CI).
"""

import os
import re
import sys
import time
import tempfile
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as cffi_requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run, upsert_funds_bulk  # noqa: E402

# ISIN = 2 lettres pays + 9 alphanum + 1 chiffre de contrôle.
ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")

DEFAULT_TIMEOUT = 45  # secondes — TOUJOURS borné (anti-hang, cf. incident quantalys)
RATE_LIMIT = 0.3      # pause entre 2 PDF (politesse)


def _proxies(use_proxy: bool) -> dict | None:
    """Dict de proxy si `use_proxy` ET la variable d'env AV_PROXY_URL est posée.

    Sert à router CERTAINS scrapers (hôtes assureurs FR qui bloquent les IP
    datacenter de GitHub Actions : maaf.fr, abeille, mma/gmf, quantalys…) via un
    proxy résidentiel. DORMANT par défaut : sans AV_PROXY_URL, renvoie None →
    connexion directe (zéro changement). Cf. docs/av-referencing.md §Proxy.
    Format AV_PROXY_URL : http://user:pass@host:port (ou socks5h://…).
    """
    if not use_proxy:
        return None
    url = os.environ.get("AV_PROXY_URL", "").strip()
    if not url:
        return None
    return {"http": url, "https": url}


def make_session(use_proxy: bool = False) -> "cffi_requests.Session":
    """Session curl_cffi impersonant Chrome (passe les murs TLS/anti-bot légers).

    use_proxy=True + AV_PROXY_URL posée → route via le proxy résidentiel (pour les
    hôtes qui bloquent les IP datacenter CI). Sinon connexion directe.
    """
    proxies = _proxies(use_proxy)
    if proxies:
        print("      ↻ proxy résidentiel actif (AV_PROXY_URL)")
        return cffi_requests.Session(impersonate="chrome", proxies=proxies)
    return cffi_requests.Session(impersonate="chrome")


def fetch_pdf_text(session, url: str, timeout: int = DEFAULT_TIMEOUT) -> str | None:
    """Télécharge un PDF et retourne son texte (`pdftotext -layout`).

    Retourne None si HTTP != 200, contenu non-PDF, ou pdftotext indisponible.
    Suit les redirections (certains assureurs servent /abdoc/<code> → .pdf).
    """
    try:
        r = session.get(url, timeout=timeout, allow_redirects=True)
    except Exception as e:
        print(f"      ⚠ fetch {url[:70]} : {str(e)[:60]}")
        return None
    if r.status_code != 200:
        print(f"      ⚠ HTTP {r.status_code} sur {url[:70]}")
        return None
    content = r.content
    if content[:4] != b"%PDF":
        print(f"      ⚠ non-PDF (signature {content[:4]!r}) sur {url[:70]}")
        return None

    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    try:
        tmp.write(content)
        tmp.close()
        out = subprocess.run(
            ["pdftotext", "-layout", tmp.name, "-"],
            capture_output=True, text=True, timeout=90,
        )
        if out.returncode != 0:
            print(f"      ⚠ pdftotext rc={out.returncode} : {out.stderr[:80]}")
            return None
        return out.stdout
    except FileNotFoundError:
        print("      ✗ pdftotext absent (apt-get install poppler-utils / brew install poppler)")
        return None
    except subprocess.TimeoutExpired:
        print(f"      ⚠ pdftotext timeout sur {url[:70]}")
        return None
    finally:
        Path(tmp.name).unlink(missing_ok=True)


def extract_isins(text: str) -> list[str]:
    """ISIN distincts trouvés dans le texte d'un PDF (ordre stable trié)."""
    return sorted(set(ISIN_RE.findall(text or "")))


_MULTISPACE = re.compile(r"\s{2,}")


def extract_isin_names(text: str) -> dict[str, str]:
    """Appariement best-effort ISIN → nom : le nom est le texte qui PRÉCÈDE l'ISIN
    sur la même ligne (mise en page `pdftotext -layout`). Retourne {isin: name} ;
    name = "" quand aucun libellé fiable n'est extractible (on ne sèmera alors pas
    de coquille anonyme). 1re occurrence (1er nom non vide) conservée."""
    out: dict[str, str] = {}
    for line in (text or "").splitlines():
        for m in ISIN_RE.finditer(line):
            isin = m.group(1)
            if out.get(isin):
                continue
            name = line[:m.start()].strip(" .\t|·–—-")
            name = _MULTISPACE.sub(" ", name).strip()
            # Nom plausible : ≥ 4 caractères dont ≥ 3 lettres consécutives (écarte
            # les colonnes purement numériques / codes voisins).
            if len(name) < 4 or not re.search(r"[A-Za-zÀ-ÿ]{3}", name):
                name = ""
            out.setdefault(isin, name[:180])
    return out


def _seed_product_type(name: str) -> str:
    u = (name or "").upper()
    if "UCITS ETF" in u or " ETF" in u or u.startswith("ETF"):
        return "etf"
    if "OPCI" in u:
        return "opci"
    if "SCPI" in u:
        return "scpi"
    return "opcvm"


def existing_isins(client) -> set[str]:
    """Ensemble des ISIN déjà présents dans investissement_funds (paginé)."""
    s, off = set(), 0
    while True:
        rows = (
            client.table("investissement_funds")
            .select("isin")
            .range(off, off + 999)
            .execute()
            .data
        )
        if not rows:
            break
        s.update(r["isin"] for r in rows)
        if len(rows) < 1000:
            break
        off += 1000
    return s


def run_eligibility(
    company: str,
    contracts: list[dict],
    *,
    scraper_name: str,
    apply: bool,
    limit: int | None = None,
    use_proxy: bool = False,
    seed_missing: bool = False,
) -> None:
    """Pipeline commun étapes 2→4.

    Args:
        company: nom assureur autoritaire (ex. "CNP Assurances"). Un nom = un
                 assureur dans la liste UI — pas de variantes/doublons d'accent.
        contracts: liste de dicts {contract: str, pdf_url: str, source_url: str?}.
                   source_url par défaut = pdf_url.
        scraper_name: identifiant pour log_run (ex. "av-fr-cnp-catalog").
        apply: True → écrit en base ; False → dry-run (fetch+parse seulement).
        limit: optionnel, ne traiter que les N premiers contrats (debug).
    """
    started = datetime.now(timezone.utc)
    print("=" * 64)
    print(f"  {company} — catalogue UC (annexes PDF)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'} | {len(contracts)} contrat(s)")
    print("=" * 64)

    if limit:
        contracts = contracts[:limit]

    known: set[str] | None = None
    client = None
    if apply:
        client = get_client()
        known = existing_isins(client)
        print(f"  ISIN en base : {len(known)}")

    session = make_session(use_proxy=use_proxy)
    now = datetime.now(timezone.utc).isoformat()

    # 1re passe : ISIN cités (+ nom best-effort) de chaque contrat.
    per_contract: list[tuple[str, str, list[str]]] = []   # (name, src_url, cited)
    all_pairs: dict[str, str] = {}                          # isin -> nom
    for i, c in enumerate(contracts):
        name = c["contract"]
        pdf_url = c["pdf_url"]
        src_url = c.get("source_url") or pdf_url
        text = fetch_pdf_text(session, pdf_url)
        pairs = extract_isin_names(text) if text else {}
        for isin, nm in pairs.items():
            if not all_pairs.get(isin):
                all_pairs[isin] = nm
        cited = sorted(pairs)
        per_contract.append((name, src_url, cited))
        print(f"  [{i+1}/{len(contracts)}] {name[:42]:42} {len(cited):4} ISIN cités")
        time.sleep(RATE_LIMIT)

    # Seed opt-in : INSÈRE au catalogue les fonds cités ABSENTS (hors `known` →
    # jamais d'écrasement d'un fonds existant), avec un nom fiable, pour les rendre
    # référençables + enrichissables (NAV/perf ensuite par le pipeline).
    seeded = 0
    if apply and seed_missing:
        seed_rows = [
            {"isin": isin, "name": all_pairs[isin],
             "product_type": _seed_product_type(all_pairs[isin]),
             "currency": "EUR", "data_source": f"{scraper_name}-seed"}
            for isin in sorted(all_pairs)
            if isin not in known and all_pairs[isin]
        ]
        if seed_rows:
            s_ok, s_fail = upsert_funds_bulk(seed_rows, batch_size=100)
            known.update(r["isin"] for r in seed_rows)
            seeded = s_ok
            print(f"  Seed catalogue : {s_ok} nouveaux fonds ({s_fail} échec)")

    # Lignes d'éligibilité (filtrées sur le catalogue ; brut en dry-run).
    rows: list[dict] = []
    union: set[str] = set()
    for name, src_url, cited in per_contract:
        kept = [x for x in cited if known is None or x in known]
        union.update(kept)
        for x in kept:
            rows.append({"isin": x, "contract_name": name, "source_url": src_url})

    print(f"\n  Union ISIN distincts : {len(union)} | lignes éligibilité : {len(rows)}")
    if seeded:
        print(f"  (dont {seeded} fonds nouvellement semés au catalogue)")

    if not apply:
        print("  DRY-RUN — rien écrit. Relancer avec --apply (creds réels).")
        return

    # ── Dédup (isin, contract_name) AVANT upsert : un couple répété dans un même
    #    batch casse l'upsert PostgREST (erreur 21000). Cf. av-fr-spirica-catalog.
    seen_keys: set[tuple[str, str]] = set()
    batch: list[dict] = []
    ok = 0
    for row in rows:
        key = (row["isin"], row["contract_name"])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        batch.append({
            "isin": row["isin"],
            "company_name": company,
            "contract_name": row["contract_name"],
            "source_url": row["source_url"],
            "scraped_at": now,
        })
        if len(batch) >= 200:
            _upsert(client, batch)
            ok += len(batch)
            batch = []
    if batch:
        _upsert(client, batch)
        ok += len(batch)

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} fonds distincts).")
    log_run(scraper_name, "success", ok, 0, started_at=started)


def _upsert(client, batch: list[dict]) -> None:
    client.table("investissement_av_lux_eligibility") \
        .upsert(batch, on_conflict="isin,contract_name") \
        .execute()
