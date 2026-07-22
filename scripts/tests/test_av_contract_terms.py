#!/usr/bin/env python3
"""Tests unitaires de av-contract-terms.py (_normalize), stdlib, sans pytest.

Lancer : python3 scripts/tests/test_av_contract_terms.py

Régression : le champ frais_gestion_fonds_euros_pct captait la RÉDUCTION DE
GARANTIE en capital du fonds euros (ex. « garanti net de 2 % de frais » = 98 %)
comme si c'était un frais de gestion. Résultat : ~34 contrats (surtout Spirica)
affichaient un frais de gestion de fonds euros de 2,0 à 2,3 %, aberrant (norme
0,50 à 0,85 %). Le plafond de ce champ est désormais serré à 1,2 % → toute valeur
au-dessus (clause de garantie) est rejetée.
"""
import sys
import types
import importlib.util
import unittest
from pathlib import Path

# Stub `db` et `_av_pdf_common` pour importer le module sans supabase / réseau
# (la fonction testée, _normalize, est pure).
_fake_db = types.ModuleType("db")
for _name in ("get_client", "log_run", "upsert_prices", "compute_completeness"):
    setattr(_fake_db, _name, lambda *a, **k: None)
sys.modules.setdefault("db", _fake_db)

_fake_pdf = types.ModuleType("_av_pdf_common")
_fake_pdf.make_session = lambda *a, **k: None
_fake_pdf.fetch_pdf_text = lambda *a, **k: None
_fake_pdf.DEFAULT_TIMEOUT = 30
sys.modules.setdefault("_av_pdf_common", _fake_pdf)

_PATH = Path(__file__).resolve().parents[1] / "scrapers" / "av-contract-terms.py"
_spec = importlib.util.spec_from_file_location("av_contract_terms", _PATH)
act = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(act)


def _norm(raw):
    return act._normalize(raw, "Spirica::Linxea Spirit 2", "Spirica", "Linxea Spirit 2", "https://x")


class TestFondsEurosFeeGuard(unittest.TestCase):
    def test_guarantee_reduction_rejected(self):
        # 2,0 % = réduction de garantie, PAS un frais → doit être rejeté (absent).
        row = _norm({"frais_gestion_fonds_euros_pct": 2.0})
        self.assertNotIn("frais_gestion_fonds_euros_pct", row)

    def test_2_3_rejected(self):
        row = _norm({"frais_gestion_fonds_euros_pct": 2.3})
        self.assertNotIn("frais_gestion_fonds_euros_pct", row)

    def test_just_above_cap_rejected(self):
        row = _norm({"frais_gestion_fonds_euros_pct": 1.3})
        self.assertNotIn("frais_gestion_fonds_euros_pct", row)

    def test_real_fee_kept(self):
        # 0,70 % = vrai frais de gestion (fonds euros Nouvelle Génération) → conservé.
        row = _norm({"frais_gestion_fonds_euros_pct": 0.70})
        self.assertEqual(row["frais_gestion_fonds_euros_pct"], 0.70)

    def test_boundary_kept(self):
        row = _norm({"frais_gestion_fonds_euros_pct": 1.2})
        self.assertEqual(row["frais_gestion_fonds_euros_pct"], 1.2)

    def test_uc_fee_not_over_capped(self):
        # Le plafond serré ne s'applique QU'au fonds euros : les frais UC gardent 10 %.
        row = _norm({"frais_gestion_uc_pct": 1.0})
        self.assertEqual(row["frais_gestion_uc_pct"], 1.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
