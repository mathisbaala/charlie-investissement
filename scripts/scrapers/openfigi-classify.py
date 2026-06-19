#!/usr/bin/env python3
"""
openfigi-classify.py — Détecter les titres mal classés 'opcvm' via OpenFIGI
===========================================================================
Des actions / REIT / certificats représentatifs ont parfois été ingérés comme
product_type='opcvm' (ex. ID LOGISTICS, BANCA MONTE DEI PASCHI). Le nom seul ne
suffit pas à les distinguer d'un fonds. OpenFIGI donne un signal FIABLE via
`securityType2` :
  - 'Common Stock' / 'REIT' / 'Depositary Receipt' / 'Preferred Stock' → ACTION
  - 'Mutual Fund' / 'Open-End Fund' / … → fonds (on ne touche pas)

Garde de classification INCRÉMENTALE : on ne ré-interroge pas les ISIN déjà vus
(cache investissement_figi_security_type) ; un fonds confirmé n'est plus
re-checké. Les ISIN reclassés en 'action' sortent naturellement de la cible.

Cible par défaut : opcvm à VRAI ISIN, hors CSSF_* (déjà reclassés), pas encore
dans le cache, priorité aux fonds SANS série de prix (un titre vif n'a pas de
VL de fonds). --all pour balayer aussi ceux avec prix.

Usage :
    python3 scripts/scrapers/openfigi-classify.py --limit 50            (dry-run)
    python3 scripts/scrapers/openfigi-classify.py --apply --limit 2000  (écrit)
    python3 scripts/scrapers/openfigi-classify.py --apply               (tous les suspects)
"""

import os
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, update_funds_bulk, log_run, now_iso

MAPPING_URL = "https://api.openfigi.com/v3/mapping"
TIMEOUT     = 30
CACHE_TABLE = "investissement_figi_security_type"
# securityType2 qui désignent un TITRE VIF (pas un fonds) → reclasser en 'action'.
STOCK_TYPES = {"Common Stock", "REIT", "Depositary Receipt", "Preferred Stock"}

API_KEY = os.environ.get("OPENFIGI_API_KEY", "").strip()
# Sans clé : lots de 10 & 25 req/min ; avec clé : 100 & 250 req/min.
DEFAULT_BATCH = 100 if API_KEY else 10
DEFAULT_SLEEP = 0.25 if API_KEY else 2.5
HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    "User-Agent":   "charlie-investissement/openfigi-classify",
}
if API_KEY:
    HEADERS["X-OPENFIGI-APIKEY"] = API_KEY


# ─── Sélection des cibles ──────────────────────────────────────────────────────

def select_targets(client, limit: int | None, include_priced: bool) -> list[str]:
    """opcvm à vrai ISIN (hors CSSF_) pas encore dans le cache FIGI. Sans
    include_priced : seulement ceux sans série de prix (suspects prioritaires)."""
    cached: set[str] = set()
    after = ""
    while True:
        rows = (client.table(CACHE_TABLE).select("isin")
                .gt("isin", after).order("isin").limit(1000).execute().data or [])
        if not rows:
            break
        cached.update(r["isin"] for r in rows)
        if len(rows) < 1000:
            break
        after = rows[-1]["isin"]

    priced: set[str] = set()
    if not include_priced:
        after = ""
        while True:
            rows = (client.table("investissement_fund_price_coverage").select("isin")
                    .gt("isin", after).order("isin").limit(1000).execute().data or [])
            if not rows:
                break
            priced.update(r["isin"] for r in rows)
            if len(rows) < 1000:
                break
            after = rows[-1]["isin"]

    targets: list[str] = []
    page, size = 0, 1000
    while True:
        rows = (client.table("investissement_funds").select("isin")
                .eq("product_type", "opcvm").not_.like("isin", "CSSF%")
                .order("isin").range(page * size, page * size + size - 1)
                .execute().data or [])
        if not rows:
            break
        for r in rows:
            isin = (r.get("isin") or "").strip()
            # Vrai ISIN (2 lettres + 9 alphanum + 1 chiffre), pas déjà vu, suspect.
            if len(isin) != 12 or not isin[:2].isalpha():
                continue
            if isin in cached or isin in priced:
                continue
            targets.append(isin)
            if limit and len(targets) >= limit:
                return targets
        if len(rows) < size:
            break
        page += 1
    return targets


# ─── OpenFIGI ──────────────────────────────────────────────────────────────────

def classify_batch(isins: list[str], max_retries: int = 4) -> dict[str, str | None]:
    """{isin: securityType2|None} pour un lot d'ISIN via OpenFIGI (respecte 429)."""
    payload = [{"idType": "ID_ISIN", "idValue": i} for i in isins]
    for attempt in range(max_retries):
        try:
            r = requests.post(MAPPING_URL, headers=HEADERS, json=payload, timeout=TIMEOUT)
        except requests.RequestException:
            time.sleep(2 ** attempt)
            continue
        if r.status_code == 429:
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code != 200:
            time.sleep(2 ** attempt)
            continue
        out: dict[str, str | None] = {}
        for isin, entry in zip(isins, r.json()):
            data = entry.get("data") if isinstance(entry, dict) else None
            out[isin] = (data[0].get("securityType2") if data else None)
        return out
    return {i: None for i in isins}


# ─── Run ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, include_priced: bool,
        batch: int = DEFAULT_BATCH, sleep_s: float = DEFAULT_SLEEP):
    print("=" * 64)
    print("  OpenFIGI Classify — titres vifs mal classés 'opcvm' → 'action'")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'} | clé API : {'oui' if API_KEY else 'non (bridé)'}")

    started = datetime.now(timezone.utc)
    client = get_client()
    print("  Sélection des cibles (opcvm vrai-ISIN non cachés)…", flush=True)
    targets = select_targets(client, limit, include_priced)
    print(f"  {len(targets)} ISIN à classifier (lots de {batch})\n")

    cache_rows: list[dict] = []
    reclass: list[dict] = []
    types_count: dict[str, int] = {}

    for i in range(0, len(targets), batch):
        chunk = targets[i:i + batch]
        res = classify_batch(chunk)
        for isin, st2 in res.items():
            cache_rows.append({"isin": isin, "security_type2": st2, "checked_at": now_iso()})
            key = st2 or "(inconnu)"
            types_count[key] = types_count.get(key, 0) + 1
            if st2 in STOCK_TYPES:
                reclass.append({"isin": isin, "product_type": "action"})
        done = min(i + batch, len(targets))
        if done % (batch * 10) == 0 or done == len(targets):
            print(f"  [{done:5d}/{len(targets)}] actions détectées : {len(reclass)}", flush=True)
        time.sleep(sleep_s)

    print(f"\n  Types rencontrés : "
          + ", ".join(f"{k}:{v}" for k, v in sorted(types_count.items(), key=lambda x: -x[1])[:8]))
    print(f"  → {len(reclass)} titres vifs à reclasser 'opcvm' → 'action'")

    if apply:
        # Cache de TOUT ce qui a été checké (fonds confirmés inclus → plus re-checkés).
        for j in range(0, len(cache_rows), 500):
            try:
                client.table(CACHE_TABLE).upsert(cache_rows[j:j + 500], on_conflict="isin").execute()
            except Exception as e:
                print(f"  ⚠️  écriture cache (lot {j//500+1}) : {e}")
        if reclass:
            ok, fail = update_funds_bulk(reclass)
            print(f"  ✓ {ok} reclassés en 'action' ({fail} échecs)")
        log_run("openfigi-classify", "success", records_processed=len(reclass),
                records_failed=0, started_at=started)
    else:
        print("  [dry-run] relancer avec --apply pour écrire (cache + reclassement).")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Détecte les titres vifs mal classés opcvm via OpenFIGI")
    ap.add_argument("--apply", action="store_true", help="Écrire (cache + reclassement)")
    ap.add_argument("--limit", type=int, help="Limiter à N ISIN")
    ap.add_argument("--all", dest="include_priced", action="store_true",
                    help="Inclure aussi les opcvm avec série de prix (par défaut : sans prix only)")
    ap.add_argument("--batch", type=int, default=DEFAULT_BATCH, help="Taille de lot OpenFIGI")
    ap.add_argument("--delay", type=float, default=DEFAULT_SLEEP, help="Pause entre lots (s)")
    a = ap.parse_args()
    sys.exit(run(apply=a.apply, limit=a.limit, include_priced=a.include_priced,
                 batch=a.batch, sleep_s=a.delay))
