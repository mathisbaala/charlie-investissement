#!/usr/bin/env python3
"""
av-fr-bpce-catalog.py — Référencement BPCE Vie / Natixis Assurances (AV France)
================================================================================
Source : portail PRIIPS public du groupe BPCE (priips.assurances.groupebpce.com),
un catalogue HTML par contrat — PAS de PDF ici (à la différence des autres
scrapers Tier 3), table HTML server-rendue directement exploitable en requête
simple (vérifié : identique en curl nu et en navigateur, aucun JS requis).

Découverte dynamique à 2 niveaux (site restructuré épisodiquement, cf.
av-fr-groupama-gan-catalog.py pour le même principe) :
  1. Page d'accueil → un lien /banque/<id> par établissement du groupe
     (Banque Populaire, Caisse d'Epargne, Banque de Savoie, Banque BCP,
     Banque de Tahiti, Banque Nouvelle Calédonie, Crédit Coopératif).
  2. Page /banque/<id> → un lien /category/<id> par contrat commercialisé
     dans ce réseau (gammes distinctes par réseau : Millevie pour Caisse
     d'Epargne, Quintessa/Horizeo pour Banque Populaire…).
Chaque page /category/<id> liste ses supports (nom + ISIN) dans un tableau HTML
unique, sans pagination (vérifié jusqu'à 630 lignes sur /products).

Assureur unique quel que soit le réseau distributeur : BPCE Vie (Natixis
Assurances). Écrit en éligibilité directement (pas de socle _av_pdf_common,
qui suppose du PDF) — même schéma qu'av-fr-mutualistes-catalog.py.

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, et
uniquement pour les ISIN déjà en base. Idempotent.

Usage :
    python3 scripts/scrapers/av-fr-bpce-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-bpce-catalog.py --apply
"""
import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as cffi_requests
from parsel import Selector

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, refresh_fund_insurers_mv, log_run  # noqa: E402

COMPANY = "BPCE Vie"
BASE = "https://priips.assurances.groupebpce.com"
ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
TIMEOUT = 45


def session():
    return cffi_requests.Session(impersonate="chrome")


def discover_banks(sess) -> list[tuple[str, str]]:
    """(id, nom) de chaque établissement du groupe depuis la page d'accueil."""
    r = sess.get(BASE + "/", timeout=TIMEOUT)
    sel = Selector(r.text)
    out, seen = [], set()
    for a in sel.css('a[href*="/banque/"]'):
        href = a.attrib.get("href", "")
        m = re.search(r"/banque/(\d+)", href)
        if not m:
            continue
        bank_id = m.group(1)
        name = " ".join(a.css("::text").getall()).strip()
        if bank_id in seen or not name:
            continue
        seen.add(bank_id)
        out.append((bank_id, name))
    return out


def discover_contracts(sess, bank_id: str) -> list[tuple[str, str]]:
    """(category_id, nom_contrat) de chaque contrat listé pour cette banque."""
    r = sess.get(f"{BASE}/banque/{bank_id}", timeout=TIMEOUT)
    sel = Selector(r.text)
    out = []
    for a in sel.css('a[href*="/category/"]'):
        href = a.attrib.get("href", "")
        m = re.search(r"/category/(\d+)", href)
        if not m:
            continue
        label = " ".join(a.css("::text").getall()).strip()
        label = label.lstrip("|").strip()
        label = re.sub(r"\s+", " ", label)
        if not label or label.lower() == "produits":
            continue  # lien de menu générique, pas un contrat
        out.append((m.group(1), label))
    return out


def fetch_isins(sess, category_id: str) -> set[str]:
    r = sess.get(f"{BASE}/category/{category_id}", timeout=TIMEOUT)
    return set(ISIN_RE.findall(r.text))


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
    ap = argparse.ArgumentParser(description="BPCE Vie / Natixis Assurances AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    sess = session()
    banks = discover_banks(sess)
    print(f"  Établissements découverts : {len(banks)}")

    # (category_id, contrat) dédupliqués — un même contrat peut, en théorie,
    # être relié depuis plusieurs pages banque si le groupe le mutualise.
    contracts: dict[str, str] = {}
    for bank_id, bank_name in banks:
        for cat_id, label in discover_contracts(sess, bank_id):
            contracts.setdefault(cat_id, label)
    items = list(contracts.items())
    if args.limit:
        items = items[: args.limit]
    print(f"  Contrats découverts : {len(items)}\n")

    known = existing_isins(get_client()) if args.apply else None
    if known is not None:
        print(f"ISIN en base : {len(known)}\n")

    rows: list[tuple[str, str, str]] = []  # (isin, contract_name, category_id)
    for i, (cat_id, label) in enumerate(items, 1):
        try:
            found = fetch_isins(sess, cat_id)
        except Exception as e:
            print(f"  [{i}/{len(items)}] {label[:40]:40} ERR {str(e)[:50]}")
            continue
        kept = found & known if known is not None else found
        flag = "" if kept or known is None else "  ⚠️ 0 en base — vérifier la page"
        print(f"  [{i}/{len(items)}] {label[:40]:40} {len(found):4} ISIN cités"
              + (f", {len(kept):4} en base" if known is not None else "") + flag)
        for isin in kept if known is not None else found:
            rows.append((isin, label, cat_id))

    distinct = len({r[0] for r in rows})
    print(f"\nUnion ISIN distincts : {distinct} | lignes éligibilité : {len(rows)}")

    if not args.apply:
        print("\nDRY-RUN — rien écrit. Relancer avec --apply (creds réels).")
        return

    client = get_client()
    now = datetime.now(timezone.utc).isoformat()
    seen_keys = set()
    batch, ok = [], 0
    for isin, contract, cat_id in rows:
        key = (isin, contract)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        batch.append({"isin": isin, "company_name": COMPANY, "contract_name": contract,
                      "source_url": f"{BASE}/category/{cat_id}", "scraped_at": now})
        if len(batch) >= 200:
            client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
            ok += len(batch); batch = []
    if batch:
        client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)
    print(f"\nÉligibilité écrite : {ok} lignes ({distinct} fonds distincts).")
    if refresh_fund_insurers_mv():
        print("✓ matview investissement_fund_insurers_mv rafraîchie.")
    log_run("av-fr-bpce-catalog", "success", ok, 0)


if __name__ == "__main__":
    main()
