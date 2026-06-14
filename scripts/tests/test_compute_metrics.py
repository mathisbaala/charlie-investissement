#!/usr/bin/env python3
"""Tests unitaires de compute-metrics.py (stdlib, sans pytest).

Lancer : python3 scripts/tests/test_compute_metrics.py

Régression : track_record_years était calculé par len(prices_all)/52 — les VL
étant quotidiennes (~252/an, pas hebdo), un fonds de ~10 ans à 1825 VL ressortait
à 35,1 ans (1825/52). Le calcul doit venir d'inception_date.
"""
import sys
import types
import importlib.util
import unittest
from datetime import date
from pathlib import Path

# Stub `db` pour importer le module sans supabase / env (toutes les fonctions db
# sont appelées paresseusement à l'exécution, jamais au chargement).
_fake_db = types.ModuleType("db")
for _name in ("get_client", "update_funds_bulk", "log_run", "get_ecb_rate",
              "isins_with_recent_prices", "reset_client"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

_PATH = Path(__file__).resolve().parents[1] / "enrichers" / "compute-metrics.py"
_spec = importlib.util.spec_from_file_location("compute_metrics", _PATH)
cm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cm)


class TrackRecordYears(unittest.TestCase):
    def test_inception_drives_age_not_price_count(self):
        # Régression du bug : fonds créé en 2016, ~1825 VL quotidiennes sur 5 ans.
        # L'ancien code rendait 1825/52 = 35,1 ans. Le bon calcul vient d'inception.
        expected = round((date.today() - date(2016, 4, 29)).days / 365.25, 1)
        got = cm._track_record_years("2016-04-29", span_days_5y=1825)
        self.assertEqual(got, expected)
        # Garde-fou explicite : jamais la valeur surévaluée par len/52.
        self.assertLess(got, 15.0)
        self.assertNotAlmostEqual(got, 1825 / 52, places=1)

    def test_fallback_uses_price_span_not_count(self):
        # Sans inception : amplitude réelle de la série (span en jours), pas le compte.
        self.assertAlmostEqual(
            cm._track_record_years(None, span_days_5y=3653), 10.0, delta=0.1
        )

    def test_no_inception_no_span_returns_none(self):
        # Rien d'exploitable → None (n'écrase pas la valeur existante en base).
        self.assertIsNone(cm._track_record_years(None, span_days_5y=0))

    def test_future_inception_rejected(self):
        # Date d'émission dans le futur → années négatives → None.
        self.assertIsNone(cm._track_record_years("2999-01-01", span_days_5y=0))

    def test_absurd_age_rejected(self):
        # > 100 ans : donnée corrompue, on retombe sur le repli (ici None).
        self.assertIsNone(cm._track_record_years("1800-01-01", span_days_5y=0))

    def test_old_but_real_fund_kept(self):
        # Un fonds réellement ancien (SCPI 1966) garde son ancienneté réelle.
        expected = round((date.today() - date(1966, 1, 1)).days / 365.25, 1)
        self.assertEqual(cm._track_record_years("1966-01-01", span_days_5y=0), expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
