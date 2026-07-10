#!/usr/bin/env python3
"""
av-fr-maif-catalog.py — Référencement MAIF Vie (AV France)
===========================================================
Source déterministe : l'API JSON publique du site maif.fr, celle qu'appelle le
web component `r2wc-ars-valeur-uc` de la page
  https://www.maif.fr/epargne-patrimoine/assurance-vie/unites-de-compte

  GET https://www.maif.fr/gateway/socle-api/vieprevoyance/informations_produits/
      v1/assurance_vie/unites_compte

⚠️ L'en-tête `Accept: application/json` est OBLIGATOIRE — sans lui la gateway
renvoie la coquille XHTML du site (HTTP 200 trompeur). Un seul contrat exposé :
« Assurance vie Responsable et Solidaire » (~30 UC, ISIN dans
`idInvestissement`). Pas d'équivalent PER trouvé (sondé 2026-07-10 : 404).

ÉLIGIBILITÉ-ONLY : n'écrit QUE dans investissement_av_lux_eligibility, et
UNIQUEMENT pour les ISIN déjà présents dans investissement_funds. N'insère ni
ne met à jour aucun fonds.

DRY-RUN (sans --apply) : ne touche pas la DB — valide fetch+parse uniquement.

Reachability CI non confirmée (risque type Abeille/MAAF : IP datacenter
bloquée) — à vérifier au premier run workflow_dispatch ; le scraper accepte
`use_proxy` via AV_PROXY_URL comme les autres hôtes sensibles.

Usage :
    python3 scripts/scrapers/av-fr-maif-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-maif-catalog.py --apply
"""
import os
import re
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as cffi_requests

sys.path.insert(0, str(Path(__file__).parent.parent))

# ⚠️ Noms alignés sur l'EXISTANT en base (seed manuel du 2026-06-21, 16 UC) :
# la clé d'upsert est (isin, contract_name) — toute variante de casse créerait
# un contrat doublon, et « Maif » est déjà le nom assureur exposé par l'UI.
COMPANY = "Maif"
CONTRACT = "Assurance Vie Responsable et Solidaire"
API_URL = (
    "https://www.maif.fr/gateway/socle-api/vieprevoyance/"
    "informations_produits/v1/assurance_vie/unites_compte"
)
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")


def fetch_uc() -> list[dict]:
    """Retourne la liste des UC du contrat ARS : [{isin, name}]."""
    proxies = None
    proxy_url = os.environ.get("AV_PROXY_URL", "").strip()
    if proxy_url:
        print("  ↻ proxy résidentiel actif (AV_PROXY_URL)")
        proxies = {"http": proxy_url, "https": proxy_url}
    session = cffi_requests.Session(impersonate="chrome", proxies=proxies)
    r = session.get(API_URL, headers={"Accept": "application/json"}, timeout=45)
    r.raise_for_status()
    data = r.json()
    out = []
    for uc in data.get("unitesCompte", []):
        isin = (uc.get("idInvestissement") or "").strip().upper()
        if not ISIN_RE.match(isin):
            continue
        out.append({"isin": isin, "name": uc.get("libelleInvestissement")})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    print("=" * 64)
    print(f"  MAIF Vie — catalogue UC ({CONTRACT})")
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    ucs = fetch_uc()
    print(f"  UC extraites de l'API : {len(ucs)}")
    for uc in ucs[:10]:
        print(f"    {uc['isin']}  {(uc['name'] or '?')[:60]}")
    if len(ucs) < 5:
        print("  ⚠️  Trop peu d'UC — source vide/bloquée, rien à écrire.")
        return

    if not args.apply:
        print("  DRY-RUN — rien écrit. Relancer avec --apply (creds réels).")
        return

    from db import get_client  # import tardif : dry-run sans DB

    client = get_client()
    known, off = set(), 0
    while True:
        rows = (
            client.table("investissement_funds")
            .select("isin").range(off, off + 999).execute().data
        )
        if not rows:
            break
        known.update(r["isin"] for r in rows)
        off += 1000

    now = datetime.now(timezone.utc).isoformat()
    seen_keys = set()  # dédup (isin, contract) — gotcha Postgres 21000
    batch = []
    for uc in ucs:
        if uc["isin"] not in known:
            continue
        key = (uc["isin"], CONTRACT)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        batch.append({
            "isin": uc["isin"],
            "company_name": COMPANY,
            "contract_name": CONTRACT,
            "source_url": API_URL,
            "scraped_at": now,
        })
    skipped = len(ucs) - len(batch)
    if batch:
        client.table("investissement_av_lux_eligibility").upsert(
            batch, on_conflict="isin,contract_name"
        ).execute()
    print(f"  Éligibilité écrite : {len(batch)} lignes "
          f"({skipped} ISIN hors base, ignorés — éligibilité-only).")


if __name__ == "__main__":
    main()
