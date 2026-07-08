#!/usr/bin/env python3
"""Tests unitaires de fonds-euros-enricher.py (stdlib, sans pytest).

Lancer : python3 scripts/tests/test_fonds_euros.py

Régression : les fenêtres de perf étaient codées en dur (2022-2024 / 2020-2024)
→ en 2026 les fonds euros affichaient des taux finissant en 2024 (périmés). Le
calcul doit être DYNAMIQUE : fenêtre finissant sur la dernière année publiée, et
None si la fenêtre est trouée.
"""
import sys
import types
import importlib.util
import unittest
from pathlib import Path

# Stub `db` pour importer le module sans supabase / env (fonctions testées pures).
_fake_db = types.ModuleType("db")
for _name in ("get_client", "log_run", "compute_completeness", "upsert_prices"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

_PATH = Path(__file__).resolve().parents[1] / "scrapers" / "fonds-euros-enricher.py"
_spec = importlib.util.spec_from_file_location("fonds_euros", _PATH)
fe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fe)


class ComputePerfs(unittest.TestCase):
    def test_dynamic_window_ends_on_latest_year(self):
        # Taux 2018→2025 : la fenêtre doit finir en 2025 (pas 2024 figé).
        taux = {"2018": 2.25, "2019": 1.2, "2020": 1.1, "2021": 0.95,
                "2022": 1.53, "2023": 3.1, "2024": 3.0, "2025": 3.0}
        p1y, p3y, p5y = fe.compute_perfs(taux)
        self.assertEqual(p1y, 3.0)                      # taux 2025
        self.assertEqual(p3y, fe.compound([3.1, 3.0, 3.0]))   # 2023+2024+2025
        self.assertEqual(p5y, fe.compound([0.95, 1.53, 3.1, 3.0, 3.0]))  # 2021-2025

    def test_gap_in_window_returns_none(self):
        # 5y impossible (pas de 2021) mais 3y ok (2023-2025 présents).
        taux = {"2022": 2.1, "2023": 2.5, "2024": 2.5, "2025": 3.0}
        p1y, p3y, p5y = fe.compute_perfs(taux)
        self.assertEqual(p1y, 3.0)
        self.assertEqual(p3y, fe.compound([2.5, 2.5, 3.0]))
        self.assertIsNone(p5y)

    def test_empty_taux(self):
        self.assertEqual(fe.compute_perfs({}), (None, None, None))

    def test_window_helper_requires_consecutive(self):
        taux = {"2023": 2.0, "2025": 3.0}  # trou en 2024
        self.assertIsNone(fe._window_ending_latest(taux, 2025, 3))
        self.assertIsNone(fe._window_ending_latest(taux, 2025, 2))  # 2024 manque


if __name__ == "__main__":
    unittest.main(verbosity=2)
