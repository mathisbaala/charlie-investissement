#!/usr/bin/env python3
"""
geco-kid-finder.py — URLs KID/DICI depuis l'API officielle AMF GECO
====================================================================
Pour chaque OPCVM/ETF sans kid_url, cherche le document KID/DICI via
l'API REST interne de GECO (reverse-engineered depuis le frontend Angular).

Pipeline :
  1. shareByCmpCodeParPrincp/{ISIN} → shareId
  2. document/byShare/{shareId} → liste de documents
  3. Filtrer KID/DICI (docTypeLib contenant "DIC" ou "PRIIPS")
  4. URL = /back-office/document/download/{idInterne}

Couverture : tous les fonds FR agréés AMF (pas les fonds LU/IE étrangers).

Usage :
    python3 scripts/scrapers/geco-kid-finder.py [--apply] [--limit N] [--isin ISIN]
"""

import sys
import time
import json
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

WORKERS        = 4
RATE_LIMIT_SEC = 0.8
TIMEOUT        = 12
GECO_BASE      = "https://geco.amf-france.org/back-office"

HEADERS = {
    "Accept":       "application/json",
    "User-Agent":   "Mozilla/5.0 (compatible; Charlie-Investissement/1.0; data@charlie.fr)",
    "Referer":      "https://geco.amf-france.org/",
    "Content-Type": "application/json",
    "Origin":       "https://geco.amf-france.org",
}

# DocTypeLib values à considérer comme KID/DICI
KID_TYPE_KEYWORDS = ("dic", "priips", "kid", "dici", "kiid", "information clé")


def _find_share_id(session: FetcherSession, isin: str) -> int | None:
    """Retourne le shareId (idInterne GECO) pour un ISIN donné."""
    # Stratégie 1 : ISIN direct
    try:
        r = session.get(
            f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{isin}",
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if r.status == 200 and r.body.decode("utf-8").strip() not in ("", "null", "{}"):
            share = json.loads(r.body.decode("utf-8"))
            if isinstance(share, dict) and share.get("idInterne"):
                return int(share["idInterne"])
    except (Exception, ValueError):
        pass

    # Stratégie 2 : via compartiments
    payload = {"first": 0, "rows": 10, "sortOrder": 1, "filters": {}, "globalFilter": isin}
    try:
        r2 = session.post(
            f"{GECO_BASE}/funds/getCompartmentsBycriteria?productType=FR",
            stealthy_headers=True, json=payload, timeout=TIMEOUT,
        )
        if r2.status != 200:
            return None
        compartments = json.loads(r2.body.decode("utf-8")).get("compartmentDtos", [])
    except (Exception, ValueError):
        return None

    for cmp in compartments:
        if isin in (cmp.get("sharesIsins") or []):
            code = cmp.get("cmpCodeParPrincp")
            if code:
                try:
                    r3 = session.get(
                        f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{code}",
                        stealthy_headers=True, timeout=TIMEOUT,
                    )
                    if r3.status == 200 and r3.body.decode("utf-8").strip() not in ("", "null", "{}"):
                        share = json.loads(r3.body.decode("utf-8"))
                        if isinstance(share, dict) and share.get("idInterne"):
                            return int(share["idInterne"])
                except (Exception, ValueError):
                    pass
            # Fallback : compartment/{id}/shares
            cmp_id = cmp.get("idInterne")
            if cmp_id:
                try:
                    r4 = session.get(
                        f"{GECO_BASE}/funds/compartment/{cmp_id}/shares",
                        stealthy_headers=True, timeout=TIMEOUT,
                    )
                    if r4.status == 200:
                        shares = json.loads(r4.body.decode("utf-8"))
                        if isinstance(shares, list) and shares:
                            sid = shares[0].get("idInterne")
                            if sid:
                                return int(sid)
                except (Exception, ValueError):
                    pass

    return None


def _find_kid_url(session: FetcherSession, share_id: int) -> tuple[str | None, str | None]:
    """
    Retourne (kid_url, doc_name) pour un shareId GECO.
    Filtre les documents de type KID/DICI (PRIIPS).
    """
    try:
        r = session.get(
            f"{GECO_BASE}/document/byShare/{share_id}",
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if r.status != 200:
            return None, None
        docs = json.loads(r.body.decode("utf-8"))
        if not isinstance(docs, list) or not docs:
            return None, None

        # Filtrer les documents KID/DICI
        kid_docs = [
            d for d in docs
            if any(kw in str(d.get("docTypeLib", "")).lower() for kw in KID_TYPE_KEYWORDS)
            and d.get("published", False)
        ]

        if not kid_docs:
            # Fallback : prendre tout PDF publié
            kid_docs = [d for d in docs if d.get("published", False)]

        if not kid_docs:
            return None, None

        # Trier par dateEffet desc (le plus récent en premier)
        kid_docs.sort(key=lambda d: d.get("dateEffet", ""), reverse=True)
        doc = kid_docs[0]
        id_interne = doc.get("idInterne")
        doc_name   = doc.get("docName", "")

        if not id_interne:
            return None, None

        url = f"{GECO_BASE}/document/download/{id_interne}"
        return url, doc_name

    except (Exception, ValueError):
        return None, None


def run(apply: bool, limit: int | None, isin_filter: str | None):
    print("=" * 60)
    print("  GECO KID Finder — KID/DICI depuis API AMF GECO")
    print("=" * 60)
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    if isin_filter:
        funds = [{"isin": isin_filter, "name": ""}]
    else:
        funds = []
        seen: set[str] = set()
        offset = 0
        page_size = 1000

        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin, name, product_type")
                .in_("product_type", ["opcvm", "etf"])
                .is_("kid_url", "null")
                .like("isin", "FR%")  # GECO couvre les fonds FR agréés
                .range(offset, offset + page_size - 1)
                .execute().data or []
            )
            for row in batch:
                isin = row["isin"]
                if isin not in seen:
                    seen.add(isin)
                    funds.append(row)
            if len(batch) < page_size:
                break
            if limit and len(funds) >= limit * 2:
                break
            offset += page_size

        if limit:
            funds = funds[:limit]

    print(f"  {len(funds)} fonds FR sans kid_url à traiter")
    print()

    found    = 0
    no_share = 0
    no_doc   = 0
    lock     = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, no_share, no_doc
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:35]

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT_SEC)

        share_id = _find_share_id(session, isin)
        if not share_id:
            with lock:
                no_share += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ~ [{i:5d}] {isin} | no share | {name}")
            return

        time.sleep(RATE_LIMIT_SEC * 0.3)
        kid_url, doc_name = _find_kid_url(session, share_id)

        with lock:
            if kid_url:
                found += 1
                if apply:
                    upsert_fund({"isin": isin, "kid_url": kid_url})
                if i <= 30 or i % 200 == 0:
                    print(f"  ✓ [{i:5d}] {isin} | {(doc_name or '')[:40]} | {name}")
            else:
                no_doc += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ~ [{i:5d}] {isin} | no doc | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} KID URLs trouvées, {no_share} sans shareId, {no_doc} sans document")

    if apply:
        log_run(
            "geco-kid-finder",
            "success" if no_share + no_doc < found else "partial",
            found,
            no_share + no_doc,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GECO KID Finder")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    parser.add_argument("--isin",   type=str,            help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
