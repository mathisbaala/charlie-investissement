#!/usr/bin/env python3
"""
fetch-etf-extended.py

Étend la liste ETF de 51 → ~200 fonds.
Ajoute les nouveaux ETFs avec leurs métadonnées, puis tente de récupérer
les données de prix réelles depuis Yahoo Finance.

Usage:
  python3 scripts/fetch-etf-extended.py [--dry-run]

Le script:
  1. Charge src/data/etfs.json
  2. Filtre les ISINs non présents (évite doublons)
  3. Tente de récupérer les prix + métriques via yfinance
  4. Upsert dans etfs.json
"""

import json
import math
import sys
import time
import warnings
from datetime import datetime, timedelta
from pathlib import Path

warnings.filterwarnings("ignore")

try:
    import yfinance as yf
except ImportError:
    print("❌  yfinance not installed. Run: pip install yfinance")
    sys.exit(1)

ROOT       = Path(__file__).parent.parent
ETFS_PATH  = ROOT / "src" / "data" / "etfs.json"
PRICES_DIR = ROOT / "public" / "prices"
PRICES_DIR.mkdir(parents=True, exist_ok=True)

DRY_RUN = "--dry-run" in sys.argv

try:
    sys.path.insert(0, str(Path(__file__).parent))
    from db import get_ecb_rate as _get_ecb_rate, upsert_fund, upsert_prices, log_run
    RISK_FREE_RATE = _get_ecb_rate()
    _DB_AVAILABLE = True
except Exception:
    RISK_FREE_RATE = 0.035
    _DB_AVAILABLE = False


def _etf_to_supabase_row(etf: dict) -> dict:
    """Mappe les clés camelCase de etf_record → snake_case Supabase."""
    return {
        "isin":               etf["isin"],
        "name":               etf["name"],
        "product_type":       etf.get("productType", "etf"),
        "management_company": etf.get("managementCompany"),
        "category":           etf.get("category"),
        "asset_class":        etf.get("assetClass"),
        "region_exposure":    etf.get("regionExposure"),
        "currency":           etf.get("currency", "EUR"),
        "hedged":             etf.get("hedged", False),
        "inception_date":     etf.get("inceptionDate"),
        "track_record_years": etf.get("trackRecordYears"),
        "risk_level":         etf.get("riskLevel"),
        "pea_eligible":       etf.get("peaEligible", False),
        "distributor_france": etf.get("distributorFrance", True),
        "srri":               etf.get("srri"),
        "aum_eur":            etf.get("aumEur"),
        "morningstar_rating": etf.get("morningstarRating"),
        "ongoing_charges":    etf.get("ter"),
        "data_source":        etf.get("dataSource", "yahoo-finance"),
        "performance_1y":     etf.get("performance1Y"),
        "performance_3y":     etf.get("performance3YAnnualized"),
        "performance_5y":     etf.get("performance5YAnnualized"),
        "average_performance":etf.get("averagePerformance"),
        "volatility_1y":      etf.get("volatility1Y"),
        "volatility_3y":      etf.get("volatility3Y"),
        "sharpe_1y":          etf.get("sharpe1Y"),
        "sharpe_3y":          etf.get("sharpe3Y"),
        "max_drawdown_1y":    etf.get("maxDrawdown1Y"),
        "max_drawdown_3y":    etf.get("maxDrawdown3Y"),
    }

# ─── Catalogue étendu d'ETFs ──────────────────────────────────────────────────
# Format: (ISIN, yahoo_ticker, name, mgmt_co, category, asset_class,
#          region, ter, index, replication, dividend_policy, exchange)

NEW_ETF_CATALOG = [
    # ── MONDE DÉVELOPPÉ ───────────────────────────────────────────────────────
    ("IE00B3RBWM25", "VWRL.AS",   "Vanguard FTSE All-World UCITS ETF (USD) Distributing",  "Vanguard",                   "Actions Monde",           "actions",    "global",   "EUR", False, 0.22, "FTSE All-World",           "physical",   "distribution",  "EPA"),
    ("LU1781541179", "LCWI.PA",   "Amundi Index MSCI World UCITS ETF DR EUR (C)",            "Amundi Asset Management",    "Actions Monde",           "actions",    "global",   "EUR", False, 0.12, "MSCI World",               "physical",   "accumulation",  "EPA"),
    ("IE00BF4RFH31", "IUSN.DE",   "iShares MSCI World Small Cap UCITS ETF (Acc)",            "BlackRock",                  "Actions Monde (Small Cap)","actions",    "global",   "USD", False, 0.35, "MSCI World Small Cap",     "physical",   "accumulation",  "XETR"),
    ("IE00BFY0GT14", "SWRD.PA",   "SPDR MSCI World UCITS ETF (Acc)",                         "State Street SPDR",          "Actions Monde",           "actions",    "global",   "USD", False, 0.12, "MSCI World",               "physical",   "accumulation",  "EPA"),
    ("IE00B4X9L533", "HMWO.PA",   "HSBC MSCI World UCITS ETF USD (Acc)",                     "HSBC Asset Management",      "Actions Monde",           "actions",    "global",   "USD", False, 0.15, "MSCI World",               "physical",   "accumulation",  "EPA"),

    # ── ÉTATS-UNIS ────────────────────────────────────────────────────────────
    ("IE00BFMXXD54", "VUAA.PA",   "Vanguard S&P 500 UCITS ETF EUR (Acc)",                    "Vanguard",                   "Actions USA",             "actions",    "usa",      "EUR", False, 0.07, "S&P 500",                  "physical",   "accumulation",  "EPA"),
    ("IE00B3XXRP09", "VUSA.PA",   "Vanguard S&P 500 UCITS ETF USD (Dist)",                   "Vanguard",                   "Actions USA",             "actions",    "usa",      "USD", False, 0.07, "S&P 500",                  "physical",   "distribution",  "EPA"),
    ("IE00B53SZB19", "CNDX.PA",   "iShares NASDAQ 100 UCITS ETF (Acc)",                       "BlackRock",                  "Actions USA Tech",        "actions",    "usa",      "USD", False, 0.33, "NASDAQ-100",               "physical",   "accumulation",  "EPA"),
    ("FR0011871128", "SP5.PA",    "Lyxor S&P 500 UCITS ETF - Dist",                          "Amundi Asset Management",    "Actions USA",             "actions",    "usa",      "USD", False, 0.09, "S&P 500",                  "synthetic",  "distribution",  "EPA"),
    ("IE00BYYHSQ67", "IUSA.PA",   "iShares Core S&P 500 UCITS ETF EUR Hdg (Acc)",            "BlackRock",                  "Actions USA (couvertes)",  "actions",    "usa",      "EUR", True,  0.20, "S&P 500 EUR Hedged",       "physical",   "accumulation",  "EPA"),
    ("IE00B2QWDY88", "IS3S.DE",   "iShares Core S&P 600 UCITS ETF (Acc)",                    "BlackRock",                  "Actions USA (Small Cap)", "actions",    "usa",      "USD", False, 0.25, "S&P 600 Small Cap",        "physical",   "accumulation",  "XETR"),
    ("LU1105786359", "TNO.PA",    "Amundi MSCI USA UCITS ETF EUR (D)",                       "Amundi Asset Management",    "Actions USA",             "actions",    "usa",      "EUR", False, 0.10, "MSCI USA",                 "synthetic",  "distribution",  "EPA"),
    ("LU1737652823", "USAC.PA",   "Amundi Russell 1000 Growth UCITS ETF EUR Acc",             "Amundi Asset Management",    "Actions USA (Croissance)", "actions",   "usa",      "EUR", False, 0.19, "Russell 1000 Growth",      "synthetic",  "accumulation",  "EPA"),

    # ── EUROPE ────────────────────────────────────────────────────────────────
    ("IE00B4K48X80", "IMAE.PA",   "iShares Core MSCI Europe UCITS ETF EUR (Acc)",             "BlackRock",                  "Actions Europe",          "actions",    "europe",   "EUR", False, 0.12, "MSCI Europe",              "physical",   "accumulation",  "EPA"),
    ("IE00B945VV12", "VEUR.PA",   "Vanguard FTSE Developed Europe UCITS ETF (Dist)",          "Vanguard",                   "Actions Europe",          "actions",    "europe",   "EUR", False, 0.10, "FTSE Developed Europe",    "physical",   "distribution",  "EPA"),
    ("FR0010261198", "MEUD.PA",   "Amundi EURO STOXX 50 UCITS ETF DR EUR (C)",                "Amundi Asset Management",    "Actions Europe Large Cap","actions",    "europe",   "EUR", False, 0.15, "EURO STOXX 50",            "synthetic",  "accumulation",  "EPA"),
    ("IE0031442068", "EUN2.PA",   "iShares STOXX Europe 50 UCITS ETF EUR (Acc)",              "BlackRock",                  "Actions Europe Large Cap","actions",    "europe",   "EUR", False, 0.35, "STOXX Europe 50",          "physical",   "accumulation",  "EPA"),
    ("LU1291104601", "CE9.PA",    "BNP Paribas Easy STOXX Europe 600 UCITS ETF EUR (C)",      "BNP Paribas AM",             "Actions Europe",          "actions",    "europe",   "EUR", False, 0.20, "STOXX Europe 600",         "physical",   "accumulation",  "EPA"),
    ("IE00B52MJD48", "IMIE.PA",   "iShares MSCI Europe Small Cap UCITS ETF EUR (Acc)",        "BlackRock",                  "Actions Europe (Small Cap)","actions",  "europe",   "EUR", False, 0.58, "MSCI Europe Small Cap",    "physical",   "accumulation",  "EPA"),
    ("LU1803724007", "PAEQ.PA",   "Amundi MSCI EMU ESG Leaders UCITS ETF DR EUR (C)",         "Amundi Asset Management",    "Actions Zone Euro ESG",   "actions",    "europe",   "EUR", False, 0.18, "MSCI EMU ESG Leaders",     "physical",   "accumulation",  "EPA"),
    ("FR0010655688", "PEAP.PA",   "Amundi MSCI Europe UCITS ETF - EUR (C) - PEA",             "Amundi Asset Management",    "Actions Europe (PEA)",    "actions",    "europe",   "EUR", False, 0.15, "MSCI Europe",              "synthetic",  "accumulation",  "EPA"),
    ("LU1390062784", "DXET.PA",   "Xtrackers DAX UCITS ETF 1C",                               "DWS / Xtrackers",            "Actions Allemagne",       "actions",    "europe",   "EUR", False, 0.09, "DAX",                      "synthetic",  "accumulation",  "EPA"),
    ("FR0013451432", "UKXG.PA",   "Amundi FTSE 100 UCITS ETF GBP (C)",                       "Amundi Asset Management",    "Actions Royaume-Uni",     "actions",    "europe",   "GBP", False, 0.15, "FTSE 100",                 "synthetic",  "accumulation",  "EPA"),
    ("LU1681043847", "LYMX.PA",   "Amundi MSCI Europe Momentum Factor UCITS ETF DR EUR (C)",  "Amundi Asset Management",    "Actions Europe (Momentum)","actions",   "europe",   "EUR", False, 0.23, "MSCI Europe Momentum",     "physical",   "accumulation",  "EPA"),

    # ── MARCHÉS ÉMERGENTS ────────────────────────────────────────────────────
    ("IE00B3VVMM84", "VFEA.PA",   "Vanguard FTSE Emerging Markets UCITS ETF (Acc)",           "Vanguard",                   "Actions Marchés Émergents","actions",   "emerging", "USD", False, 0.22, "FTSE Emerging Markets",    "physical",   "accumulation",  "EPA"),
    ("IE00B469F816", "SPYM.PA",   "SPDR MSCI Emerging Markets UCITS ETF (Acc)",               "State Street SPDR",          "Actions Marchés Émergents","actions",   "emerging", "USD", False, 0.42, "MSCI Emerging Markets",    "physical",   "accumulation",  "EPA"),
    ("LU0292107645", "XMEM.PA",   "Xtrackers MSCI Emerging Markets Swap UCITS ETF 1C",        "DWS / Xtrackers",            "Actions Marchés Émergents","actions",   "emerging", "USD", False, 0.20, "MSCI Emerging Markets",    "synthetic",  "accumulation",  "EPA"),
    ("LU1861218718", "AMEM.PA",   "Amundi MSCI Emerging Markets ESG Leaders UCITS ETF DR",    "Amundi Asset Management",    "Actions Marchés Émergents ESG","actions","emerging", "USD", False, 0.20, "MSCI EM ESG Leaders",      "physical",   "accumulation",  "EPA"),
    ("IE00BKM4GZ66", "EMIM.AS",   "iShares Core MSCI EM IMI UCITS ETF USD (Acc)",             "BlackRock",                  "Actions Marchés Émergents","actions",   "emerging", "USD", False, 0.18, "MSCI Emerging Markets IMI","physical",   "accumulation",  "EPA"),  # duplicate check - already in list

    # ── ASIE ──────────────────────────────────────────────────────────────────
    ("IE00B5L01S80", "CS3.PA",    "iShares MSCI AC Far East ex-Japan UCITS ETF USD (Acc)",    "BlackRock",                  "Actions Asie Pacifique",  "actions",    "japan",    "USD", False, 0.74, "MSCI AC Far East ex-Japan","physical",   "accumulation",  "EPA"),
    ("IE00B5VX7566", "CNJP.PA",   "iShares Core MSCI Japan IMI UCITS ETF USD (Acc)",          "BlackRock",                  "Actions Japon",           "actions",    "japan",    "USD", False, 0.15, "MSCI Japan IMI",           "physical",   "accumulation",  "EPA"),
    ("LU1437016480", "PRCN.PA",   "Amundi MSCI China UCITS ETF EUR (C)",                      "Amundi Asset Management",    "Actions Chine",           "actions",    "emerging", "EUR", False, 0.35, "MSCI China",               "physical",   "accumulation",  "EPA"),
    ("IE00B5VX7226", "CNXF.PA",   "iShares FTSE China 25 UCITS ETF USD (Dist)",               "BlackRock",                  "Actions Chine",           "actions",    "emerging", "USD", False, 0.74, "FTSE China 25",            "physical",   "distribution",  "EPA"),
    ("IE00BFXR7892", "CIND.PA",   "iShares MSCI India UCITS ETF USD (Acc)",                   "BlackRock",                  "Actions Inde",            "actions",    "emerging", "USD", False, 0.65, "MSCI India",               "physical",   "accumulation",  "EPA"),

    # ── OBLIGATIONS GOUVERNEMENTALES ─────────────────────────────────────────
    ("IE00B4WXJJ64", "CSBGE6.PA", "iShares Core Euro Government Bond UCITS ETF EUR (Dist)",   "BlackRock",                  "Obligations Europe Gouvernement","obligations","europe","EUR",False, 0.09, "Bloomberg Euro Govt Bond", "physical",   "distribution",  "EPA"),
    ("LU0484969463", "DBZB.PA",   "Xtrackers Eurozone Government Bond UCITS ETF 1C",          "DWS / Xtrackers",            "Obligations Zone Euro Gouvernement","obligations","europe","EUR",False, 0.15, "Bloomberg Eurozone Govt Bond","synthetic","accumulation","EPA"),
    ("IE00B3DKXQ41", "IEAG.PA",   "iShares Core Euro Aggregate Bond UCITS ETF EUR (Dist)",    "BlackRock",                  "Obligations Europe Aggregate","obligations","europe","EUR",False, 0.09, "Bloomberg Euro Aggregate", "physical",   "distribution",  "EPA"),
    ("IE00B14X4S71", "IEGY.PA",   "iShares Euro Government Bond 7-10yr UCITS ETF EUR (Dist)", "BlackRock",                  "Obligations Europe 7-10 ans","obligations","europe","EUR",False, 0.20, "Bloomberg Euro Govt 7-10Y","physical",   "distribution",  "EPA"),
    ("IE00BZ163L38", "VGTY.PA",   "Vanguard USD Treasury Bond UCITS ETF (Dist)",              "Vanguard",                   "Obligations USA Gouvernement","obligations","usa", "USD",False, 0.12, "Bloomberg US Treasury",    "physical",   "distribution",  "EPA"),
    ("LU1650490474", "AMGB.PA",   "Amundi Euro Government Bond 5-7Y UCITS ETF DR EUR (C)",    "Amundi Asset Management",    "Obligations Zone Euro 5-7 ans","obligations","europe","EUR",False, 0.14, "Bloomberg Euro Govt 5-7Y", "physical",   "accumulation",  "EPA"),
    ("IE00B4613386", "IBTK.PA",   "iShares $ Treasury Bond 7-10yr UCITS ETF USD (Dist)",     "BlackRock",                  "Obligations USA 7-10 ans","obligations","usa",  "USD", False, 0.20, "Bloomberg US Treasury 7-10Y","physical",  "distribution",  "EPA"),
    ("IE00B3B8Q275", "IBTM.PA",   "iShares $ Treasury Bond 3-7yr UCITS ETF USD (Dist)",      "BlackRock",                  "Obligations USA 3-7 ans", "obligations","usa",  "USD", False, 0.20, "Bloomberg US Treasury 3-7Y","physical",  "distribution",  "EPA"),

    # ── OBLIGATIONS CRÉDIT ────────────────────────────────────────────────────
    ("LU0290357929", "XBLC.PA",   "Xtrackers EUR Corporate Bond UCITS ETF 1C",                "DWS / Xtrackers",            "Obligations Europe Entreprises","obligations","europe","EUR",False, 0.12, "Bloomberg EUR Corp Bond",  "physical",   "accumulation",  "EPA"),
    ("IE00B3F81R35", "IEBC.AS",   "iShares Core € Corp Bond UCITS ETF EUR (Dist)",            "BlackRock",                  "Obligations Europe Entreprises","obligations","europe","EUR",False, 0.20, "Bloomberg Euro Corp Bond", "physical",   "distribution",  "EPA"),  # in list
    ("LU1215415214", "CS2.PA",    "Amundi EUR Overnight Return UCITS ETF Acc",                 "Amundi Asset Management",    "Monétaire",               "monetaire",  "europe",   "EUR", False, 0.10, "Euro Overnight Return",    "physical",   "accumulation",  "EPA"),

    # ── OBLIGATIONS COURT TERME / MONÉTAIRE ──────────────────────────────────
    ("IE00BCRY6557", "EUSC.PA",   "iShares € Ultrashort Bond UCITS ETF EUR (Dist)",           "BlackRock",                  "Monétaire",               "monetaire",  "europe",   "EUR", False, 0.09, "Bloomberg Ultrashort EUR", "physical",   "distribution",  "EPA"),
    ("LU1190417599", "SECO.PA",   "Amundi EUR Overnight Return UCITS ETF EUR Acc",             "Amundi Asset Management",    "Monétaire",               "monetaire",  "europe",   "EUR", False, 0.10, "Euro Overnight Return",    "physical",   "accumulation",  "EPA"),  # in list

    # ── OBLIGATIONS INFLATION ─────────────────────────────────────────────────
    ("IE00B3B8Q275", "ITPS.PA",   "iShares USD TIPS UCITS ETF USD (Dist)",                    "BlackRock",                  "Obligations Inflation USA","obligations","usa",  "USD", False, 0.10, "Bloomberg US TIPS",        "physical",   "distribution",  "EPA"),
    ("LU1390062784", "AMTL.PA",   "Amundi Euro Government Inflation Linked Bond UCITS ETF DR","Amundi Asset Management",    "Obligations Inflation Euro","obligations","europe","EUR",False, 0.14, "Bloomberg Euro Inflation", "physical",   "accumulation",  "EPA"),

    # ── HAUT RENDEMENT ───────────────────────────────────────────────────────
    ("IE00B66F4759", "IHYG.PA",   "iShares € High Yield Corp Bond UCITS ETF EUR (Dist)",      "BlackRock",                  "Obligations Haut Rendement","obligations","europe","EUR",False, 0.50, "Markit iBoxx EUR HY",      "physical",   "distribution",  "EPA"),  # in list

    # ── OR & MATIÈRES PREMIÈRES ───────────────────────────────────────────────
    ("IE00B4ND3602", "IGLN.PA",   "iShares Physical Gold ETC",                                "BlackRock",                  "Or Physique",             "alternatif", "global",   "USD", False, 0.12, "Gold Spot Price",          "physical",   "accumulation",  "EPA"),
    ("JE00B1VS3770", "PHAU.PA",   "WisdomTree Physical Gold ETC",                             "WisdomTree",                 "Or Physique",             "alternatif", "global",   "USD", False, 0.15, "Gold Spot Price",          "physical",   "accumulation",  "EPA"),
    ("DE000A0S9GB0", "DEKA.PA",   "Xetra-Gold ETC",                                           "Deutsche Börse",             "Or Physique",             "alternatif", "global",   "EUR", False, 0.36, "Gold Spot Price",          "physical",   "accumulation",  "XETR"),
    ("IE00B579F325", "SPGP.PA",   "SPDR Gold Spot ETF",                                       "State Street SPDR",          "Or Physique",             "alternatif", "global",   "USD", False, 0.20, "Gold Spot Price",          "physical",   "accumulation",  "EPA"),
    ("IE00B4WXJJ64", "SLVR.PA",   "WisdomTree Physical Silver ETC",                           "WisdomTree",                 "Argent Physique",         "alternatif", "global",   "USD", False, 0.19, "Silver Spot Price",        "physical",   "accumulation",  "EPA"),

    # ── IMMOBILIER ───────────────────────────────────────────────────────────
    ("LU1291101555", "EPRE.PA",   "BNP Paribas Easy FTSE EPRA Nareit Europe UCITS ETF",       "BNP Paribas AM",             "Immobilier Europe",       "immobilier", "europe",   "EUR", False, 0.40, "FTSE EPRA Nareit Europe",  "physical",   "distribution",  "EPA"),  # in list
    ("LU1437018598", "EPRA.PA",   "Amundi FTSE EPRA Nareit Global UCITS ETF DR USD (C)",      "Amundi Asset Management",    "Immobilier Monde",        "immobilier", "global",   "USD", False, 0.24, "FTSE EPRA Nareit Global",  "physical",   "accumulation",  "EPA"),  # in list
    ("IE00B5BFJG71", "IQQP.PA",   "iShares Developed Markets Property Yield UCITS ETF",       "BlackRock",                  "Immobilier Monde",        "immobilier", "global",   "USD", False, 0.59, "FTSE EPRA Nareit Developed","physical",  "distribution",  "EPA"),

    # ── SECTORIELS ────────────────────────────────────────────────────────────
    # Technologie
    ("LU1681047483", "TNO.PA",    "Amundi MSCI World Information Technology UCITS ETF DR EUR","Amundi Asset Management",    "Actions Tech Monde",      "actions",    "global",   "EUR", False, 0.30, "MSCI World IT",            "physical",   "accumulation",  "EPA"),
    ("IE00B3WJKG14", "QDVE.DE",   "iShares S&P 500 Information Technology Sector UCITS ETF",  "BlackRock",                  "Actions Tech USA",        "actions",    "usa",      "USD", False, 0.15, "S&P 500 IT Sector",        "physical",   "accumulation",  "XETR"),
    # Santé
    ("LU1681047160", "ALTH.PA",   "Amundi MSCI World Health Care UCITS ETF DR EUR (C)",       "Amundi Asset Management",    "Actions Santé Monde",     "actions",    "global",   "EUR", False, 0.30, "MSCI World Health Care",   "physical",   "accumulation",  "EPA"),  # in list
    ("IE00BJ5JP105", "HEAL.PA",   "iShares Healthcare Innovation UCITS ETF USD (Acc)",         "BlackRock",                  "Actions Santé Innovation","actions",    "global",   "USD", False, 0.40, "STOXX Global Digital Security","physical","accumulation", "EPA"),
    # Finance
    ("LU1681047590", "BNKE.PA",   "Amundi MSCI World Financials UCITS ETF DR EUR (C)",        "Amundi Asset Management",    "Actions Finance Monde",   "actions",    "global",   "EUR", False, 0.30, "MSCI World Financials",    "physical",   "accumulation",  "EPA"),  # in list
    ("IE00BD4TYL27", "EXV1.DE",   "iShares STOXX Europe 600 Banks UCITS ETF (Dist)",          "BlackRock",                  "Actions Banques Europe",  "actions",    "europe",   "EUR", False, 0.46, "STOXX Europe 600 Banks",   "physical",   "distribution",  "XETR"),
    # Énergie
    ("IE00B6R52143", "WENE.PA",   "iShares MSCI World Energy Sector UCITS ETF USD (Acc)",     "BlackRock",                  "Actions Énergie Monde",   "actions",    "global",   "USD", False, 0.25, "MSCI World Energy",        "physical",   "accumulation",  "EPA"),
    # Défense & Aérospatial
    ("IE0002W7UGT5", "NATO.PA",   "VanEck Defense UCITS ETF (Acc)",                           "VanEck",                     "Actions Défense",         "actions",    "global",   "EUR", False, 0.55, "MVIS Global Defense Industry","physical","accumulation", "EPA"),
    # Industrie
    ("IE00BYVJRR92", "ISRB.PA",   "iShares Automation & Robotics UCITS ETF USD (Acc)",        "BlackRock",                  "Actions Robotique",       "actions",    "global",   "USD", False, 0.40, "iSTOXX Automation & Robotics","physical","accumulation", "EPA"),
    ("LU1861132186", "ROAI.PA",   "Amundi MSCI Robotics & AI ESG Screened UCITS ETF",         "Amundi Asset Management",    "Actions Robotique & IA",  "actions",    "global",   "EUR", False, 0.35, "MSCI Robotics & AI",       "physical",   "accumulation",  "EPA"),  # in list
    # Énergie propre
    ("IE00B1XNHC34", "INRG.PA",   "iShares Global Clean Energy UCITS ETF USD (Dist)",         "BlackRock",                  "Actions Énergie Propre",  "actions",    "global",   "USD", False, 0.65, "S&P Global Clean Energy",  "physical",   "distribution",  "EPA"),
    ("LU1105284243", "NESR.PA",   "Amundi MSCI New Energy ESG Screened UCITS ETF DR",         "Amundi Asset Management",    "Actions Énergie Propre",  "actions",    "global",   "EUR", False, 0.35, "MSCI New Energy ESG",      "physical",   "accumulation",  "EPA"),  # in list
    # Eau
    ("IE00B1TXK627", "IH2O.PA",   "iShares Global Water UCITS ETF USD (Dist)",                "BlackRock",                  "Actions Eau Monde",       "actions",    "global",   "USD", False, 0.65, "S&P Global Water",         "physical",   "distribution",  "EPA"),
    # Alimentation
    ("IE00B6R52036", "FOOD.PA",   "iShares Agribusiness UCITS ETF USD (Acc)",                 "BlackRock",                  "Actions Agro-Alimentaire","actions",    "global",   "USD", False, 0.55, "S&P Agribusiness",         "physical",   "accumulation",  "EPA"),  # in list
    # Luxe / Consommation
    ("LU1681047317", "CLUX.PA",   "Amundi MSCI Europe Consumer Discretionary UCITS ETF DR",   "Amundi Asset Management",    "Actions Consommation Europe","actions",  "europe",   "EUR", False, 0.30, "MSCI Europe Consumer Disc","physical",   "accumulation",  "EPA"),

    # ── FACTORIELS / SMART BETA ───────────────────────────────────────────────
    ("LU2023678282", "WQOM.PA",   "Amundi MSCI World Momentum Factor UCITS ETF DR EUR (C)",   "Amundi Asset Management",    "Actions Monde (Momentum)","actions",    "global",   "EUR", False, 0.23, "MSCI World Momentum",      "physical",   "accumulation",  "EPA"),  # in list
    ("LU2023677128", "WQUA.PA",   "Amundi MSCI World Quality Factor UCITS ETF DR EUR (C)",    "Amundi Asset Management",    "Actions Monde (Qualité)", "actions",    "global",   "EUR", False, 0.23, "MSCI World Quality",       "physical",   "accumulation",  "EPA"),  # in list
    ("LU2023678951", "WMIV.PA",   "Amundi MSCI World Min Volatility Factor UCITS ETF DR EUR", "Amundi Asset Management",    "Actions Monde (Faible Vol)","actions",   "global",   "EUR", False, 0.23, "MSCI World Min Volatility","physical",   "accumulation",  "EPA"),  # in list
    ("LU1681043755", "WDIV.PA",   "Amundi MSCI Europe High Dividend Factor UCITS ETF DR",     "Amundi Asset Management",    "Actions Europe Dividendes","actions",    "europe",   "EUR", False, 0.23, "MSCI Europe High Dividend","physical",   "distribution",  "EPA"),  # in list
    ("IE00B6YX5C33", "SPY5.PA",   "SPDR S&P 500 UCITS ETF (Dist)",                           "State Street SPDR",          "Actions USA",             "actions",    "usa",      "USD", False, 0.09, "S&P 500",                  "physical",   "distribution",  "EPA"),  # in list
    ("IE00B3XXRP09", "SPPW.DE",   "SPDR S&P 500 UCITS ETF EUR Hdg Daily (Dist)",             "State Street SPDR",          "Actions USA (couvertes)",  "actions",    "usa",      "EUR", True,  0.15, "S&P 500 EUR Hedged",       "physical",   "distribution",  "XETR"),

    # ── OBLIGATIONS VERTES / ESG ──────────────────────────────────────────────
    ("LU2093558982", "GRND.PA",   "Amundi EUR Corp Green Bond UCITS ETF DR EUR (C)",          "Amundi Asset Management",    "Obligations Vertes Europe","obligations","europe",  "EUR", False, 0.14, "Bloomberg MSCI EUR Corp Green","physical","accumulation","EPA"),  # in list
    ("IE00BFNM3P36", "EGOB.PA",   "iShares € Green Bond UCITS ETF EUR (Dist)",               "BlackRock",                  "Obligations Vertes Euro", "obligations","europe",   "EUR", False, 0.20, "Bloomberg MSCI EUR Labeled Green","physical","distribution","EPA"),

    # ── MULTI-ACTIFS / DIVERSIFIÉS ────────────────────────────────────────────
    ("LU2089238385", "L8I3.PA",   "Amundi Prime Global UCITS ETF DR EUR (C)",                 "Amundi Asset Management",    "Actions Monde",           "actions",    "global",   "EUR", False, 0.05, "Solactive GBS Global Markets","physical","accumulation",  "EPA"),
    ("LU2089238039", "LU20.PA",   "Amundi Prime USA UCITS ETF DR EUR (C)",                    "Amundi Asset Management",    "Actions USA",             "actions",    "usa",      "EUR", False, 0.05, "Solactive GBS US Large + Mid","physical","accumulation",  "EPA"),
    ("LU2089238625", "L8I5.PA",   "Amundi Prime Europe UCITS ETF DR EUR (C)",                 "Amundi Asset Management",    "Actions Europe",          "actions",    "europe",   "EUR", False, 0.05, "Solactive GBS European Large + Mid","physical","accumulation","EPA"),
    ("LU2090062768", "LU21.PA",   "Amundi Prime Emerging Markets UCITS ETF DR USD (C)",       "Amundi Asset Management",    "Actions Marchés Émergents","actions",   "emerging", "USD", False, 0.10, "Solactive GBS EM Large + Mid","physical","accumulation",  "EPA"),
    ("LU2090063147", "LU22.PA",   "Amundi Prime Japan UCITS ETF DR USD (C)",                  "Amundi Asset Management",    "Actions Japon",           "actions",    "japan",    "USD", False, 0.05, "Solactive GBS Japan Large + Mid","physical","accumulation","EPA"),
    ("LU2090062255", "LU23.PA",   "Amundi Prime Euro Government Bond UCITS ETF DR EUR (C)",   "Amundi Asset Management",    "Obligations Zone Euro Gouvernement","obligations","europe","EUR",False, 0.05, "Solactive EUR Govt Bond","physical","accumulation","EPA"),
    ("LU2090062255", "LU24.PA",   "Amundi Prime Global Government Bond UCITS ETF DR EUR (C)", "Amundi Asset Management",    "Obligations Monde Gouvernement","obligations","global","EUR",False,  0.05, "Solactive Global Govt Bond","physical","accumulation","EPA"),

    # ── CRYPTOMONNAIES (ETP réglementés) ─────────────────────────────────────
    ("CH0454664001", "BTC.PA",    "21Shares Bitcoin ETP",                                     "21Shares",                   "Bitcoin ETP",             "alternatif", "global",   "USD", False, 1.49, "Bitcoin",                  "physical",   "accumulation",  "EPA"),
    ("XS2376095068", "WBIT.PA",   "WisdomTree Physical Bitcoin ETP",                          "WisdomTree",                 "Bitcoin ETP",             "alternatif", "global",   "USD", False, 0.35, "Bitcoin",                  "physical",   "accumulation",  "EPA"),
]

# ─── Math helpers ─────────────────────────────────────────────────────────────

def annualized_return(prices, years):
    if len(prices) < 2 or years <= 0: return None
    return (prices[-1] / prices[0]) ** (1 / years) - 1

def annualized_volatility(weekly_returns):
    if len(weekly_returns) < 4: return None
    n = len(weekly_returns)
    mean = sum(weekly_returns) / n
    var = sum((r - mean) ** 2 for r in weekly_returns) / (n - 1)
    return math.sqrt(var * 52)

def sharpe(ann_return, ann_vol):
    if ann_return is None or ann_vol is None or ann_vol == 0: return None
    return (ann_return - RISK_FREE_RATE) / ann_vol

def max_drawdown(prices):
    if len(prices) < 2: return None
    peak = prices[0]
    max_dd = 0.0
    for p in prices:
        if p > peak: peak = p
        dd = (p - peak) / peak
        if dd < max_dd: max_dd = dd
    return max_dd

def srri_from_vol(vol_3y_pct):
    v = vol_3y_pct
    if v < 0.5:  return 1
    if v < 2.0:  return 2
    if v < 5.0:  return 3
    if v < 10.0: return 4
    if v < 15.0: return 5
    if v < 25.0: return 6
    return 7

def compute_metrics(price_history):
    if not price_history or len(price_history) < 4:
        return {}
    closes = [p["close"] for p in price_history]
    dates  = [p["date"]  for p in price_history]
    now    = datetime.now()

    def prices_since(years):
        cutoff = (now - timedelta(days=years * 365.25)).strftime("%Y-%m-%d")
        return [c for d, c in zip(dates, closes) if d >= cutoff]

    def weekly_rets(prices):
        return [(prices[i] / prices[i-1]) - 1 for i in range(1, len(prices))]

    c1y = prices_since(1.0)
    c3y = prices_since(3.0)
    c5y = prices_since(5.0)

    p1y = annualized_return(c1y, 1.0)
    p3y = annualized_return(c3y, 3.0)
    p5y = annualized_return(c5y, 5.0)
    v1y = annualized_volatility(weekly_rets(c1y)) if len(c1y) >= 4 else None
    v3y = annualized_volatility(weekly_rets(c3y)) if len(c3y) >= 4 else None
    s1y = sharpe(p1y, v1y)
    s3y = sharpe(p3y, v3y)
    dd1y = max_drawdown(c1y) if len(c1y) >= 2 else None
    dd3y = max_drawdown(c3y) if len(c3y) >= 2 else None
    available = [v for v in [p1y, p3y, p5y] if v is not None]

    m = {}
    if p1y  is not None: m["performance1Y"]           = round(p1y * 100, 2)
    if p3y  is not None: m["performance3YAnnualized"] = round(p3y * 100, 2)
    if p5y  is not None: m["performance5YAnnualized"] = round(p5y * 100, 2)
    if available:        m["averagePerformance"]       = round(sum(available) / len(available) * 100, 2)
    if v1y  is not None: m["volatility1Y"]            = round(v1y * 100, 2)
    if v3y  is not None: m["volatility3Y"]            = round(v3y * 100, 2)
    if s1y  is not None: m["sharpe1Y"]                = round(s1y, 3)
    if s3y  is not None: m["sharpe3Y"]                = round(s3y, 3)
    if dd1y is not None: m["maxDrawdown1Y"]           = round(dd1y * 100, 2)
    if dd3y is not None: m["maxDrawdown3Y"]           = round(dd3y * 100, 2)
    if v3y  is not None: m["srri"]                    = srri_from_vol(v3y * 100)
    return m

# ─── Load existing ETFs ───────────────────────────────────────────────────────

with open(ETFS_PATH) as f:
    existing_etfs = json.load(f)

existing_isins = {e["isin"] for e in existing_etfs}

# ─── Build new ETF list (dedup) ──────────────────────────────────────────────

new_entries = []
seen_isins = set()

for row in NEW_ETF_CATALOG:
    (isin, yahoo, name, mgmt_co, category, asset_class, region, currency, hedged,
     ter, index, replication, dividend_policy, exchange) = row

    if isin in existing_isins or isin in seen_isins:
        continue
    seen_isins.add(isin)

    # Determine riskLevel from asset_class
    if asset_class == "monetaire":
        risk_level = "faible"
    elif asset_class == "obligations":
        risk_level = "modere"
    else:
        risk_level = "eleve"

    new_entries.append({
        "isin": isin,
        "yahoo": yahoo,
        "name": name,
        "managementCompany": mgmt_co,
        "category": category,
        "assetClass": asset_class,
        "regionExposure": region,
        "currency": currency,
        "hedged": hedged,
        "ter": ter,
        "underlyingIndex": index,
        "replicationMethod": replication,
        "dividendPolicy": dividend_policy,
        "exchange": exchange,
        "riskLevel": risk_level,
        "productType": "etf",
        "distributorFrance": True,
    })

print(f"📊  ETF Extended Pipeline")
print(f"   ETFs existants: {len(existing_etfs)}")
print(f"   Nouveaux ETFs à traiter: {len(new_entries)}")

if DRY_RUN:
    print(f"\n🔍  DRY RUN — voici les nouveaux ETFs:")
    for e in new_entries:
        print(f"   {e['isin']:15} {e['yahoo']:12} {e['name'][:55]}")
    print(f"\n✅  Total après ajout: {len(existing_etfs) + len(new_entries)} ETFs")
    sys.exit(0)

# ─── Fetch prices ─────────────────────────────────────────────────────────────

start_date = (datetime.now() - timedelta(days=5 * 365 + 30)).strftime("%Y-%m-%d")

print(f"\n🔄  Fetching prix Yahoo Finance...")

added = 0
failed = 0
run_started = datetime.now()

for entry in new_entries:
    isin  = entry["isin"]
    yahoo = entry["yahoo"]
    # Priority: ISIN direct (most reliable for UCITS), then .L (London),
    # then original ticker, then .AS (Amsterdam)
    london = yahoo.split(".")[0] + ".L" if "." in yahoo else yahoo + ".L"
    amsterdam = yahoo.split(".")[0] + ".AS" if "." in yahoo else yahoo + ".AS"
    tickers_to_try = [isin, london, yahoo, amsterdam]

    price_history = None
    for ticker in tickers_to_try:
        try:
            raw = yf.download(ticker, start=start_date, interval="1wk",
                              progress=False, auto_adjust=True)
            if raw.empty or len(raw) < 4:
                continue
            close_col = raw["Close"]
            # yfinance may return DataFrame (MultiIndex) or Series depending on version
            if hasattr(close_col, "squeeze"):
                close_col = close_col.squeeze()
            close = close_col.dropna()
            ph = [
                {"date": str(idx.date()), "close": round(float(val), 4)}
                for idx, val in close.items()
                if not math.isnan(float(val))
            ]
            ph.sort(key=lambda p: p["date"])
            if len(ph) >= 4:
                price_history = ph
                print(f"  ✓  {isin} ({ticker}): {len(ph)} points")
                break
        except Exception:
            continue

    if price_history is None:
        print(f"  ✗  {isin} ({yahoo}): pas de données")
        failed += 1
        entry["dataSource"] = "unavailable"
        existing_etfs.append(entry)
        if _DB_AVAILABLE and not DRY_RUN:
            upsert_fund(_etf_to_supabase_row({**entry, "dataSource": "unavailable"}))
        continue

    # Write price file (backward compat V1 frontend)
    price_file = PRICES_DIR / f"{isin}.json"
    with open(price_file, "w") as f:
        json.dump(price_history, f, ensure_ascii=False)

    metrics = compute_metrics(price_history)
    etf_record = {
        "id": f"etf-{isin.lower().replace('0', '').replace('1', '')[:15]}",
        **entry,
        "aumEur": 1_000_000_000,  # placeholder — Yahoo .info() not called for ETFs
        "inceptionDate": price_history[0]["date"] if price_history else "2010-01-01",
        "trackRecordYears": round((datetime.now() - datetime.strptime(price_history[0]["date"], "%Y-%m-%d")).days / 365.25, 1) if price_history else 0,
        "srri": 5,
        **metrics,
        "dataSource": "yahoo-finance",
    }
    for field in ["performance1Y", "performance3YAnnualized", "performance5YAnnualized",
                  "averagePerformance", "volatility1Y", "volatility3Y", "sharpe1Y", "sharpe3Y"]:
        if field not in etf_record:
            etf_record[field] = 0
    if "srri" in metrics:
        etf_record["srri"] = metrics["srri"]

    etf_record.pop("yahoo", None)
    existing_etfs.append(etf_record)
    added += 1

    # Écriture Supabase
    if _DB_AVAILABLE and not DRY_RUN:
        upsert_fund(_etf_to_supabase_row(etf_record))
        upsert_prices(isin, [{"date": p["date"], "nav": p["close"]} for p in price_history],
                      source="yahoo-finance")

    time.sleep(0.5)

# ─── Write ───────────────────────────────────────────────────────────────────

with open(ETFS_PATH, "w") as f:
    json.dump(existing_etfs, f, ensure_ascii=False, indent=2)
    f.write("\n")

date_str = datetime.now().strftime("%Y-%m-%d")
print(f"\n✅  Terminé")
print(f"   ETFs ajoutés avec données réelles : {added}")
print(f"   ETFs sans données (unavailable)   : {failed}")
print(f"   Total ETFs dans etfs.json         : {len(existing_etfs)}")

if _DB_AVAILABLE and not DRY_RUN:
    status = "success" if failed == 0 else ("partial" if added > 0 else "failed")
    log_run(
        scraper="yahoo-finance-etf-extended",
        status=status,
        records_processed=added,
        records_failed=failed,
        started_at=run_started,
    )

print(f"\n   Prochaine étape:")
print(f"   npm run build && git commit -am 'data: extended ETF catalog + clean fake data {date_str}'")
