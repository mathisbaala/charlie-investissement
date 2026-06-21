#!/usr/bin/env python3
"""
prune-stale-av-eligibility.py — Purge des liens d'éligibilité AV périmés (Tier 4)
==================================================================================
Wrapper de la RPC SQL inv_prune_stale_av_eligibility (cf. migration
20260621180000). Le modèle av_lux_eligibility est upsert-only → un lien
(isin, contrat) reste quand l'assureur retire l'UC. Cette étape « délistе » les
liens CONFIRMÉS périmés (non revus depuis ≥ STALE_DAYS jours, dans un contrat
encore activement scrapé), avec une garde anti-scraper-cassé.

SÛRETÉ : conservateur par construction (un faux négatif — masquer une UC valide —
est pire qu'un lien un peu vieux). Ne supprime jamais sur une variance d'un seul
scrape. À lancer EN FIN d'orchestrateur, AVANT le refresh de la matview.

Usage :
    python3 scripts/enrichers/prune-stale-av-eligibility.py            # dry-run (rapport)
    python3 scripts/enrichers/prune-stale-av-eligibility.py --apply    # purge réelle
"""

import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

STALE_DAYS = 100  # lien non revu depuis ≥100 j (≈ ≥1 cycle trimestriel manqué) = délistage confirmé


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="exécute la purge (sinon dry-run / rapport)")
    ap.add_argument("--stale-days", type=int, default=STALE_DAYS)
    args = ap.parse_args()

    started = datetime.now(timezone.utc)
    client = get_client()

    resp = client.rpc("inv_prune_stale_av_eligibility", {
        "p_apply": bool(args.apply),
        "p_stale_days": args.stale_days,
    }).execute()
    report = resp.data or {}

    print(f"  {'APPLY' if args.apply else 'DRY-RUN'} — délistage éligibilité AV")
    print(f"  {json.dumps(report, ensure_ascii=False)}")

    pruned   = report.get("links_pruned", 0)
    skipped  = report.get("contracts_skipped_partial", 0)
    if skipped:
        print(f"  ⚠️  {skipped} contrat(s) NON purgé(s) (garde anti-scraper-cassé) — voir skipped_detail")

    if args.apply:
        log_run("prune-stale-av-eligibility", "success", pruned, 0, started_at=started)
        print(f"  ✓ {pruned} lien(s) périmé(s) purgé(s) sur {report.get('contracts_pruned', 0)} contrat(s)")
    else:
        print(f"  (dry-run) {pruned} lien(s) seraient purgés — relancer avec --apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
