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

# Stub `db` pour importer le module sans supabase / env (les fonctions testées
# sont pures ; `requests` est une vraie dépendance, jamais appelée ici).
_fake_db = types.ModuleType("db")
for _name in ("get_client", "upsert_prices", "log_run"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

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

    def test_duplicate_dates_collapsed_to_one(self):
        # GECO renvoie parfois 2 VL pour la même date → sans dédup, l'upsert
        # (on_conflict isin,price_date) plante (21000) et perd le batch.
        payload = {
            "x": ["13-06-2026", "13-06-2026", "16-06-2026"],
            "y": [2.0, 2.5, 3.0],
        }
        out = gn.parse_chart_payload(payload)
        self.assertEqual([p["date"] for p in out], ["2026-06-13", "2026-06-16"])
        # Dernière valeur de la série gardée pour la date en double.
        self.assertEqual(out[0]["nav"], 2.5)

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


class FetchSeriesErrorHandling(unittest.TestCase):
    """fetch_series doit distinguer une série VIDE (fonds sans VL, retour [])
    d'un échec réseau/serveur transitoire (ChartFetchError après retries),
    sinon un 429/5xx ponctuel fige silencieusement la VL du fonds."""

    class _Resp:
        def __init__(self, status, payload=None):
            self.status_code = status
            self._payload = payload if payload is not None else {"x": [], "y": []}
        def json(self):
            return self._payload

    class _Session:
        def __init__(self, responses):
            self._responses = list(responses)
            self.calls = 0
        def get(self, *a, **k):
            self.calls += 1
            r = self._responses[min(self.calls - 1, len(self._responses) - 1)]
            if isinstance(r, Exception):
                raise r
            return r

    def setUp(self):
        # Retries instantanés (pas d'attente réelle en test).
        self._orig_sleep = gn.time.sleep
        gn.time.sleep = lambda *_a, **_k: None
        self._orig_backoff = gn.CHART_BACKOFF_SEC
        gn.CHART_BACKOFF_SEC = 0

    def tearDown(self):
        gn.time.sleep = self._orig_sleep
        gn.CHART_BACKOFF_SEC = self._orig_backoff

    def test_empty_series_returns_empty_not_error(self):
        sess = self._Session([self._Resp(200, {"x": [], "y": []})])
        self.assertEqual(gn.fetch_series(sess, 123), [])
        self.assertEqual(sess.calls, 1)  # pas de retry sur un 200 vide

    def test_transient_5xx_retried_then_raises(self):
        sess = self._Session([self._Resp(503), self._Resp(503), self._Resp(503)])
        with self.assertRaises(gn.ChartFetchError):
            gn.fetch_series(sess, 123)
        self.assertEqual(sess.calls, gn.CHART_RETRIES)  # a bien retenté

    def test_transient_then_success(self):
        sess = self._Session([
            self._Resp(429),
            self._Resp(200, {"x": ["16-06-2026"], "y": [10.0]}),
        ])
        out = gn.fetch_series(sess, 123)
        self.assertEqual([p["date"] for p in out], ["2026-06-16"])
        self.assertEqual(sess.calls, 2)  # 1 échec + 1 succès

    def test_permanent_4xx_not_retried(self):
        sess = self._Session([self._Resp(404), self._Resp(200)])
        with self.assertRaises(gn.ChartFetchError):
            gn.fetch_series(sess, 123)
        self.assertEqual(sess.calls, 1)  # 404 = définitif, pas de retry


if __name__ == "__main__":
    unittest.main(verbosity=2)
