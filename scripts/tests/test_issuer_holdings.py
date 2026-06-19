#!/usr/bin/env python3
"""Tests unitaires de issuer-holdings.py (stdlib, sans pytest).

Lancer : python3 scripts/tests/test_issuer_holdings.py

Verrouille le parsing de la composition COMPLÈTE des ETF (chantier A) :
  - le CSV iShares a un préambule (« Fund Holdings as of », ligne vide) avant
    l'entête → détection robuste de la ligne d'entête ;
  - « Weight (%) » est un pourcentage → stocké en FRACTION (7.91 → 0.0791) ;
  - tri par poids décroissant, ticker « - » et lignes sans nom écartés ;
  - secteurs/géo agrégés (somme des poids, libellés non géographiques exclus).
"""
import sys
import types
import importlib.util
import unittest
from pathlib import Path

# Stub `db` pour importer sans supabase / env.
_fake_db = types.ModuleType("db")
for _name in ("get_client", "log_run"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

_PATH = Path(__file__).resolve().parents[1] / "scrapers" / "issuer-holdings.py"
_spec = importlib.util.spec_from_file_location("issuer_holdings", _PATH)
ih = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ih)

# CSV iShares représentatif : préambule, entête, lignes actions + cash + petite ligne.
SAMPLE_CSV = (
    '﻿Fund Holdings as of,"18/Jun/2026"\n'
    '\n'
    'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Market Currency\n'
    '"AAPL","APPLE INC","Information Technology","Equity","1,000","6.78","1,000","10","210","United States","NASDAQ","USD"\n'
    '"NVDA","NVIDIA CORP","Information Technology","Equity","2,000","7.91","2,000","20","210","United States","NASDAQ","USD"\n'
    '"NESN","NESTLE SA","Consumer Staples","Equity","500","1.20","500","5","100","Switzerland","SIX","CHF"\n'
    '"-","CASH AND/OR DERIVATIVES","Cash and/or Derivatives","Cash","10","0.01","10","1","1","-","-","USD"\n'
    '"TINY","TINY CO","Industrials","Equity","1","0.0050","1","1","1","Germany","XETRA","EUR"\n'
)


class ParseCsv(unittest.TestCase):
    def setUp(self):
        self.rows = ih.ishares_parse_csv(SAMPLE_CSV)

    def test_extracts_all_weighted_rows(self):
        # 5 lignes pondérées non nulles (cash 0.01% inclus, ligne vide ignorée).
        self.assertEqual(len(self.rows), 5)

    def test_sorted_by_weight_desc(self):
        weights = [r["weight"] for r in self.rows]
        self.assertEqual(weights, sorted(weights, reverse=True))
        self.assertEqual(self.rows[0]["position_name"], "NVIDIA CORP")

    def test_weight_is_fraction(self):
        nvda = next(r for r in self.rows if r["ticker"] == "NVDA")
        self.assertAlmostEqual(nvda["weight"], 0.0791, places=6)

    def test_small_line_not_rounded_to_zero(self):
        # 0,0050 % = 0,00005 — capté grâce à numeric(9,6).
        tiny = next(r for r in self.rows if r["ticker"] == "TINY")
        self.assertAlmostEqual(tiny["weight"], 0.00005, places=6)

    def test_country_mapping(self):
        nestle = next(r for r in self.rows if r["ticker"] == "NESN")
        self.assertEqual(nestle["country"], "CH")
        cash = next(r for r in self.rows if "CASH" in r["position_name"])
        self.assertIsNone(cash["country"])  # Location "-" → pas de pays

    def test_header_without_preamble(self):
        # Le parsing doit aussi marcher si le CSV commence directement à l'entête.
        body = SAMPLE_CSV.split("\n", 2)[2]
        self.assertEqual(len(ih.ishares_parse_csv(body)), 5)


class Aggregate(unittest.TestCase):
    def test_sectors_and_geos_summed(self):
        rows = ih.ishares_parse_csv(SAMPLE_CSV)
        sectors, geos = ih.aggregate_breakdowns(rows)
        sec = {s["sector_name"]: s["weight"] for s in sectors}
        # IT = 6.78 + 7.91 = 14.69 %
        self.assertAlmostEqual(sec["Information Technology"], 0.1469, places=4)
        # « Cash and/or Derivatives » exclu de l'agrégation sectorielle.
        self.assertNotIn("Cash and/or Derivatives", sec)
        geo = {g["country_code"]: g["weight"] for g in geos}
        self.assertAlmostEqual(geo["US"], 0.1469, places=4)
        self.assertIn("CH", geo)
        self.assertIn("DE", geo)

    def test_breakdowns_sorted_desc(self):
        rows = ih.ishares_parse_csv(SAMPLE_CSV)
        sectors, geos = ih.aggregate_breakdowns(rows)
        self.assertEqual([s["weight"] for s in sectors],
                         sorted([s["weight"] for s in sectors], reverse=True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
