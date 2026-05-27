#!/usr/bin/env python3
"""
run-cgp-all.py — Orchestrateur CGP extranets Tier 1
=====================================================
Lance les 4 connecteurs CGP en séquence et produit un bilan consolidé.

Extranets couverts :
  1. Generali Patrimoine  (Nomineo PDF batch)
  2. BNP Paribas Cardif   (Finagora OIDC)
  3. Spirica              (WordPress)
  4. Suravenir            (Oriadys Liferay)

Variables d'environnement :
  CGP_ID              — UUID du cabinet dans Supabase (obligatoire pour --apply)
  GENERALI_PDF_FOLDER — chemin vers les PDFs Genepro (optionnel)
  FINAGORA_LOGIN / FINAGORA_PASSWORD
  SPIRICA_LOGIN  / SPIRICA_PASSWORD
  ORIADYS_LOGIN  / ORIADYS_PASSWORD

Usage :
    # Dry-run tous les connecteurs disponibles
    CGP_ID=<uuid> python3 scripts/importers/run-cgp-all.py --dry-run

    # Lancer en mode apply avec tous les credentials
    CGP_ID=<uuid> \\
      GENERALI_PDF_FOLDER=/chemin/vers/pdfs \\
      FINAGORA_LOGIN=xxx FINAGORA_PASSWORD=yyy \\
      SPIRICA_LOGIN=xxx  SPIRICA_PASSWORD=yyy \\
      ORIADYS_LOGIN=xxx  ORIADYS_PASSWORD=yyy \\
      python3 scripts/importers/run-cgp-all.py --apply

    # Mode explore : cartographier tous les portails après auth
    python3 scripts/importers/run-cgp-all.py --explore

    # Lancer uniquement certains connecteurs
    python3 scripts/importers/run-cgp-all.py --apply --only finagora spirica
"""

import os
import sys
import argparse
import subprocess
from datetime import datetime
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
PYTHON     = sys.executable

CONNECTORS = {
    "nomineo": {
        "script":  SCRIPT_DIR / "extranet-nomineo-connector.py",
        "insurer": "Generali Patrimoine (Nomineo PDF)",
        "env_vars": ["GENERALI_PDF_FOLDER"],
        "requires_folder": True,
    },
    "finagora": {
        "script":  SCRIPT_DIR / "extranet-finagora-connector.py",
        "insurer": "BNP Paribas Cardif (Finagora)",
        "env_vars": ["FINAGORA_LOGIN", "FINAGORA_PASSWORD"],
    },
    "spirica": {
        "script":  SCRIPT_DIR / "extranet-spirica-connector.py",
        "insurer": "Spirica (Crédit Agricole)",
        "env_vars": ["SPIRICA_LOGIN", "SPIRICA_PASSWORD"],
    },
    "oriadys": {
        "script":  SCRIPT_DIR / "extranet-oriadys-connector.py",
        "insurer": "Suravenir (Oriadys/Arkea)",
        "env_vars": ["ORIADYS_LOGIN", "ORIADYS_PASSWORD"],
    },
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def has_credentials(connector: str) -> bool:
    cfg = CONNECTORS[connector]
    env_vars = cfg["env_vars"]
    return all(os.environ.get(v, "").strip() for v in env_vars)


def build_cmd(connector: str, cgp_id: str, apply: bool, explore: bool, verbose: bool) -> list[str] | None:
    cfg    = CONNECTORS[connector]
    script = cfg["script"]

    if not script.exists():
        print(f"  ✗ Script manquant : {script}")
        return None

    cmd = [PYTHON, str(script)]

    if connector == "nomineo":
        folder = os.environ.get("GENERALI_PDF_FOLDER", "").strip()
        if not folder:
            return None  # Skip Nomineo si pas de dossier PDF
        cmd += ["--mode", "pdf", "--folder", folder]
    else:
        login_key = f"{connector.upper()}_LOGIN"
        pwd_key   = f"{connector.upper()}_PASSWORD"
        if connector == "oriadys":
            login_key = "ORIADYS_LOGIN"
            pwd_key   = "ORIADYS_PASSWORD"
        login    = os.environ.get(login_key, "")
        password = os.environ.get(pwd_key, "")
        if not login or not password:
            return None  # Skip si pas de credentials
        cmd += ["--login", login, "--password", password]

    if cgp_id:
        cmd += ["--cgp-id", cgp_id]
    if explore:
        cmd += ["--explore"]
    elif apply:
        cmd += ["--apply"]
    else:
        cmd += ["--dry-run"]
    if verbose:
        cmd += ["--verbose"]

    return cmd


# ─── Runner ───────────────────────────────────────────────────────────────────

def run_all(
    cgp_id: str,
    apply: bool,
    explore: bool,
    verbose: bool,
    only: list[str] | None,
):
    started = datetime.now()
    mode_label = "EXPLORE" if explore else ("APPLY" if apply else "DRY-RUN")

    print("=" * 70)
    print(f"  CGP Extranets — Orchestrateur Tier 1  [{mode_label}]")
    print(f"  {started.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    targets = only if only else list(CONNECTORS.keys())
    results = {}

    for name in targets:
        if name not in CONNECTORS:
            print(f"  ⚠  Connecteur inconnu : {name}")
            continue

        cfg = CONNECTORS[name]
        print(f"\n  ── {cfg['insurer']} ──")

        cmd = build_cmd(name, cgp_id, apply, explore, verbose)
        if cmd is None:
            if name == "nomineo":
                print("  ⏭  Ignoré : GENERALI_PDF_FOLDER non défini")
            else:
                missing = [v for v in cfg["env_vars"] if not os.environ.get(v)]
                print(f"  ⏭  Ignoré : credentials manquants ({', '.join(missing)})")
            results[name] = "skipped"
            continue

        print(f"  $ {' '.join(cmd[:3])} …")
        t0 = datetime.now()
        try:
            ret = subprocess.run(cmd, check=False)
            elapsed = (datetime.now() - t0).seconds
            if ret.returncode == 0:
                results[name] = "ok"
                print(f"  ✓ {name} terminé en {elapsed}s")
            else:
                results[name] = "error"
                print(f"  ✗ {name} terminé avec code {ret.returncode}")
        except KeyboardInterrupt:
            print(f"\n  Interrompu sur {name}")
            results[name] = "interrupted"
            break
        except Exception as e:
            results[name] = "exception"
            print(f"  ✗ Exception {name} : {e}")

    # ─── Bilan ────────────────────────────────────────────────────────────────
    elapsed_total = (datetime.now() - started).seconds
    print("\n" + "=" * 70)
    print(f"  Bilan — {elapsed_total}s total")
    print("=" * 70)

    icons = {"ok": "✓", "skipped": "⏭", "error": "✗", "exception": "✗", "interrupted": "⚠"}
    for name, status in results.items():
        cfg = CONNECTORS.get(name, {})
        icon = icons.get(status, "?")
        print(f"  {icon} {cfg.get('insurer', name):45s}  {status}")

    n_ok      = sum(1 for s in results.values() if s == "ok")
    n_skipped = sum(1 for s in results.values() if s == "skipped")
    n_error   = sum(1 for s in results.values() if s in ("error", "exception"))

    print(f"\n  {n_ok} OK  |  {n_skipped} ignorés  |  {n_error} erreurs")

    if n_skipped > 0:
        print("\n  Pour activer les connecteurs ignorés, définir les variables :")
        for name, status in results.items():
            if status == "skipped":
                cfg = CONNECTORS[name]
                for v in cfg["env_vars"]:
                    if not os.environ.get(v):
                        print(f"    export {v}=<valeur>")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Orchestrateur CGP extranets Tier 1")
    parser.add_argument("--cgp-id",  default=os.environ.get("CGP_ID", ""))
    parser.add_argument("--apply",   action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--explore", action="store_true",
                        help="Mode exploration : cartographie les portails sans upsert")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--only",    nargs="+", choices=list(CONNECTORS.keys()),
                        help="Lancer uniquement ces connecteurs")
    args = parser.parse_args()

    apply = args.apply and not args.dry_run

    if apply and not args.cgp_id:
        print("Erreur : --cgp-id requis avec --apply (ou export CGP_ID=<uuid>)")
        sys.exit(1)

    run_all(
        cgp_id=args.cgp_id,
        apply=apply,
        explore=args.explore,
        verbose=args.verbose,
        only=args.only,
    )
