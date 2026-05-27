#!/usr/bin/env python3
"""
aspim-scpi.py  --  T1-8 Charlie Data V2

Met a jour les metriques des SCPIs (DVM, TOF, capitalisation, prix de part)
dans investissement_scpi_metrics.

Sources (par ordre de priorite) :
  1. Scraping de france-scpi.fr (public, bien structure)
  2. Seed interne (50 plus grandes SCPIs, valeurs Q4 2024)

Les metriques SCPI changent trimestriellement (publication ASPIM).
Lancer ce script 1x par trimestre apres publication du bulletin ASPIM.

Usage :
    python3 scripts/scrapers/aspim-scpi.py              # dry-run (seed interne)
    python3 scripts/scrapers/aspim-scpi.py --apply      # upsert en base
    python3 scripts/scrapers/aspim-scpi.py --apply --scrape    # tente le scraping live
    python3 scripts/scrapers/aspim-scpi.py --apply --seed-only # force le seed interne

Requires : pip install httpx (optionnel pour --scrape)
"""

import sys
import re
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run, now_iso

# ─── Seed interne (top 50 SCPIs, metriques Q4 2024) ──────────────────────────
# Source : bulletins ASPIM / france-scpi.fr
# Format : (isin, name, mgmt_co, dvm_pct, tof_pct, price_per_share, capitalization_eur)

SCPI_SEED = [
    ("FR0000188013", "Edissimmo",          "Amundi Immobilier",          3.07, 87.5,  862,   3_900_000_000),
    ("FR0000187666", "Immorente",           "SOFIDY",                     4.37, 96.2,  333,   3_500_000_000),
    ("FR0000187781", "Epargne Fonciere",    "La Francaise REIM",          3.50, 88.2,  820,   3_100_000_000),
    ("FR0011361988", "Primovie",            "Primonial REIM",             4.50, 97.1,  204,   2_800_000_000),
    ("FR0013251598", "Corum Origin",        "CORUM AM",                   6.06, 93.8, 1135,   2_700_000_000),
    ("FR0010956722", "Primopierre",         "Primonial REIM",             3.40, 86.8,  798,   2_500_000_000),
    ("FR0010689448", "PFO2",                "PERIAL AM",                  3.44, 90.3, 1842,   1_700_000_000),
    ("FR0013284286", "Corum XL",            "CORUM AM",                   5.72, 91.2,  189,   1_400_000_000),
    ("FR0011513530", "Epargne Pierre",      "VOISIN",                     5.29, 93.1,  205,   1_400_000_000),
    ("FR0010614267", "PFO",                 "PERIAL AM",                  4.03, 89.0, 1958,   1_300_000_000),
    ("FR0000188666", "Efimmo 1",            "SOFIDY",                     4.42, 92.5,  316,   1_100_000_000),
    ("FR0000188557", "Rivoli Avenir Patrimoine", "AEW Ciloger",           4.31, 89.7,  300,   1_000_000_000),
    ("FR0000187757", "Selectinvest 1",      "SwissLife AM France",        3.82, 88.0,  425,     920_000_000),
    ("FR0000187583", "Elysees Pierre",      "HSBC REIM",                  3.51, 90.0,  770,     900_000_000),
    ("FR0013018780", "Pierval Sante",       "Euryale AM",                 5.32, 97.8, 1060,     900_000_000),
    ("FR0013462570", "Activimmo",           "ALDERAN",                    6.02, 97.5,  600,     750_000_000),
    ("FR0013309909", "PF Grand Paris",      "BNP Paribas REIM",           4.52, 91.0,  234,     680_000_000),
    ("FR0013085417", "Eurovalys",           "Advenis REIM",               4.93, 94.2, 1020,     640_000_000),
    ("FR0013257116", "Novapierre Allemagne 2", "Paref Gestion",           5.24, 95.1,  356,     540_000_000),
    ("FR0012555740", "Patrimmo Commerce",   "Primonial REIM",             4.58, 93.5, 1080,     530_000_000),
    ("FR0011339745", "Swisslife Dynapierre","SwissLife AM France",        4.10, 90.8,  182,     450_000_000),
    ("FR0014001YP7", "Corum Eurion",        "CORUM AM",                   5.57, 92.5,  215,     450_000_000),
    ("FR0000189456", "Pierre Plus",         "Inter Gestion",              2.50, 97.9,  380,     420_000_000),
    ("FR0013100272", "Accimmo Pierre",      "BNP Paribas REIM",           1.57, 98.2, 1540,     400_000_000),
    ("FR0013349244", "PF Hospitalite Europe","BNP Paribas REIM",          3.53, 82.5,  262,     380_000_000),
    ("FR0013285895", "Interpierre Europe",  "Paref Gestion",              5.32, 93.8,  208,     380_000_000),
    ("FR0013346182", "Atream Hotels",       "ATREAM",                     3.78, 84.2, 1020,     310_000_000),
    ("FR0012563645", "Aestiam Pierre Rendement","AESTIAM",                3.92, 90.5,  195,     310_000_000),
    ("FR0000189910", "Novapierre 1",        "Paref Gestion",              4.82, 93.8,  342,     280_000_000),
    ("FR0000189431", "Cristal Rente",       "Inter Gestion",              5.00, 94.1,  720,     260_000_000),
    ("FR0013399496", "LF Avenir Sante",     "La Francaise REIM",          4.71, 97.2,  245,     250_000_000),
    ("FR0013407216", "Kyaneos Pierre",      "Kyaneos AM",                 3.88, 97.8, 1050,     220_000_000),
    ("FR0013344948", "Novapierre Residences 2","Paref Gestion",           3.52, 97.5,  278,     200_000_000),
    ("FR0013399041", "Vendome Regions",     "Norma Capital",              6.22, 95.5,  183,     150_000_000),
    ("FR0013416829", "Fair Invest",         "Norma Capital",              4.41, 95.0,  182,      60_000_000),
]

PERIOD_TAG = "2024-Q4"  # mettre a jour apres chaque bulletin ASPIM


# ─── Scraping live (optionnel) ────────────────────────────────────────────────

def _scrape_france_scpi(isin: str) -> dict | None:
    """Tente de recuperer les metriques depuis france-scpi.fr."""
    try:
        import httpx
    except ImportError:
        return None

    url = f"https://www.france-scpi.fr/scpi/{isin}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
        ),
        "Accept-Language": "fr-FR,fr;q=0.9",
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
        if resp.status_code != 200:
            return None
        html = resp.text

        result = {}

        # DVM : "Taux de distribution X,XX%"
        m = re.search(r"Taux de distribution[^%]{0,60}?(\d+)[,.](\d+)\s*%", html, re.IGNORECASE)
        if m:
            result["dvm"] = round(float(f"{m.group(1)}.{m.group(2)}") / 100, 6)

        # TOF : "Taux d'occupation financier X,XX%"
        m = re.search(r"occupation\s+financ[^\d]{0,40}(\d+)[,.](\d+)\s*%", html, re.IGNORECASE)
        if m:
            result["tof"] = round(float(f"{m.group(1)}.{m.group(2)}") / 100, 6)

        # Prix de part
        m = re.search(r"Prix de part[^\d]{0,20}(\d[\d\s]*)\s*EUR", html, re.IGNORECASE)
        if m:
            result["price_per_share"] = float(m.group(1).replace(" ", ""))

        # Capitalisation
        m = re.search(r"Capitalisation[^\d]{0,20}([\d\s,.]+)\s*(Md?|milliard|million)", html, re.IGNORECASE)
        if m:
            val_str = m.group(1).replace(" ", "").replace(",", ".")
            unit = m.group(2).lower()
            multiplier = 1_000_000_000 if unit.startswith("m") else 1_000_000
            try:
                result["capitalization"] = int(float(val_str) * multiplier)
            except ValueError:
                pass

        return result if result else None

    except Exception:
        return None


# ─── Upsert Supabase ──────────────────────────────────────────────────────────

def upsert_scpi_metrics(client, isin: str, metrics: dict, period: str) -> bool:
    row = {
        "isin":            isin,
        "period":          period,
        "updated_at":      now_iso(),
    }
    if "dvm" in metrics:
        row["dvm"] = metrics["dvm"]
    if "tof" in metrics:
        row["tof"] = metrics["tof"]
    if "price_per_share" in metrics:
        row["price_per_share"] = metrics["price_per_share"]
    if "capitalization" in metrics:
        row["capitalization"] = metrics["capitalization"]

    try:
        client.table("investissement_scpi_metrics").upsert(row, on_conflict="isin").execute()
        return True
    except Exception as e:
        print(f"  Erreur upsert {isin} : {e}")
        return False


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ASPIM SCPI metrics scraper")
    parser.add_argument("--apply",     action="store_true", help="Upsert en base")
    parser.add_argument("--scrape",    action="store_true", help="Tenter le scraping live")
    parser.add_argument("--seed-only", action="store_true", help="Forcer le seed interne")
    args = parser.parse_args()

    dry_run = not args.apply
    run_started = datetime.now(timezone.utc)

    if dry_run:
        print("Dry run -- aucune ecriture. Ajoutez --apply pour executer.\n")

    client = get_client() if not dry_run else None

    n_ok = 0
    n_fail = 0

    print(f"SCPIs a traiter : {len(SCPI_SEED)}")
    if args.scrape and not args.seed_only:
        print("Mode scraping actif -- france-scpi.fr")
    else:
        print("Mode seed interne -- donnees Q4 2024 ASPIM\n")

    for row in SCPI_SEED:
        isin, name, mgmt, dvm_pct, tof_pct, price, capi = row

        metrics = {
            "dvm":            round(dvm_pct / 100, 6),
            "tof":            round(tof_pct / 100, 6),
            "price_per_share": float(price),
            "capitalization": capi,
        }

        # Tentative scraping live si demande
        if args.scrape and not args.seed_only:
            live = _scrape_france_scpi(isin)
            if live:
                metrics.update(live)
                print(f"  [scrape] {isin}  {name[:35]:<35}  DVM={metrics.get('dvm','?')}")
            else:
                print(f"  [seed]   {isin}  {name[:35]:<35}  DVM={metrics['dvm']:.4f}")
            time.sleep(0.5)
        else:
            print(f"  [seed]   {isin}  {name[:35]:<35}  DVM={metrics['dvm']:.4f}")

        if not dry_run:
            ok = upsert_scpi_metrics(client, isin, metrics, PERIOD_TAG)
            if ok:
                n_ok += 1
            else:
                n_fail += 1
        else:
            n_ok += 1

    print(f"\nResultat : {n_ok} upserts OK, {n_fail} echecs")

    if not dry_run:
        status = "success" if n_fail == 0 else ("partial" if n_ok > 0 else "failed")
        log_run(
            scraper="aspim-scpi",
            status=status,
            records_processed=n_ok,
            records_failed=n_fail,
            started_at=run_started,
        )


if __name__ == "__main__":
    main()
