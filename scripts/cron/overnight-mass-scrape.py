#!/usr/bin/env python3
"""
overnight-mass-scrape.py — Orchestrateur nocturne complet
==========================================================
Lance tous les scrapers dans l'ordre optimal pour maximiser la couverture
de la base de données. Conçu pour tourner toute la nuit sans supervision.

Ordre d'exécution :
  Phase 1 : Collecte des fonds (base)
    1a. AMF GECO OPCVM complet (FR)
    1b. AMF GECO OPCVM étrangers (LU, IE)
    1c. Euronext ETF (CSV officiel)
    1d. JustETF (2500+ ETFs européens)
    1e. GECO Real Estate (SCPI/OPCI/SCI)
    1f. SCPI Full Scraper (france-scpi.fr)

  Phase 2 : Enrichissement
    2a. SFDR depuis GECO
    2b. SFDR heuristique (remplir les blancs)
    2c. TER / frais courants (FundInfo + Boursorama)
    2d. KID URLs (Amundi, Carmignac, BNP, FundInfo)
    2e. Linxea AV catalog (UC assurance-vie)
    2f. Morningstar enhanced (notations + performances)

  Phase 3 : Historiques de prix
    3a. Yahoo Finance (tous les OPCVM + ETF)
    3b. GECO NAV (fallback pour fonds non couverts Yahoo)

  Phase 4 : Métriques
    4a. KID Bulk Parser (TER + SRI depuis PDFs)
    4b. Compute Metrics (Sharpe, vol, performances)

Usage :
    python3 scripts/cron/overnight-mass-scrape.py
    python3 scripts/cron/overnight-mass-scrape.py --skip-prices  (éviter phase 3)
    python3 scripts/cron/overnight-mass-scrape.py --phase 2  (reprendre à la phase 2)
"""

import sys
import time
import argparse
import subprocess
import traceback
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent
ROOT        = SCRIPTS_DIR.parent

sys.path.insert(0, str(SCRIPTS_DIR))
from db import get_client, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

LOG_FILE = ROOT / "logs" / "overnight-mass-scrape.log"


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def run_script(name: str, args: list[str] | None = None, timeout_minutes: int = 120) -> tuple[int, str]:
    """Lance un script Python avec --apply et retourne (returncode, output_summary)."""
    cmd = [sys.executable, str(SCRIPTS_DIR / name), "--apply"] + (args or [])
    log(f"  → Lancement : {name} {' '.join(args or [])}")
    start = time.time()
    try:
        result = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=timeout_minutes * 60,
        )
        elapsed = time.time() - start
        # Extraire les lignes importantes du stdout
        lines = result.stdout.strip().split("\n")
        summary_lines = [l for l in lines if any(x in l for x in ["✓", "✗", "→", "Total", "Upsert", "OK", "échec", "fonds"])]
        summary = " | ".join(summary_lines[-3:]) if summary_lines else lines[-1] if lines else ""
        status = "✓" if result.returncode == 0 else "✗"
        log(f"  {status} {name} terminé en {elapsed:.0f}s — {summary[:120]}")
        if result.returncode != 0 and result.stderr:
            err_lines = result.stderr.strip().split("\n")
            log(f"    STDERR: {err_lines[-1][:120]}")
        return result.returncode, summary
    except subprocess.TimeoutExpired:
        log(f"  ✗ {name} TIMEOUT après {timeout_minutes} minutes")
        return -1, "TIMEOUT"
    except Exception as e:
        log(f"  ✗ {name} EXCEPTION: {e}")
        return -2, str(e)


def get_db_stats() -> dict:
    """Récupère les statistiques actuelles de la base."""
    try:
        client = get_client()
        stats = {}
        for pt in ["opcvm", "etf", "scpi", "opci", "sci"]:
            r = client.table("investissement_funds").select("isin", count="exact").eq("product_type", pt).execute()
            stats[pt] = r.count or 0
        r = client.table("investissement_funds").select("isin", count="exact").not_.is_("ongoing_charges", "null").execute()
        stats["with_ter"] = r.count or 0
        r = client.table("investissement_funds").select("isin", count="exact").not_.is_("sfdr_article", "null").execute()
        stats["with_sfdr"] = r.count or 0
        r = client.table("investissement_funds").select("isin", count="exact").not_.is_("kid_url", "null").execute()
        stats["with_kid_url"] = r.count or 0
        r = client.table("investissement_funds").select("isin", count="exact").gte("data_completeness", 50).execute()
        stats["completeness_50plus"] = r.count or 0
        r = client.table("investissement_fund_prices").select("isin", count="exact").execute()
        stats["price_rows"] = r.count or 0
        return stats
    except Exception as e:
        log(f"  ⚠ get_db_stats échoué : {e}")
        return {}


def print_stats(label: str, stats: dict):
    log(f"\n  === {label} ===")
    log(f"  OPCVM:{stats.get('opcvm',0)} | ETF:{stats.get('etf',0)} | SCPI:{stats.get('scpi',0)} | OPCI:{stats.get('opci',0)}")
    log(f"  TER:{stats.get('with_ter',0)} | SFDR:{stats.get('with_sfdr',0)} | KID:{stats.get('with_kid_url',0)} | Complétude≥50:{stats.get('completeness_50plus',0)}")
    log(f"  Lignes de prix:{stats.get('price_rows',0):,}")
    log("")


# ─── Phases ───────────────────────────────────────────────────────────────────

def phase1_collect_funds():
    """Phase 1 : Collecte des fonds."""
    log("=" * 60)
    log("  PHASE 1 : COLLECTE DES FONDS")
    log("=" * 60)

    # 1a. AMF GECO complet (FR uniquement)
    log("\n  [1a] AMF GECO — OPCVM France")
    run_script("scrapers/amf-geco-full.py", timeout_minutes=90)

    # 1b. AMF GECO — OPCVM étrangers (LU, IE)
    log("\n  [1b] AMF GECO — OPCVM Luxembourg + Irlande")
    run_script("scrapers/amf-geco-foreign.py", timeout_minutes=90)

    # 1c. Euronext ETF (CSV officiel)
    log("\n  [1c] Euronext ETF — CSV officiel")
    run_script("scrapers/euronext-etf.py", ["--market", "ALL"], timeout_minutes=15)

    # 1d. JustETF
    log("\n  [1d] JustETF — ETFs européens")
    run_script("scrapers/justetf-scraper.py", ["--country", "FR"], timeout_minutes=60)

    # 1e. GECO Real Estate
    log("\n  [1e] GECO Real Estate — SCPI/OPCI/SCI")
    run_script("scrapers/geco-realestate.py", timeout_minutes=60)

    # 1f. SCPI Full Scraper
    log("\n  [1f] SCPI Full Scraper — france-scpi.fr + meilleuresscpi.com")
    run_script("scrapers/scpi-full-scraper.py", timeout_minutes=30)

    # 1g. ASPIM SCPI avec scraping live
    log("\n  [1g] ASPIM SCPI — seed + scraping live")
    run_script("scrapers/aspim-scpi.py", ["--scrape"], timeout_minutes=20)

    # 1h. Linxea AV catalog
    log("\n  [1h] Linxea — catalogue UC assurance-vie")
    run_script("scrapers/linxea-av-catalog.py", timeout_minutes=30)


def phase2_enrich():
    """Phase 2 : Enrichissement des données."""
    log("=" * 60)
    log("  PHASE 2 : ENRICHISSEMENT")
    log("=" * 60)

    # 2a. SFDR depuis GECO
    log("\n  [2a] SFDR Enricher — source GECO")
    run_script("scrapers/sfdr-enricher.py", ["--source", "geco"], timeout_minutes=60)

    # 2b. SFDR heuristique
    log("\n  [2b] SFDR Enricher — heuristique (remplir les blancs)")
    run_script("scrapers/sfdr-enricher.py", ["--heuristic"], timeout_minutes=30)

    # 2c. TER / frais courants
    log("\n  [2c] Fetch TER — FundInfo + Boursorama + Morningstar")
    run_script("scrapers/fetch-ter-fundinfo.py", timeout_minutes=180)

    # 2d. KID URLs
    log("\n  [2d] KID URL Finder — AMF + Amundi + BNP + FundInfo")
    run_script("scrapers/kid-url-finder.py", timeout_minutes=180)

    # 2e. Morningstar enhanced
    log("\n  [2e] Morningstar Enhanced — notations + performances")
    run_script("scrapers/morningstar-enhanced.py", timeout_minutes=120)


def phase3_prices():
    """Phase 3 : Historiques de prix."""
    log("=" * 60)
    log("  PHASE 3 : HISTORIQUES DE PRIX")
    log("=" * 60)

    # 3a. Yahoo Finance
    log("\n  [3a] Yahoo Finance NAV — VL historiques 5 ans")
    run_script("scrapers/fetch-nav-yahoo.py", timeout_minutes=300)

    # 3b. GECO NAV (fallback)
    log("\n  [3b] GECO NAV — fallback pour fonds non couverts Yahoo")
    run_script("scrapers/fetch-nav-geco.py", ["--missing-only"], timeout_minutes=300)


def phase4_metrics():
    """Phase 4 : Calcul des métriques."""
    log("=" * 60)
    log("  PHASE 4 : MÉTRIQUES")
    log("=" * 60)

    # 4a. KID Bulk Parser
    log("\n  [4a] KID Bulk Parser — extraction TER/SRI depuis PDFs")
    run_script("scrapers/kid-bulk-parser.py", ["--llm", "--min-aum", "10000000"], timeout_minutes=180)

    # 4b. Compute Metrics
    log("\n  [4b] Compute Metrics — Sharpe, volatilité, performances")
    run_script("enrichers/compute-metrics.py", timeout_minutes=60)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Orchestrateur nocturne de scraping")
    parser.add_argument("--skip-prices",  action="store_true", help="Ignorer la phase 3 (prix)")
    parser.add_argument("--skip-collect", action="store_true", help="Ignorer la phase 1 (collecte)")
    parser.add_argument("--phase",        type=int,            help="Commencer à la phase N (1-4)")
    parser.add_argument("--only-phase",   type=int,            help="Exécuter uniquement la phase N")
    args = parser.parse_args()

    started = datetime.now(timezone.utc)
    start_phase = args.phase or 1
    only_phase  = args.only_phase

    log("=" * 60)
    log(f"  OVERNIGHT MASS SCRAPE — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log("=" * 60)

    # Stats initiales
    stats_before = get_db_stats()
    print_stats("ÉTAT INITIAL", stats_before)

    try:
        if only_phase == 1 or (not only_phase and start_phase <= 1 and not args.skip_collect):
            phase1_collect_funds()
            print_stats("APRÈS PHASE 1", get_db_stats())

        if only_phase == 2 or (not only_phase and start_phase <= 2):
            phase2_enrich()
            print_stats("APRÈS PHASE 2", get_db_stats())

        if only_phase == 3 or (not only_phase and start_phase <= 3 and not args.skip_prices):
            phase3_prices()
            print_stats("APRÈS PHASE 3", get_db_stats())

        if only_phase == 4 or (not only_phase and start_phase <= 4):
            phase4_metrics()
            print_stats("APRÈS PHASE 4", get_db_stats())

    except KeyboardInterrupt:
        log("\n  ⚠ Interruption manuelle (Ctrl+C)")
    except Exception as e:
        log(f"\n  ✗ Erreur inattendue : {e}")
        traceback.print_exc()

    # Stats finales
    stats_after = get_db_stats()
    elapsed_min = (datetime.now(timezone.utc) - started).total_seconds() / 60

    log("=" * 60)
    log(f"  RÉSUMÉ FINAL — {elapsed_min:.0f} minutes")
    log("=" * 60)
    log(f"  OPCVM:  {stats_before.get('opcvm',0)} → {stats_after.get('opcvm',0)} (+{stats_after.get('opcvm',0)-stats_before.get('opcvm',0)})")
    log(f"  ETF:    {stats_before.get('etf',0)} → {stats_after.get('etf',0)} (+{stats_after.get('etf',0)-stats_before.get('etf',0)})")
    log(f"  SCPI:   {stats_before.get('scpi',0)} → {stats_after.get('scpi',0)} (+{stats_after.get('scpi',0)-stats_before.get('scpi',0)})")
    log(f"  TER:    {stats_before.get('with_ter',0)} → {stats_after.get('with_ter',0)} (+{stats_after.get('with_ter',0)-stats_before.get('with_ter',0)})")
    log(f"  SFDR:   {stats_before.get('with_sfdr',0)} → {stats_after.get('with_sfdr',0)} (+{stats_after.get('with_sfdr',0)-stats_before.get('with_sfdr',0)})")
    log(f"  KID:    {stats_before.get('with_kid_url',0)} → {stats_after.get('with_kid_url',0)} (+{stats_after.get('with_kid_url',0)-stats_before.get('with_kid_url',0)})")
    log(f"  Prix:   {stats_before.get('price_rows',0):,} → {stats_after.get('price_rows',0):,}")
    log("")
    log("  ✓ Pipeline overnight terminé")

    try:
        log_run(
            scraper="overnight-mass-scrape",
            status="success",
            records_processed=stats_after.get("opcvm", 0) + stats_after.get("etf", 0),
            started_at=started,
        )
    except Exception:
        pass


if __name__ == "__main__":
    main()
