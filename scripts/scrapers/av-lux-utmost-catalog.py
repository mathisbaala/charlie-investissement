#!/usr/bin/env python3
"""
av-lux-utmost-catalog.py — Catalogue UC Utmost Luxembourg S.A. (ex-Lombard Int'l)
================================================================================
Lombard International Assurance S.A. a été RENOMMÉE Utmost Luxembourg S.A.
(rachat Utmost Group clôturé 30/12/2024, rebranding effectif novembre 2025,
même entité juridique — RCS B37604). lombardinternational.com et
utmostwealthsolutions.com redirigent vers utmostgroup.com.

⚠️ Migré 2026-07-16 du PDF vers l'API REST WordPress publique d'utmostgroup.com
(le PDF « /mb/D2UfYL » ne listait que les fonds externes, parsing dépendant de
la mise en page ; l'API expose le même univers filtrable par contrat via la
taxonomie fund-list-code, sans le gate « Access Code » du fund-centre HTML) :
  GET /wp-json/wp/v2/fund-list-code?per_page=100   → id de la liste (slug=2626)
  GET /wp-json/wp/v2/fund?fund-list-code=<id>      → fonds ; ISIN et devise
      lisibles dans class_list (fund-isin-lu…, fund-currency-eur).

Contrat FR (LPS) : « Liberté » (code 2626, ~67 fonds externes référençables).
Les « ~800 UC » marketing incluent les FID/FAS sur mesure, non énumérables
publiquement. « Liberté Capitalisation France » (code 3775) n'a pas de liste de
fonds externes publiée (son annexe PDF /mb/dBHoR ne cite que des fonds dédiés,
0 ISIN). D'autres fund-list-codes existent (2844, 3107A-FR…) mais leur mapping
contrat n'est pas établi — ne pas semer à l'aveugle. Les listes 3603A/3604A/…
(PWP France) relèvent d'Utmost PanEurope dac (Irlande, autre assureur).

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-lux-utmost-catalog.py            # dry-run
    python3 scripts/scrapers/av-lux-utmost-catalog.py --apply
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session, _valid_isin  # noqa: E402

API_ROOT   = "https://www.utmostgroup.com/wp-json/wp/v2"
SOURCE_URL = "https://www.utmostgroup.com/funds-centre"

COMPANY = "Utmost Luxembourg S.A."

# (nom de contrat, slug fund-list-code) — slugs = codes contrat internes stables.
CONTRACTS = [
    ("Utmost Liberté Luxembourg", "2626"),
]

CLASS_ISIN_RE = re.compile(r"^fund-isin-([a-z0-9]{12})$")
TIMEOUT  = 45
PER_PAGE = 100


def _resolve_list_ids(session) -> dict[str, int]:
    """slug → id de terme de la taxonomie fund-list-code (paginé par prudence)."""
    out: dict[str, int] = {}
    page = 1
    while True:
        r = session.get(f"{API_ROOT}/fund-list-code",
                        params={"per_page": str(PER_PAGE), "page": str(page)},
                        timeout=TIMEOUT)
        if r.status_code != 200:
            print(f"  ⚠ HTTP {r.status_code} sur fund-list-code (page {page})")
            break
        rows = r.json()
        if not rows:
            break
        for t in rows:
            out[str(t.get("slug", ""))] = int(t["id"])
        if len(rows) < PER_PAGE:
            break
        page += 1
    return out


def fetch_list_isins(session, term_id: int) -> list[str]:
    """ISIN distincts d'une liste (pagination WP standard)."""
    isins: set[str] = set()
    page = 1
    while True:
        r = session.get(f"{API_ROOT}/fund",
                        params={"fund-list-code": str(term_id),
                                "per_page": str(PER_PAGE), "page": str(page)},
                        timeout=TIMEOUT)
        if r.status_code != 200:
            print(f"      ⚠ HTTP {r.status_code} sur fund (page {page})")
            break
        rows = r.json()
        if not rows:
            break
        for f in rows:
            for cl in f.get("class_list") or []:
                m = CLASS_ISIN_RE.match(str(cl))
                if m:
                    isin = m.group(1).upper()
                    if _valid_isin(isin):
                        isins.add(isin)
                    break
        if len(rows) < PER_PAGE:
            break
        page += 1
        time.sleep(0.3)
    return sorted(isins)


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print(f"  {COMPANY} — API utmostgroup.com (catalogue UC par contrat)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    contracts = CONTRACTS[:limit] if limit else CONTRACTS
    session = make_session()
    list_ids = _resolve_list_ids(session)

    per_contract: list[tuple[str, list[str]]] = []
    for i, (name, slug) in enumerate(contracts):
        term_id = list_ids.get(slug)
        if not term_id:
            print(f"  [{i+1}/{len(contracts)}] {name[:44]:44} ✗ slug {slug} introuvable")
            continue
        isins = fetch_list_isins(session, term_id)
        print(f"  [{i+1}/{len(contracts)}] {name[:44]:44} {len(isins):5} ISIN")
        per_contract.append((name, isins))

    union = sorted({x for _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — API cassée ou slugs changés.")
        if apply:
            log_run("av-lux-utmost-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  Aperçu (10 premiers ISIN) :", ", ".join(union[:10]))
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for contract_name, isins in per_contract:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": COMPANY, "contract_name": contract_name,
                "source_url": SOURCE_URL, "scraped_at": now,
            })
    if batch:
        client.table("investissement_av_lux_eligibility") \
            .upsert(batch, on_conflict="isin,contract_name").execute()
        ok = len(batch)

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} ISIN bruts avant filtre).")
    log_run("av-lux-utmost-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Utmost Luxembourg — catalogue UC (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
