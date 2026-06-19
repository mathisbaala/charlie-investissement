#!/usr/bin/env python3
"""Tests unitaires de ms-emea-perf-enricher.py (stdlib, sans pytest).

Lancer : python3 scripts/tests/test_ms_emea_perf.py

Verrouille la conversion annualisé→cumulé : Morningstar renvoie ReturnM36/M60
ANNUALISÉS, mais la base stocke du CUMULÉ (comme compute-metrics/FT). Sans
conversion, les perfs des OPCVM étrangers seraient incohérentes avec tout le
reste (tri/comparaison faussés).
"""
import sys
import types
import importlib.util
import unittest
from pathlib import Path

_fake_db = types.ModuleType("db")
for _name in ("get_client", "log_run"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

_PATH = Path(__file__).resolve().parents[1] / "scrapers" / "ms-emea-perf-enricher.py"
_spec = importlib.util.spec_from_file_location("ms_emea_perf", _PATH)
ms = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ms)


class AnnualizedToCumul(unittest.TestCase):
    def test_one_year_is_identity(self):
        self.assertEqual(ms.annualized_to_cumul(23.04, 1), 23.04)

    def test_three_years_compounds(self):
        # 15.43 %/an sur 3 ans → ((1.1543)^3 − 1)·100 ≈ 53.80 % cumulé.
        self.assertAlmostEqual(ms.annualized_to_cumul(15.43, 3), 53.7999, places=3)

    def test_five_years_compounds(self):
        # 10.02 %/an sur 5 ans → ≈ 61.20 % cumulé.
        self.assertAlmostEqual(ms.annualized_to_cumul(10.02, 5), 61.1975, places=3)

    def test_negative_annualized(self):
        # −5 %/an sur 3 ans → ((0.95)^3 − 1)·100 ≈ −14.26 %.
        self.assertAlmostEqual(ms.annualized_to_cumul(-5.0, 3), -14.2625, places=3)

    def test_cumul_greater_than_annualized_when_positive(self):
        # Garde-fou : le cumulé > annualisé pour un rendement positif pluriannuel.
        self.assertGreater(ms.annualized_to_cumul(8.0, 5), 8.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
