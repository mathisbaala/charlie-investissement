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
from datetime import date, timedelta
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


class StalenessGuard(unittest.TestCase):
    """Garde de péremption : une série figée ne doit plus produire de perf."""

    def _fresh_series(self):
        # 60 points hebdo sur ~360 j, +10 % → perf 1Y plausible (classe action).
        return [100.0 + i * (10.0 / 59) for i in range(60)]

    def test_is_stale_thresholds(self):
        self.assertFalse(cm._is_stale(None))            # pas de prix → pas périmé
        self.assertFalse(cm._is_stale(date.today().isoformat()))
        recent = (date.today() - timedelta(days=cm.STALE_DAYS - 5)).isoformat()
        self.assertFalse(cm._is_stale(recent))          # juste sous le seuil
        old = (date.today() - timedelta(days=cm.STALE_DAYS + 5)).isoformat()
        self.assertTrue(cm._is_stale(old))              # au-delà du seuil
        self.assertTrue(cm._is_stale("2021-06-23"))     # fonds figé en 2021
        self.assertFalse(cm._is_stale("pas-une-date"))  # robustesse parsing

    def test_stale_series_purges_all_trend_metrics(self):
        prices = self._fresh_series()
        spans = {"1y": 360, "3y": 360, "5y": 360}
        old = (date.today() - timedelta(days=400)).isoformat()
        metrics = cm.compute_fund_metrics(
            prices, prices, prices, prices, rf=0.03, spans=spans,
            asset_class="action", inception="2016-01-01", last_date=old,
        )
        # Tous les champs de tendance explicitement à None (purge en base).
        for f in cm.STALE_PURGE_FIELDS:
            self.assertIn(f, metrics)
            self.assertIsNone(metrics[f], f)

    def test_fresh_series_still_computes_perf(self):
        prices = self._fresh_series()
        spans = {"1y": 360, "3y": 360, "5y": 360}
        fresh = date.today().isoformat()
        metrics = cm.compute_fund_metrics(
            prices, prices, prices, prices, rf=0.03, spans=spans,
            asset_class="action", inception="2016-01-01", last_date=fresh,
        )
        # Série fraîche → perf 1Y calculée (~+10 %), pas neutralisée par la garde.
        self.assertIsNotNone(metrics.get("performance_1y"))
        self.assertAlmostEqual(metrics["performance_1y"], 10.0, delta=0.5)


class InvalidWindowPurgesRiskMetrics(unittest.TestCase):
    """Régression : une fenêtre 3Y (ou 1Y) invalide doit purger TOUTES ses
    métriques de risque (vol/sharpe/drawdown), pas seulement la perf. Sinon une
    valeur périmée d'un calcul antérieur (série depuis réparée/raccourcie) survit
    en base et la garde __insane doit la masquer en aval (ex. vol_3y 169 sur un
    fonds obligataire de 8 mois d'historique)."""

    def _short_series(self, n):
        # n points réguliers, ~+1 % cumulé : amplitude/points insuffisants pour 3Y.
        return [100.0 + i * (1.0 / max(n - 1, 1)) for i in range(n)]

    def test_invalid_3y_window_nulls_all_3y_risk_metrics(self):
        prices_1y = self._short_series(60)        # 1Y valide
        prices_3y = self._short_series(60)         # mêmes points, mais span 3Y court
        spans = {"1y": 360, "3y": 200, "5y": 200}  # span 3Y < MIN_SPAN_3Y → invalide
        fresh = date.today().isoformat()
        metrics = cm.compute_fund_metrics(
            prices_1y, prices_3y, prices_3y, prices_3y, rf=0.03, spans=spans,
            asset_class="obligation", inception="2025-10-01", last_date=fresh,
        )
        # La fenêtre 3Y est invalide → perf ET risque 3Y explicitement purgés.
        for f in ("performance_3y", "volatility_3y", "sharpe_3y", "max_drawdown_3y"):
            self.assertIn(f, metrics)
            self.assertIsNone(metrics[f], f)

    def test_invalid_1y_window_nulls_all_1y_risk_metrics(self):
        tiny = self._short_series(10)              # < MIN_POINTS_1Y → 1Y invalide
        spans = {"1y": 60, "3y": 60, "5y": 60}
        fresh = date.today().isoformat()
        metrics = cm.compute_fund_metrics(
            tiny, tiny, tiny, tiny, rf=0.03, spans=spans,
            asset_class="action", inception="2026-04-01", last_date=fresh,
        )
        for f in ("performance_1y", "volatility_1y", "sharpe_1y", "max_drawdown_1y"):
            self.assertIn(f, metrics)
            self.assertIsNone(metrics[f], f)


class Discontinuity(unittest.TestCase):
    """Garde de discontinuité NAV : neutralise les artefacts à SAUT (point non
    ajusté / split / share-class), préserve les effondrements RÉELS (monotones)
    et les hausses graduelles légitimes."""

    def test_up_jump_detected(self):
        # Point non rebasé : +150 % d'une VL à l'autre = impossible pour un fonds.
        prices = [100.0] * 20 + [400.0] + [410.0] * 20
        self.assertTrue(cm._has_discontinuity(prices))

    def test_isolated_high_spike_detected(self):
        # Pic isolé (mauvais point) qui se renverse vs ses deux voisins.
        prices = [100.0, 101.0, 5000.0, 102.0, 103.0]
        self.assertTrue(cm._has_discontinuity(prices))

    def test_isolated_low_dip_detected(self):
        # Creux isolé (VL tombée à ~0 puis revenue) : point aberrant réversible.
        prices = [100.0, 101.0, 0.05, 102.0, 103.0]
        self.assertTrue(cm._has_discontinuity(prices))

    def test_monotone_real_crash_preserved(self):
        # Effondrement réel (ETF Russie) : baisse graduelle, aucun saut → NON flaggé.
        prices = [100.0 * (0.92 ** i) for i in range(60)]  # ~-99 % lissé
        self.assertFalse(cm._has_discontinuity(prices))

    def test_gradual_gains_preserved(self):
        # Forte hausse réelle mais graduelle (+~120 %) : aucun pas > +150 %.
        prices = [100.0 * (1.013 ** i) for i in range(60)]
        self.assertFalse(cm._has_discontinuity(prices))

    def test_short_series_safe(self):
        self.assertFalse(cm._has_discontinuity([100.0]))
        self.assertFalse(cm._has_discontinuity([]))

    def test_guard_nulls_perf_on_jump_series(self):
        # Bout-en-bout : une fenêtre 1Y avec saut → perf/risque 1Y purgés.
        prices = [100.0] * 30 + [500.0] * 30           # saut ×5 au milieu
        spans = {"1y": 360, "3y": 360, "5y": 360}
        fresh = date.today().isoformat()
        m = cm.compute_fund_metrics(
            prices, prices, prices, prices, rf=0.03, spans=spans,
            asset_class="diversifie", inception="2016-01-01", last_date=fresh,
        )
        for f in ("performance_1y", "volatility_1y", "sharpe_1y", "max_drawdown_1y"):
            self.assertIsNone(m[f], f)

    def test_guard_skips_crypto(self):
        # Crypto : légitimement extrême → le garde ne s'applique pas (perf conservée).
        prices = [100.0] * 30 + [500.0] * 30
        spans = {"1y": 360, "3y": 360, "5y": 360}
        fresh = date.today().isoformat()
        m = cm.compute_fund_metrics(
            prices, prices, prices, prices, rf=0.03, spans=spans,
            asset_class="crypto", inception="2016-01-01", last_date=fresh,
        )
        self.assertIsNotNone(m["performance_1y"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
