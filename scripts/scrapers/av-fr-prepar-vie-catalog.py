#!/usr/bin/env python3
"""
av-fr-prepar-vie-catalog.py — Référencement Prépar Vie (AV France)
====================================================================
Source : portail PRIIPS WordPress de Prépar Vie (priips.prepar-vie.com), un
tableau HTML par contrat, chargé en AJAX (action=getTableauContentAjax) —
PAS de PDF ici. Contrairement au portail BPCE (server-rendu), le tableau des
supports n'est PAS dans le HTML initial : il faut un aller-retour AJAX avec un
nonce WordPress extrait de la page (`window.ajax_vars.nonce`), valable pour un
POST direct (vérifié : aucun cookie de session requis).

Découverte dynamique à 2 niveaux (même principe qu'av-fr-bpce-catalog.py) :
  1. Une page produit quelconque liste, dans son menu « Parcourir les formules
     des réseaux », un lien /produits/<slug>/ par réseau distributeur (BRED,
     EDF-ENGIE, LAPLACE, MURANO, PREPAR, PRIMONIAL, SBE, SEP, TALENCE, UNEP,
     ZENITH).
  2. Chaque page réseau liste, dans « Consulter un contrat », un lien
     /produits/<slug>/ par contrat de CE réseau (ex. BRED en a 5 : BRED
     Assurance Vie, BRED Assurance Vie Patrimoine, VIP II Capitalisation ×3).
Pour chaque contrat : GET la page (nonce + `data-term` du tableau
`.desktop-tableau[data-type="supports"]`), POST admin-ajax avec
post_to_show=1000 pour tout récupérer en un seul appel (pas de pagination
requise côté serveur, vérifié jusqu'à 31 lignes).

Assureur unique : Prépar Vie, quel que soit le réseau distributeur. Écrit en
éligibilité directement (source HTML/AJAX, pas de PDF) — même schéma
qu'av-fr-bpce-catalog.py.

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, et
uniquement pour les ISIN déjà en base. Idempotent.

Usage :
    python3 scripts/scrapers/av-fr-prepar-vie-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-prepar-vie-catalog.py --apply
"""
import argparse
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as cffi_requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, refresh_fund_insurers_mv, log_run  # noqa: E402

COMPANY = "Prépar Vie"
BASE = "https://priips.prepar-vie.com"
SEED_PRODUCT = "/produits/bred-asv/"  # page de départ, forcément dans un réseau connu
ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
PRODUCT_LINK_RE = re.compile(r'href="(https://priips\.prepar-vie\.com/produits/[^"]+)"[^>]*>([^<]*)')
TIMEOUT = 45
RATE_LIMIT = 1.5  # pause entre 2 contrats (le portail ferme parfois la connexion TLS en rafale)


def session():
    return cffi_requests.Session(impersonate="chrome")


# curl_cffi (impersonate="chrome") corrompt parfois son handle TLS après de
# nombreuses requêtes sur la MÊME Session (« OPENSSL_internal: invalid
# library ») — bug connu côté client, pas un blocage serveur. Parade : une
# session fraîche par appel réseau (léger surcoût TCP, sans conséquence ici).


def discover_networks(sess) -> list[str]:
    """URLs des 11 pages réseau, depuis le menu de la page de départ."""
    r = _get(sess, BASE + SEED_PRODUCT)
    out, seen = [], set()
    for href, label in PRODUCT_LINK_RE.findall(r.text):
        if label.strip() and href not in seen:  # entrées de menu réseau = seules à avoir un libellé
            seen.add(href)
            out.append(href)
    return out


def discover_contracts(sess, network_url: str) -> list[str]:
    """URLs des contrats listés sur une page réseau (liens sans libellé = « Consulter un contrat »)."""
    r = _get(sess, network_url)
    out, seen = [], set()
    for href, label in PRODUCT_LINK_RE.findall(r.text):
        if not label.strip() and href not in seen:
            seen.add(href)
            out.append(href)
    return out, r.text


def contract_label(html: str, slug: str) -> str:
    """Nom du contrat depuis le <h1> de la page (le <title> est injecté côté
    client, absent du HTML serveur) ; à défaut, le slug d'URL."""
    m = re.search(r"<h1[^>]*>([^<]+)", html)
    if m:
        label = re.sub(r"\s+", " ", m.group(1)).strip()
        if label:
            return label
    return slug


def _retry(fn, retries: int = 4):
    """Exécute `fn()` avec retente à pauses croissantes : le portail ferme
    parfois la connexion (TLS) en rafale, une pause plus longue suffit."""
    last = None
    for attempt in range(retries):
        try:
            return fn()
        except Exception as e:
            last = e
            time.sleep(RATE_LIMIT * (attempt + 1) * 2)
    raise last


def _get(sess, url: str):
    return _retry(lambda: session().get(url, timeout=TIMEOUT))


def fetch_isins(sess, contract_url: str, html: str | None = None) -> tuple[set[str], str]:
    """(ISIN, libellé) pour un contrat : nonce + term dans le HTML, tableau via AJAX."""
    if html is None:
        html = _get(sess, contract_url).text
    nonce_m = re.search(r'"nonce":"([a-f0-9]+)"', html)
    term_m = re.search(r'data-type="supports"[^>]*data-term="([^"]+)"', html)
    if not term_m:  # ordre des attributs parfois inversé
        term_m = re.search(r'data-term="([^"]+)"[^>]*data-type="supports"', html)
    slug = contract_url.rstrip("/").rsplit("/", 1)[-1]
    if not nonce_m or not term_m:
        return set(), slug
    r = _retry(lambda: session().post(
        f"{BASE}/wp-admin/admin-ajax.php",
        params={"action": "getTableauContentAjax"},
        data={
            "post_type": "supports", "post_term": term_m.group(1), "post_ordermode": "",
            "post_max": "", "post_to_show": "1000", "post_offset": "0",
            "security": nonce_m.group(1),
        },
        timeout=TIMEOUT,
    ))
    isins = set(ISIN_RE.findall(r.text))
    if not isins:
        # 0 ISIN peut être un vrai tableau vide OU une réponse tronquée par le
        # portail (nonce périmé, AJAX renvoyant une erreur) : une seconde
        # tentative avec un nonce/HTML frais tranche les deux.
        html2 = _get(sess, contract_url).text
        nonce2 = re.search(r'"nonce":"([a-f0-9]+)"', html2)
        if nonce2 and nonce2.group(1) != nonce_m.group(1):
            r2 = _retry(lambda: session().post(
                f"{BASE}/wp-admin/admin-ajax.php",
                params={"action": "getTableauContentAjax"},
                data={
                    "post_type": "supports", "post_term": term_m.group(1), "post_ordermode": "",
                    "post_max": "", "post_to_show": "1000", "post_offset": "0",
                    "security": nonce2.group(1),
                },
                timeout=TIMEOUT,
            ))
            isins = set(ISIN_RE.findall(r2.text))
    return isins, contract_label(html, slug)


def existing_isins(client) -> set[str]:
    s, off = set(), 0
    while True:
        rows = client.table("investissement_funds").select("isin").range(off, off + 999).execute().data
        if not rows:
            break
        s.update(r["isin"] for r in rows)
        off += 1000
    return s


def main():
    ap = argparse.ArgumentParser(description="Prépar Vie AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    sess = session()
    networks = discover_networks(sess)
    print(f"  Réseaux découverts : {len(networks)}")

    contract_urls: dict[str, None] = {}
    for net_url in networks:
        urls, _ = discover_contracts(sess, net_url)
        for u in urls:
            contract_urls.setdefault(u, None)
        time.sleep(RATE_LIMIT)
    items = list(contract_urls.keys())
    if args.limit:
        items = items[: args.limit]
    print(f"  Contrats découverts : {len(items)}\n")

    known = existing_isins(get_client()) if args.apply else None
    if known is not None:
        print(f"ISIN en base : {len(known)}\n")

    rows: list[tuple[str, str, str]] = []  # (isin, contract_name, source_url)
    for i, url in enumerate(items, 1):
        try:
            found, label = fetch_isins(sess, url)
        except Exception as e:
            print(f"  [{i}/{len(items)}] {url[-30:]:30} ERR {str(e)[:50]}")
            continue
        kept = found & known if known is not None else found
        flag = "" if kept or known is None else "  ⚠️ 0 en base — vérifier la page"
        print(f"  [{i}/{len(items)}] {label[:40]:40} {len(found):4} ISIN cités"
              + (f", {len(kept):4} en base" if known is not None else "") + flag)
        for isin in kept if known is not None else found:
            rows.append((isin, label, url))
        time.sleep(RATE_LIMIT)

    distinct = len({r[0] for r in rows})
    print(f"\nUnion ISIN distincts : {distinct} | lignes éligibilité : {len(rows)}")

    if not args.apply:
        print("\nDRY-RUN — rien écrit. Relancer avec --apply (creds réels).")
        return

    client = get_client()
    now = datetime.now(timezone.utc).isoformat()
    seen_keys = set()
    batch, ok = [], 0
    for isin, contract, url in rows:
        key = (isin, contract)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        batch.append({"isin": isin, "company_name": COMPANY, "contract_name": contract,
                      "source_url": url, "scraped_at": now})
        if len(batch) >= 200:
            client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
            ok += len(batch); batch = []
    if batch:
        client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)
    print(f"\nÉligibilité écrite : {ok} lignes ({distinct} fonds distincts).")
    if refresh_fund_insurers_mv():
        print("✓ matview investissement_fund_insurers_mv rafraîchie.")
    log_run("av-fr-prepar-vie-catalog", "success", ok, 0)


if __name__ == "__main__":
    main()
