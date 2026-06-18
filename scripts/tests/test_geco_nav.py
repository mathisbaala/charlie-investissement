#!/usr/bin/env python3
"""Tests unitaires de geco-nav.py (stdlib, sans pytest).

Lancer : python3 scripts/tests/test_geco_nav.py

Verrouille deux pièges du filet VL GECO :
  - le format de date GECO est DD-MM-YYYY (≠ ISO) → parse_chart_payload doit le
    convertir, écarter les NAV None/≤0 et trier par date ;
  - l'écriture est INCRÉMENTALE : ne JAMAIS réécrire des points ≤ dernière VL
    connue (sinon doublons / écrasement entre sources), backfill borné sinon.
"""
import sys
import types
import importlib.util
import unittest
from pathlib import Path

# Stub `db` et `scrapling.fetchers` pour importer le module sans supabase / réseau
# (les fonctions testées sont pures ; les dépendances ne servent qu'à l'exécution).
_fake_db = types.ModuleType("db")
for _name in ("get_client", "upsert_prices", "log_run"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

_fake_scrapling = types.ModuleType("scrapling.fetchers")
_fake_scrapling.FetcherSession = object
sys.modules.setdefault("scrapling", types.ModuleType("scrapling"))
sys.modules.setdefault("scrapling.fetchers", _fake_scrapling)

_PATH = Path(__file__).resolve().parents[1] / "scrapers" / "geco-nav.py"
_spec = importlib.util.spec_from_file_location("geco_nav", _PATH)
gn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gn)


class ParseChartPayload(unittest.TestCase):
    def test_ddmmyyyy_to_iso_sorted_and_filtered(self):
        payload = {
            "x": ["16-06-2026", "27-06-2025", "01-01-2024"],
            "y": [416.61, 341.72, 100.0],
        }
        out = gn.parse_chart_payload(payload)
        # Converti en ISO et trié croissant par date.
        self.assertEqual([p["date"] for p in out],
                         ["2024-01-01", "2025-06-27", "2026-06-16"])
        self.assertEqual(out[-1]["nav"], 416.61)
        self.assertTrue(all(p["currency"] == "EUR" for p in out))

    def test_drops_none_and_non_positive(self):
        payload = {
            "x": ["16-06-2026", "15-06-2026", "14-06-2026", "13-06-2026"],
            "y": [None, 0, -3.2, 12.5],
        }
        out = gn.parse_chart_payload(payload)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0], {"date": "2026-06-13", "nav": 12.5, "currency": "EUR"})

    def test_malformed_payloads_return_empty(self):
        self.assertEqual(gn.parse_chart_payload({}), [])
        self.assertEqual(gn.parse_chart_payload({"x": ["16-06-2026"], "y": []}), [])
        # Longueurs x/y incohérentes → rejeté en bloc.
        self.assertEqual(gn.parse_chart_payload({"x": ["a", "b"], "y": [1.0]}), [])


class IncrementalPoints(unittest.TestCase):
    def setUp(self):
        self.series = [
            {"date": "2026-06-10", "nav": 1.0, "currency": "EUR"},
            {"date": "2026-06-13", "nav": 2.0, "currency": "EUR"},
            {"date": "2026-06-16", "nav": 3.0, "currency": "EUR"},
        ]

    def test_only_points_after_last_known(self):
        out = gn.incremental_points(self.series, last="2026-06-13",
                                    min_backfill="2021-06-16")
        # Strictement postérieurs : 13/06 (déjà connu) exclu, 16/06 seul retenu.
        self.assertEqual([p["date"] for p in out], ["2026-06-16"])

    def test_no_history_backfills_from_floor(self):
        out = gn.incremental_points(self.series, last=None,
                                    min_backfill="2026-06-13")
        # Backfill inclut la borne (≥) : 13/06 et 16/06, pas 10/06.
        self.assertEqual([p["date"] for p in out], ["2026-06-13", "2026-06-16"])

    def test_already_fresh_writes_nothing(self):
        out = gn.incremental_points(self.series, last="2026-06-16",
                                    min_backfill="2021-06-16")
        self.assertEqual(out, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
