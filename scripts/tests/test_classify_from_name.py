#!/usr/bin/env python3
"""Tests unitaires de classify-from-name.py (stdlib, sans pytest).

Lancer : python3 scripts/tests/test_classify_from_name.py

Verrouille la régression « SCPI sous long/short » (Corum Origin) : le facet
management_style (passif/actif/smart_beta/alternatif) décrit une APPROCHE de
gestion d'un portefeuille liquide. Il n'a aucun sens sur un véhicule défini par
sa classe d'actif (SCPI/OPCI = immobilier, FPCI/FCPR = non coté, structuré =
payoff). Historiquement ces véhicules arrivaient en « Alternative » depuis les
sources → une requête NLP « long/short » (→ management_style=alternatif) faisait
remonter des SCPI géantes. classify() ne doit JAMAIS leur assigner de style.
"""
import sys
import types
import importlib.util
import unittest
from pathlib import Path

# Stub `db` : classify() est pur, aucune I/O réseau/DB nécessaire à l'import.
_fake_db = types.ModuleType("db")
for _name in ("get_client", "log_run"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

_PATH = Path(__file__).resolve().parents[1] / "enrichers" / "classify-from-name.py"
_spec = importlib.util.spec_from_file_location("classify_from_name", _PATH)
cfn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cfn)


class TestManagementStyleAssetClassCollision(unittest.TestCase):
    """Aucun véhicule défini par sa classe d'actif ne reçoit de style de gestion."""

    def test_scpi_never_gets_management_style(self):
        # Le vrai coupable : SCPI immobilière taggée alternatif via la source.
        out = cfn.classify("Corum Origin", "scpi", "Immobilier", "Real Estate")
        self.assertNotIn("management_style", out)

    def test_scpi_with_alternative_in_name_still_no_style(self):
        # Même si le NOM matche STYLE_RULES, le product_type prime.
        out = cfn.classify("Pierre Absolute Return SCPI", "scpi", None, None)
        self.assertNotIn("management_style", out)

    def test_non_style_product_types(self):
        for pt in ("scpi", "opci", "fpci", "fcpr", "fcpi", "fip", "structuré"):
            out = cfn.classify("Long Short Alternative Fund", pt, None, None)
            self.assertNotIn("management_style", out, f"{pt} ne doit pas avoir de style")

    def test_liquid_alt_opcvm_keeps_alternatif(self):
        # Contre-preuve : un vrai fonds long/short liquide DOIT rester alternatif.
        out = cfn.classify("Eleva Absolute Return Europe Fund", "opcvm", None, None)
        self.assertEqual(out.get("management_style"), "alternatif")

    def test_etf_still_defaults_passif(self):
        # Garde-fou : l'override ETF→passif n'est pas cassé par le nouveau garde.
        out = cfn.classify("iShares Core MSCI World", "etf", None, None)
        self.assertEqual(out.get("management_style"), "passif")


if __name__ == "__main__":
    unittest.main(verbosity=2)
