#!/usr/bin/env python3
"""
extranet-nomineo-connector.py — Connecteur Generali Patrimoine (Nomineo/Genepro)
=================================================================================
Deux modes d'import pour les données Generali Patrimoine :

  Mode 1 — BATCH PDF (recommandé, sans réseau Generali)
    Traite un dossier de PDFs Genepro exportés manuellement depuis Nomineo.
    Utilise le parser existant (scripts/parsers/genepro_parser.py).
    Même résultat que genepro-import.py, mais en volume.

  Mode 2 — WEB (requiert VPN Generali ou réseau partenaire Generali)
    Nomineo (nomineo.generali.fr) est un intranet Generali — pas de DNS public.
    Ce mode est un squelette à activer une fois l'accès réseau disponible.
    Auth : form POST avec identifiants CGP + cookies de session.

Tables alimentées :
  cgp_clients      (cgp_id, client_ref, last_name, first_name)
  cgp_contracts    (cgp_id, client_id, insurer, contract_number, total_value_eur, …)
  cgp_positions    (contract_id, isin, value_eur, valuation_date, …)
  cgp_transactions (contract_id, transaction_type, transaction_date, …)

Usage :
    # Mode batch PDF (dossier de fichiers .pdf exportés de Genepro)
    python3 scripts/importers/extranet-nomineo-connector.py \\
        --mode pdf --folder /chemin/vers/pdfs --cgp-id <UUID>

    # Mode dry-run batch PDF
    python3 scripts/importers/extranet-nomineo-connector.py \\
        --mode pdf --folder /chemin/vers/pdfs --cgp-id <UUID> --dry-run

    # Mode web (réseau Generali requis)
    NOMINEO_LOGIN=xxx NOMINEO_PASSWORD=yyy CGP_ID=<UUID> \\
        python3 scripts/importers/extranet-nomineo-connector.py --mode web --apply

Comment exporter depuis Nomineo :
  1. Se connecter sur https://nomineo.generali.fr (réseau Generali / VPN requis)
  2. Menu Portefeuille → Relevés de situation
  3. Sélectionner tous les clients → Exporter PDF
  4. Déposer les PDFs dans un dossier local
  5. Lancer ce script en mode pdf
"""

import os
import sys
import argparse
import time
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

sys.path.insert(0, str(Path(__file__).parent))
from cgp_common import upsert_all

sys.path.insert(0, str(Path(__file__).parent.parent / "parsers"))
from genepro_parser import parse

# ─── Config ───────────────────────────────────────────────────────────────────

NOMINEO_URL  = "https://nomineo.generali.fr"   # intranet-only (no public DNS)
LOGIN_PATH   = "/login"
RATE_LIMIT   = 0.5  # secondes entre fichiers PDF
TIMEOUT      = 30

HEADERS = {
    "User-Agent":   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":       "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9",
}


# ─── Mode 1 : Batch PDF ───────────────────────────────────────────────────────

def batch_pdf(folder: Path, cgp_id: str, apply: bool, verbose: bool):
    """Traite tous les PDFs d'un dossier Genepro."""
    print("=" * 60)
    print("  Nomineo/Genepro — Import Batch PDF")
    print("=" * 60)
    print(f"  Dossier : {folder}")
    print(f"  CGP ID  : {cgp_id}")
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    pdfs = sorted(folder.glob("*.pdf")) + sorted(folder.glob("*.PDF"))
    print(f"  {len(pdfs)} fichier(s) PDF trouvé(s)")
    if not pdfs:
        print("  Aucun PDF à traiter — vérifier le dossier")
        return

    started = datetime.now(timezone.utc)
    client  = get_client() if apply else None

    total_ok = total_fail = 0
    file_results = []

    for i, pdf_path in enumerate(pdfs, 1):
        print(f"\n  [{i:3}/{len(pdfs)}] {pdf_path.name}")

        try:
            file_bytes = pdf_path.read_bytes()
            parsed = parse(file_bytes, pdf_path.name)
        except Exception as e:
            print(f"  ✗ Parse error : {e}")
            total_fail += 1
            file_results.append({"file": pdf_path.name, "status": "parse_error", "error": str(e)})
            continue

        contract = parsed.get("contract", {})
        positions = parsed.get("positions", [])
        transactions = parsed.get("transactions", [])

        print(f"    Contrat    : {contract.get('number', '?')} — {contract.get('name', '?')}")
        if contract.get("total_value_eur"):
            print(f"    Total      : {contract['total_value_eur']:,.2f} €")
        print(f"    Positions  : {len(positions)}")
        print(f"    Transact.  : {len(transactions)}")

        if parsed.get("_parse_warnings"):
            for w in parsed["_parse_warnings"]:
                print(f"    ⚠ {w}")

        if not positions:
            print("    Aucune position extraite — fichier ignoré")
            total_fail += 1
            continue

        if not apply:
            if verbose:
                for pos in positions[:5]:
                    val = f"{pos['value_eur']:>12,.2f} €" if pos.get("value_eur") else "?"
                    print(f"      {pos['isin']} | {val} | {pos.get('fund_name', '')[:40]}")
            total_ok += 1
            continue

        # Upsert en base
        ok, fail = _upsert_parsed(client, cgp_id, parsed, verbose)
        total_ok  += ok
        total_fail += fail
        file_results.append({"file": pdf_path.name, "ok": ok, "fail": fail})

        time.sleep(RATE_LIMIT)

    print(f"\n  ─────────────────────────────────────────────")
    print(f"  Total : {total_ok} lignes insérées, {total_fail} échecs")

    if apply:
        status = "success" if total_fail == 0 else "partial"
        log_run(
            "nomineo-batch-pdf",
            status,
            total_ok,
            total_fail,
            started_at=started,
        )


def _upsert_parsed(client, cgp_id: str, parsed: dict, verbose: bool) -> tuple[int, int]:
    """Upsert client, contrat, positions, transactions dans Supabase."""
    ok = fail = 0

    # Client
    client_data = parsed.get("client", {})
    contract    = parsed.get("contract", {})
    client_ref  = client_data.get("ref") or contract.get("number")
    client_id   = None

    if client_ref:
        try:
            existing = (
                client.table("cgp_clients")
                .select("id")
                .eq("cgp_id", cgp_id)
                .eq("client_ref", client_ref)
                .limit(1)
                .execute()
            )
            if existing.data:
                client_id = existing.data[0]["id"]
            else:
                row = {
                    "cgp_id":     cgp_id,
                    "client_ref": client_ref,
                    "last_name":  client_data.get("last_name") or "INCONNU",
                }
                if client_data.get("first_name"):
                    row["first_name"] = client_data["first_name"]
                res = client.table("cgp_clients").insert(row).execute()
                client_id = res.data[0]["id"] if res.data else None
        except Exception as e:
            print(f"    ✗ client : {e}")

    if not client_id:
        return 0, 1

    # Contrat
    contract_number = contract.get("number")
    contract_id = None
    if contract_number:
        try:
            existing = (
                client.table("cgp_contracts")
                .select("id")
                .eq("cgp_id", cgp_id)
                .eq("contract_number", contract_number)
                .limit(1)
                .execute()
            )
            upd = {"updated_at": datetime.now(timezone.utc).isoformat()}
            if contract.get("total_value_eur"):
                upd["total_value_eur"] = contract["total_value_eur"]
            if contract.get("valuation_date"):
                upd["last_valuation_date"] = str(contract["valuation_date"])
            if contract.get("name"):
                upd["contract_name"] = contract["name"]
            if parsed.get("_source_file"):
                upd["source_file"] = parsed["_source_file"]

            if existing.data:
                contract_id = existing.data[0]["id"]
                client.table("cgp_contracts").update(upd).eq("id", contract_id).execute()
            else:
                row = {
                    "client_id":       client_id,
                    "cgp_id":          cgp_id,
                    "insurer":         "generali",
                    "contract_number": contract_number,
                    **upd,
                }
                if contract.get("opening_date"):
                    row["opening_date"] = str(contract["opening_date"])
                res = client.table("cgp_contracts").insert(row).execute()
                contract_id = res.data[0]["id"] if res.data else None
        except Exception as e:
            print(f"    ✗ contrat : {e}")

    if not contract_id:
        return 0, 1

    valuation_dt = contract.get("valuation_date")
    source_file  = parsed.get("_source_file", "")

    # Positions
    for pos in parsed.get("positions", []):
        isin      = pos.get("isin")
        value_eur = pos.get("value_eur")
        if not isin or not value_eur:
            fail += 1
            continue
        row = {
            "contract_id":    contract_id,
            "isin":           isin,
            "value_eur":      value_eur,
            "valuation_date": str(valuation_dt) if valuation_dt else None,
        }
        if pos.get("fund_name"):
            row["fund_name"] = pos["fund_name"][:200]
        if pos.get("units") is not None:
            row["units"] = pos["units"]
        if pos.get("unit_value") is not None:
            row["unit_value"] = pos["unit_value"]
        if pos.get("weight_pct") is not None:
            row["weight_pct"] = pos["weight_pct"]
        if source_file:
            row["source_file"] = source_file

        try:
            client.table("cgp_positions").upsert(
                row, on_conflict="contract_id,isin,valuation_date"
            ).execute()
            ok += 1
            if verbose:
                val_str = f"{value_eur:>12,.2f} €"
                print(f"    + {isin} | {val_str} | {pos.get('fund_name','')[:35]}")
        except Exception as e:
            fail += 1
            print(f"    ✗ position {isin} : {e}")

    # Transactions
    for tx in parsed.get("transactions", []):
        tx_date = tx.get("transaction_date")
        tx_type = tx.get("transaction_type")
        amount  = tx.get("amount_eur")
        if not tx_date or not tx_type or amount is None:
            continue
        row = {
            "contract_id":      contract_id,
            "transaction_type": tx_type,
            "transaction_date": str(tx_date),
            "amount_eur":       amount,
        }
        if tx.get("isin"):
            row["isin"] = tx["isin"]
        if tx.get("fund_name"):
            row["fund_name"] = tx["fund_name"][:200]
        if tx.get("units") is not None:
            row["units"] = tx["units"]
        if tx.get("unit_value") is not None:
            row["unit_value"] = tx["unit_value"]
        if source_file:
            row["source_file"] = source_file

        try:
            client.table("cgp_transactions").upsert(
                row,
                on_conflict="contract_id,transaction_type,transaction_date,isin,amount_eur",
            ).execute()
            ok += 1
        except Exception as e:
            fail += 1

    return ok, fail


# ─── Mode 2 : Web Nomineo (intranet Generali) ────────────────────────────────

class NomineoSession:
    """
    Connecteur web Nomineo — requiert réseau Generali (VPN ou site partenaire).
    nomineo.generali.fr n'est pas accessible depuis l'internet public (DNS interne).
    """

    def __init__(self, login: str, password: str):
        self.login    = login
        self.password = password
        self.session  = requests.Session()
        self._logged  = False

    def authenticate(self) -> bool:
        """
        Auth Nomineo : form POST avec identifiants CGP.
        Structure exacte à confirmer avec accès réseau Generali.
        Probables champs : username/password ou login/mdp.
        """
        login_url = f"{NOMINEO_URL}{LOGIN_PATH}"
        try:
            # Récupérer le formulaire pour les tokens CSRF éventuels
            r1 = self.session.get(login_url, headers=HEADERS, timeout=TIMEOUT)
            if r1.status_code != 200:
                print(f"  ✗ Nomineo inaccessible : HTTP {r1.status_code}")
                print("     Vérifier l'accès réseau (VPN Generali requis)")
                return False

            # Extraire CSRF si présent
            import re
            csrf_match = re.search(r'name="[_csrf]+" value="([^"]+)"', r1.text)
            csrf_token = csrf_match.group(1) if csrf_match else None

            # POST credentials (champs à confirmer)
            post_data = {
                "username": self.login,
                "password": self.password,
            }
            if csrf_token:
                post_data["_csrf"] = csrf_token

            r2 = self.session.post(
                login_url,
                data=post_data,
                headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
                timeout=TIMEOUT,
                allow_redirects=True,
            )

            self._logged = r2.status_code == 200 and "logout" in r2.text.lower()
            if self._logged:
                print("  ✓ Authentification Nomineo réussie")
            else:
                print("  ✗ Authentification Nomineo échouée")
                print("     Vérifier les champs du formulaire (username/password)")
            return self._logged

        except requests.exceptions.ConnectionError:
            print("  ✗ Connexion refusée — nomineo.generali.fr est intranet-only")
            print("     Requiert réseau Generali (VPN ou accès partenaire)")
            return False

    def download_statements(self) -> list[bytes]:
        """
        Télécharge les relevés clients disponibles.
        À implémenter après cartographie du portail avec accès réseau Generali.

        Pistes :
          - GET /portefeuille/releves → liste de contrats
          - GET /releve/{id}/pdf → téléchargement PDF
          - POST /export/batch → export groupé
        """
        print("  ⚠  download_statements() à implémenter après accès réseau Generali")
        return []


def web_mode(login: str, password: str, cgp_id: str, apply: bool, verbose: bool):
    """Mode web Nomineo (intranet Generali)."""
    print("=" * 60)
    print("  Nomineo/Genepro — Connecteur Web")
    print("=" * 60)
    print(f"  URL    : {NOMINEO_URL}")
    print(f"  Login  : {login}")
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    print()
    print("  ⚠  Nomineo est sur l'intranet Generali (pas de DNS public).")
    print("     Ce connecteur nécessite un accès réseau Generali (VPN/partenaire).")
    print()

    started = datetime.now(timezone.utc)
    nomineo = NomineoSession(login, password)

    if not nomineo.authenticate():
        if apply:
            log_run("nomineo-web", "failed", 0, 0, started_at=started)
        return

    pdfs = nomineo.download_statements()
    print(f"  {len(pdfs)} relevé(s) téléchargé(s)")

    if not pdfs:
        return

    client = get_client() if apply else None
    ok = fail = 0
    for pdf_bytes in pdfs:
        parsed = parse(pdf_bytes, "nomineo_web.pdf")
        if parsed.get("positions") and apply:
            n_ok, n_fail = _upsert_parsed(client, cgp_id, parsed, verbose)
            ok += n_ok
            fail += n_fail

    print(f"  → {ok} OK, {fail} échec")
    if apply:
        log_run("nomineo-web", "success" if fail == 0 else "partial", ok, fail, started_at=started)


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generali Nomineo/Genepro Connector")
    parser.add_argument("--mode",     choices=["pdf", "web"], default="pdf",
                        help="pdf = batch PDF, web = connexion Nomineo (intranet Generali)")
    parser.add_argument("--folder",   type=Path, default=None,
                        help="Dossier contenant les PDFs Genepro (mode pdf)")
    parser.add_argument("--login",    default=os.environ.get("NOMINEO_LOGIN", ""),
                        help="Identifiant Nomineo (mode web)")
    parser.add_argument("--password", default=os.environ.get("NOMINEO_PASSWORD", ""),
                        help="Mot de passe Nomineo (mode web)")
    parser.add_argument("--cgp-id",   default=os.environ.get("CGP_ID", ""),
                        help="UUID du cabinet CGP dans Supabase")
    parser.add_argument("--apply",    action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--dry-run",  action="store_true", help="Alias de --apply absent")
    parser.add_argument("--verbose",  action="store_true")
    args = parser.parse_args()

    apply = args.apply and not args.dry_run

    if args.mode == "pdf":
        if not args.folder:
            print("Erreur : --folder requis en mode pdf")
            sys.exit(1)
        if not args.folder.is_dir():
            print(f"Erreur : {args.folder} n'est pas un dossier")
            sys.exit(1)
        if apply and not args.cgp_id:
            print("Erreur : --cgp-id requis avec --apply")
            sys.exit(1)
        batch_pdf(args.folder, args.cgp_id, apply=apply, verbose=args.verbose)

    elif args.mode == "web":
        if not args.login or not args.password:
            print("Erreur : --login et --password requis (ou NOMINEO_LOGIN / NOMINEO_PASSWORD)")
            sys.exit(1)
        if apply and not args.cgp_id:
            print("Erreur : --cgp-id requis avec --apply")
            sys.exit(1)
        web_mode(args.login, args.password, args.cgp_id, apply=apply, verbose=args.verbose)
