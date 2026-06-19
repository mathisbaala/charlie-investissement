#!/usr/bin/env python3
"""Tests unitaires de scpi-primaliance-enricher.py (stdlib, sans pytest).

Lancer : python3 scripts/tests/test_scpi_primaliance.py

Verrouille le parsing des nombres français (virgule décimale, séparateurs de
milliers insécables, M€) et la normalisation de noms — fragiles et au cœur du
refresh trimestriel des SCPI (taux de distribution → performance_1y).
"""
import sys
import types
import importlib.util
import unittest
from pathlib import Path

# Stub `db` ; requests/parsel sont de vraies deps (non appelées dans ces tests).
_fake_db = types.ModuleType("db")
for _name in ("get_client", "log_run"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

_PATH = Path(__file__).resolve().parents[1] / "scrapers" / "scpi-primaliance-enricher.py"
_spec = importlib.util.spec_from_file_location("scpi_primaliance", _PATH)
sp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sp)


class Parsers(unittest.TestCase):
    def test_parse_percent_french(self):
        self.assertEqual(sp.parse_percent("7,98 %"), 7.98)
        self.assertEqual(sp.parse_percent("4,80%"), 4.80)
        self.assertEqual(sp.parse_percent("-0,54 %"), -0.54)
        self.assertIsNone(sp.parse_percent("n/a"))
        self.assertIsNone(sp.parse_percent(""))

    def test_parse_capitalisation_millions(self):
        # Séparateur de milliers insécable (\xa0) + virgule décimale + M€.
        self.assertEqual(sp.parse_capitalisation("1\xa0051,87 M€"), 1_051_870_000)
        self.assertEqual(sp.parse_capitalisation("306,94 M€"), 306_940_000)
        self.assertIsNone(sp.parse_capitalisation("—"))

    def test_parse_year(self):
        self.assertEqual(sp.parse_year("Date de création 1976"), 1976)
        self.assertEqual(sp.parse_year("2021"), 2021)
        self.assertIsNone(sp.parse_year("non communiqué"))

    def test_normalize_strips_accents_and_noise(self):
        # Tout caractère non [A-Z0-9] est retiré (le ² exposant inclus).
        self.assertEqual(sp.normalize("PFO² (Bureaux)"), "PFOBUREAUX")
        self.assertEqual(sp.normalize("Épargne Pierre"), "EPARGNEPIERRE")

    def test_parse_prix_part(self):
        # 'Prix de part : 458,00€' (souvent avec balises et espaces insécables).
        self.assertEqual(sp.parse_prix_part("<span>Prix de part :</span> 458,00€"), 458.0)
        self.assertEqual(sp.parse_prix_part("Prix de part : 1\xa0234,50 €"), 1234.50)
        self.assertIsNone(sp.parse_prix_part("Capitalisation : 1 051,87 M€"))
        self.assertIsNone(sp.parse_prix_part(""))

    def test_refreshable_set(self):
        # Les métriques qui changent sont réécrites en --refresh ; l'identité non.
        self.assertIn("performance_1y", sp.REFRESHABLE)
        self.assertIn("aum_eur", sp.REFRESHABLE)
        self.assertNotIn("management_company", sp.REFRESHABLE)
        self.assertNotIn("sri", sp.REFRESHABLE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
