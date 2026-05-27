#!/usr/bin/env python3
"""
morningstar-ter-fill.py — TER/AUM manquants via Morningstar pour fonds déjà enrichis
======================================================================================
Cible : fonds avec morningstar_rating (Morningstar déjà connu) mais sans TER.
Ces fonds sont ignorés par morningstar-lt-enricher.py (qui cible rating IS NULL).

Usage :
    python3 scripts/scrapers/morningstar-ter-fill.py [--apply] [--limit N]
"""

import sys
import json
import time
import argparse
import threading
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

RATE_LIMIT_SEC = 0.5
TIMEOUT        = 12
WORKERS        = 1  # séquentiel pour éviter le ban

SEARCH_URL  = "https://www.morningstar.fr/fr/util/SecuritySearch.ashx"
DETAILS_URL = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{ms_id}"
HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "application/json, text/plain, */*",
    "Referer":         "https://www.morningstar.fr/fr/",
}

def _ms_get(session: FetcherSession, url: str, params: dict | None = None) -> object:
    params = params or {}
    return session.get(url, params=params, stealthy_headers=True, timeout=TIMEOUT)


def search_ms_id(session: FetcherSession, isin: str) -> str | None:
    try:
        page = _ms_get(session, SEARCH_URL, params={"q": isin, "limit": 1})
        if page.status != 200:
            return None
        for part in page.body.decode("utf-8").strip().split("|"):
            part = part.strip()
            if part.startswith("{") and '"i"' in part:
                obj = json.loads(part)
                return obj.get("i") or obj.get("pi")
    except Exception:
        pass
    return None


def fetch_ter(session: FetcherSession, ms_id: str) -> dict | None:
    try:
        page = _ms_get(
            session,
            DETAILS_URL.format(ms_id=ms_id),
            params={"viewId": "snapshot", "locale": "fr-FR",
                    "languageId": "fr-FR", "currencyId": "EUR",
                    "responseViewFormat": "json"},
        )
        if page.status != 200:
            return None
        data = json.loads(page.body.decode("utf-8"))
        if not data or not isinstance(data, list):
            return None
        item = data[0]
        result: dict = {}

        oc_raw = item.get("OngoingCharge")
        if oc_raw:
            try:
                oc = float(str(oc_raw).replace(",", "."))
                if 0 < oc < 20:
                    result["ongoing_charges"] = round(oc / 100, 6)
                    result["ter"]             = round(oc / 100, 6)
            except (ValueError, TypeError):
                pass

        # inception_date + country (available for free from the same endpoint)
        inception_raw = (item.get("InceptionDate") or "").strip()
        if inception_raw:
            result["inception_date"] = inception_raw[:10]
        # Domicile ignoré : colonne `country` absente du schéma DB

        # Supprimer `country` si encore présent (colonne absente du schéma)
        result.pop("country", None)
        return result if result else None
    except Exception:
        return None


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Morningstar TER Fill — TER manquants via lt.morningstar.com")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name")
            .not_.is_("morningstar_rating", "null")
            .is_("ongoing_charges", "null")
            .is_("ter", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} fonds avec MS rating mais sans TER\n")

    found = extra_found = not_found = 0
    now = datetime.now(timezone.utc).isoformat()

    with FetcherSession(impersonate="chrome") as session:
        for i, fund in enumerate(funds, 1):
            isin = fund["isin"]
            name = (fund.get("name") or "")[:40]
            time.sleep(RATE_LIMIT_SEC)

            ms_id = search_ms_id(session, isin)
            if not ms_id:
                not_found += 1
                if i <= 5 or i % 100 == 0:
                    print(f"  ✗ [{i:4d}] {isin} | ms_id not found | {name}")
                continue

            time.sleep(RATE_LIMIT_SEC)
            details = fetch_ter(session, ms_id)

            if details and "ter" in details:
                found += 1
                ter_pct = f"{details['ter']*100:.2f}%"
                if i <= 20 or i % 50 == 0:
                    print(f"  ✓ [{i:4d}] {isin} | TER:{ter_pct} | {name}")
                if apply:
                    try:
                        client.table("investissement_funds") \
                            .update({**details, "updated_at": now}) \
                            .eq("isin", isin) \
                            .execute()
                    except Exception as e:
                        if found <= 3:
                            print(f"  ✗ DB {isin}: {e}")
            elif details and any(k in details for k in ("inception_date", "country")):
                extra = {k: v for k, v in details.items() if k in ("inception_date", "country")}
                extra_found += 1
                if i <= 5 or i % 100 == 0:
                    parts = [f"{k}={v}" for k, v in extra.items()]
                    print(f"  + [{i:4d}] {isin} | {' | '.join(parts)} | {name}")
                if apply:
                    try:
                        client.table("investissement_funds") \
                            .update({**extra, "updated_at": now}) \
                            .eq("isin", isin) \
                            .execute()
                    except Exception as e:
                        if extra_found <= 3:
                            print(f"  ✗ DB {isin}: {e}")
                not_found += 1
            else:
                not_found += 1
                if i <= 5 or i % 100 == 0:
                    print(f"  ✗ [{i:4d}] {isin} | no TER | {name}")

    print(f"\n  → {found} TERs récupérés, {extra_found} inception/country only, {not_found} introuvables")
    if apply:
        log_run("morningstar-ter-fill", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
