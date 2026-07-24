#!/usr/bin/env python3
"""
av-fund-minimums.py — Minimum de souscription PAR (support × contrat)
=====================================================================
Retour CGP : « avoir les minimums investissables par enveloppe » — ex. Eurazeo
Private Value Europe 3 = 1 000 € sur Linxea Spirit 2, 100 € sur Avenir 2, 5 000 €
sur Zen. Le minimum dépend du COUPLE (support, contrat), pas du fonds seul.

Aucun assureur ne publie de grille par ISIN. La source la plus exploitable est le
CATALOGUE DISTRIBUTEUR (Linxea), qui expose, par contrat et par catégorie (Private
Equity, SCPI…), une colonne « Souscription minimum ». Sur une page donnée le
minimum est en pratique UNIFORME par catégorie (tous les FCPR d'un contrat au même
ticket) → on extrait le minimum dominant de la page + la liste des supports (titres
h4), on résout chaque titre vers un ISIN de la base, et on écrit un tuple
(isin, « Compagnie::Contrat », min_investment_eur) dans
investissement_av_fund_envelope_terms (fill-only, confidence='scraped').

La RÉSOLUTION titre→ISIN est le point dur (Linxea nomme « Eurazeo Private Value
Europe 3 » sans préciser la part ; la base peut avoir plusieurs share-classes).
On matche par nom normalisé et on RAPPORTE les non-résolus (à curer à la main).

DRY-RUN par défaut (n'écrit rien). --apply pour écrire.

Usage :
    python3 scripts/scrapers/av-fund-minimums.py                 # dry-run, tous les contrats configurés
    python3 scripts/scrapers/av-fund-minimums.py --only "Linxea Spirit 2"
    python3 scripts/scrapers/av-fund-minimums.py --apply
"""
import re
import ssl
import sys
import argparse
import unicodedata
import urllib.request
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Catalogues distributeurs (contrat → pages catégorie) ────────────────────
# key = « Compagnie::Contrat » EXACTEMENT tel qu'en base (investissement_fund_insurers_mv).
# category = product_type de la base ciblé par la page (résolution du support).
SOURCES = [
    {"key": "Linxea::Linxea Spirit 2", "category": "fcpr",
     "url": "https://www.linxea.com/assurance-vie/linxea-spirit-2/supports-disponibles-sur-linxea-spirit-2/private-equity"},
    {"key": "Linxea::Linxea Avenir 2", "category": "fcpr",
     "url": "https://www.linxea.com/assurance-vie/linxea-avenir-2/supports-disponibles-sur-linxea-avenir-2/private-equity"},
    {"key": "Linxea::Linxea Vie", "category": "fcpr",
     "url": "https://www.linxea.com/assurance-vie/linxea-vie/supports-disponibles-sur-linxea-vie/private-equity"},
    {"key": "Linxea::Linxea Zen", "category": "fcpr",
     "url": "https://www.linxea.com/assurance-vie/linxea-zen/supports-disponibles-sur-linxea-zen/private-equity"},
]

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE  # certifi non garanti hors venv ; pages publiques en lecture seule


def fetch(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        return urllib.request.urlopen(req, timeout=30, context=_SSL).read().decode("utf-8", "replace")
    except Exception as e:
        print(f"    ⚠️  fetch KO {url} : {str(e)[:90]}")
        return None


# ─── Extraction (titres de supports + minimum dominant) ──────────────────────

def parse_page(html: str) -> tuple[list[str], int | None]:
    """
    Renvoie (noms de supports [h4], minimum dominant en €). Le minimum retenu est
    la valeur € la PLUS FRÉQUENTE de la page (uniforme par catégorie sur Linxea) —
    robuste au bruit (montants de versement programmé isolés).
    """
    names = [re.sub(r"<[^>]+>", "", m).strip()
             for m in re.findall(r"<h4[^>]*>(.*?)</h4>", html, re.S)]
    names = [n for n in names if n and len(n) > 3]
    euros = [int(re.sub(r"[\s.,]", "", m)) for m in re.findall(r">([0-9][0-9\s.,]*)\s*€", html)]
    # On ne garde que des tickets plausibles (>= 100 €) pour écarter des artefacts.
    euros = [e for e in euros if e >= 100]
    dominant = Counter(euros).most_common(1)[0][0] if euros else None
    return names, dominant


# ─── Résolution titre → ISIN (base) ──────────────────────────────────────────

def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"\b(fcpr|fcpi|fip|fpci|part|parts|class share|classe?|share|action)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def build_name_index(client, category: str) -> dict[str, list[dict]]:
    """Index nom_normalisé → [fonds] pour le product_type ciblé (résolution des titres)."""
    idx: dict[str, list[dict]] = {}
    off = 0
    while True:
        rows = client.table("investissement_funds") \
            .select("isin,name,product_type,is_primary_share_class") \
            .eq("product_type", category) \
            .range(off, off + 999).execute().data or []
        for r in rows:
            idx.setdefault(normalize(r["name"]), []).append(r)
        if len(rows) < 1000:
            break
        off += 1000
    return idx


def resolve(title: str, idx: dict[str, list[dict]]) -> list[dict]:
    """Fonds de la base correspondant au titre Linxea (match exact puis inclusion)."""
    key = normalize(title)
    if key in idx:
        return idx[key]
    # Inclusion : le titre normalisé est préfixe/sous-chaîne d'un nom de base
    # (« eurazeo private value europe 3 » ⊂ variantes de parts).
    hits: list[dict] = []
    for k, rows in idx.items():
        if key and (key in k or k in key):
            hits.extend(rows)
    return hits


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, only: str | None):
    print("=" * 66)
    print("  AV Fund Minimums — minimum par (support × contrat), source Linxea")
    print("=" * 66)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    started = datetime.now(timezone.utc)
    client = get_client()
    today = date.today().isoformat()

    batch: list[dict] = []
    unresolved: list[tuple[str, str]] = []
    name_idx_cache: dict[str, dict] = {}

    for src in SOURCES:
        if only and only.lower() not in src["key"].lower():
            continue
        print(f"\n  {src['key']}  ({src['category']})")
        html = fetch(src["url"])
        if not html:
            continue
        names, dominant = parse_page(html)
        if dominant is None:
            print("    ⚠️  aucun minimum lisible sur la page")
            continue
        print(f"    minimum dominant : {dominant} €  ·  {len(names)} supports listés")

        idx = name_idx_cache.setdefault(src["category"], build_name_index(client, src["category"]))
        matched = 0
        for title in names:
            hits = resolve(title, idx)
            if not hits:
                unresolved.append((src["key"], title))
                continue
            # Un titre peut viser plusieurs share-classes : on écrit le minimum sur
            # chacune (le catalogue applique le même ticket à la catégorie).
            for h in hits:
                batch.append({
                    "isin": h["isin"],
                    "key": src["key"],
                    "min_investment_eur": dominant,
                    "source_url": src["url"],
                    "as_of": today,
                    "confidence": "scraped",
                })
            matched += 1
        print(f"    résolus : {matched}/{len(names)} titres → {len(batch)} lignes cumulées")

    # Dédoublonnage (isin,key) — dernière valeur gagne.
    dedup = {(r["isin"], r["key"]): r for r in batch}
    rows = list(dedup.values())

    print(f"\n  {len(rows)} lignes (isin × contrat) prêtes ; {len(unresolved)} titres non résolus")
    if unresolved:
        print("  Non résolus (à curer) :")
        for key, title in unresolved[:20]:
            print(f"    · [{key}] {title}")

    if not apply:
        print("\n  Aperçu (12 premières lignes) :")
        for r in rows[:12]:
            print(f"    {r['isin']}  {r['key']:<28} {r['min_investment_eur']} €")
        print("\n  DRY-RUN — relancer avec --apply pour écrire.")
        return

    # Écriture : upsert (isin,key). Ne crée pas de fonds ni d'éligibilité.
    ok = 0
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        try:
            client.table("investissement_av_fund_envelope_terms") \
                .upsert(chunk, on_conflict="isin,key").execute()
            ok += len(chunk)
        except Exception as e:
            print(f"    ⚠️  upsert KO ({i}) : {str(e)[:100]}")
    print(f"  → {ok}/{len(rows)} lignes écrites")
    log_run("av-fund-minimums", "success" if ok == len(rows) else "partial", ok, len(rows) - ok, started_at=started)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Minimum par (support × contrat) depuis les catalogues distributeurs")
    ap.add_argument("--apply", action="store_true", help="Écrire en base")
    ap.add_argument("--only", type=str, help="Filtrer sur un contrat (sous-chaîne de la clé)")
    args = ap.parse_args()
    run(apply=args.apply, only=args.only)
