#!/usr/bin/env python3
"""
genepro-import.py — Import relevé Generali Genepro dans Charlie
================================================================
Lit un PDF ou CSV exporté depuis l'extranet Genepro, le parse,
et insère les données dans les tables cgp_* de Supabase.

Tables alimentées :
  cgp_clients      — créé ou retrouvé par (cgp_id, client_ref)
  cgp_contracts    — créé ou retrouvé par (cgp_id, contract_number)
  cgp_positions    — upsert par (contract_id, isin, valuation_date)
  cgp_transactions — upsert par (contract_id, type, date, isin, montant)

Usage :
    python3 scripts/importers/genepro-import.py --file releve.pdf --cgp-id <UUID>
    python3 scripts/importers/genepro-import.py --file releve.pdf --cgp-id <UUID> --apply
    python3 scripts/importers/genepro-import.py --file releve.csv --cgp-id <UUID> --apply

Options :
    --file      Chemin vers le PDF ou CSV Genepro
    --cgp-id    UUID du cabinet CGP dans Supabase (auth.users)
    --apply     Écrire dans Supabase (sans : dry-run)
    --verbose   Afficher les détails de chaque ligne insérée
"""

import sys
import argparse
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# Importer le parser depuis scripts/parsers/
sys.path.insert(0, str(Path(__file__).parent.parent / "parsers"))
from genepro_parser import parse


# ─── Supabase upsert helpers ──────────────────────────────────────────────────

def upsert_client(client: object, cgp_id: str, parsed: dict) -> str | None:
    """Crée ou retrouve un cgp_client. Retourne l'UUID."""
    client_data = parsed.get("client", {})
    contract    = parsed.get("contract", {})
    # ref = numéro de contrat en fallback
    client_ref  = client_data.get("ref") or contract.get("number")
    if not client_ref:
        return None

    last_name  = client_data.get("last_name") or "INCONNU"
    first_name = client_data.get("first_name")

    try:
        existing = (
            client
            .table("cgp_clients")
            .select("id")
            .eq("cgp_id", cgp_id)
            .eq("client_ref", client_ref)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]["id"]

        # Insertion
        row = {
            "cgp_id":     cgp_id,
            "client_ref": client_ref,
            "last_name":  last_name,
        }
        if first_name:
            row["first_name"] = first_name

        res = client.table("cgp_clients").insert(row).execute()
        return res.data[0]["id"] if res.data else None
    except Exception as e:
        print(f"  ✗ Erreur upsert client : {e}")
        return None


def upsert_contract(client: object, cgp_id: str, client_id: str,
                    parsed: dict) -> str | None:
    """Crée ou met à jour un cgp_contract. Retourne l'UUID."""
    c = parsed.get("contract", {})
    contract_number = c.get("number")
    if not contract_number:
        return None

    try:
        existing = (
            client
            .table("cgp_contracts")
            .select("id")
            .eq("cgp_id", cgp_id)
            .eq("contract_number", contract_number)
            .limit(1)
            .execute()
        )

        update_data = {
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if c.get("total_value_eur"):
            update_data["total_value_eur"] = c["total_value_eur"]
        if c.get("valuation_date"):
            update_data["last_valuation_date"] = str(c["valuation_date"])
        if c.get("contract_name"):
            update_data["contract_name"] = c["contract_name"]
        if parsed.get("_source_file"):
            update_data["source_file"] = parsed["_source_file"]

        if existing.data:
            contract_id = existing.data[0]["id"]
            client.table("cgp_contracts").update(update_data).eq("id", contract_id).execute()
            return contract_id

        row = {
            "client_id":       client_id,
            "cgp_id":          cgp_id,
            "insurer":         "generali",
            "contract_number": contract_number,
            **update_data,
        }
        if c.get("opening_date"):
            row["opening_date"] = str(c["opening_date"])
        res = client.table("cgp_contracts").insert(row).execute()
        return res.data[0]["id"] if res.data else None
    except Exception as e:
        print(f"  ✗ Erreur upsert contrat : {e}")
        return None


def upsert_positions(client: object, contract_id: str, parsed: dict,
                     verbose: bool) -> tuple[int, int]:
    """Upsert des positions. Retourne (ok, fail)."""
    positions    = parsed.get("positions", [])
    valuation_dt = parsed.get("contract", {}).get("valuation_date")
    source_file  = parsed.get("_source_file", "")
    ok = fail = 0

    for pos in positions:
        isin       = pos.get("isin")
        value_eur  = pos.get("value_eur")
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
                row,
                on_conflict="contract_id,isin,valuation_date",
            ).execute()
            ok += 1
            if verbose:
                print(f"    + {isin} | {value_eur:>12,.2f} € | {pos.get('fund_name','')[:40]}")
        except Exception as e:
            fail += 1
            print(f"  ✗ Position {isin} : {e}")

    return ok, fail


def upsert_transactions(client: object, contract_id: str, parsed: dict,
                        verbose: bool) -> tuple[int, int]:
    """Upsert des transactions. Retourne (ok, fail)."""
    transactions = parsed.get("transactions", [])
    source_file  = parsed.get("_source_file", "")
    ok = fail = 0

    for tx in transactions:
        tx_date  = tx.get("transaction_date")
        tx_type  = tx.get("transaction_type")
        amount   = tx.get("amount_eur")
        if not tx_date or not tx_type or amount is None:
            fail += 1
            continue

        row = {
            "contract_id":       contract_id,
            "transaction_type":  tx_type,
            "transaction_date":  str(tx_date),
            "amount_eur":        amount,
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
            if verbose:
                isin_str = tx.get("isin") or "-"
                print(f"    + {tx_date} | {tx_type:15} | {amount:>10,.2f} € | {isin_str}")
        except Exception as e:
            fail += 1
            print(f"  ✗ Transaction {tx_date}/{tx_type} : {e}")

    return ok, fail


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(file_path: Path, cgp_id: str, apply: bool, verbose: bool):
    print("=" * 60)
    print("  Genepro Import — Relevé Generali Patrimoine")
    print("=" * 60)
    print(f"  Fichier : {file_path.name}")
    print(f"  CGP ID  : {cgp_id}")
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)

    # ── Parse ──────────────────────────────────────────────────────────────
    print("  Parsing du fichier...")
    file_bytes = file_path.read_bytes()
    parsed = parse(file_bytes, file_path.name)

    contract = parsed.get("contract", {})
    c_client = parsed.get("client", {})

    print(f"  Contrat   : {contract.get('number', 'N/A')} — {contract.get('name', 'N/A')}")
    print(f"  Date      : {contract.get('valuation_date', 'N/A')}")
    total = contract.get('total_value_eur')
    print(f"  Total     : {total:,.2f} €" if total else "  Total     : N/A")
    print(f"  Client    : {c_client.get('last_name', '?')} {c_client.get('first_name', '') or ''}")
    print(f"  Positions : {len(parsed.get('positions', []))}")
    print(f"  Transact. : {len(parsed.get('transactions', []))}")

    if parsed.get("_parse_warnings"):
        for w in parsed["_parse_warnings"]:
            print(f"  ⚠ {w}")

    if not parsed.get("positions"):
        print("\n  ✗ Aucune position extraite — vérifier le format du fichier")
        return

    # ── Aperçu (dry-run) ────────────────────────────────────────────────
    if not apply:
        print("\n  Aperçu des 10 premières positions :")
        for pos in parsed["positions"][:10]:
            name = (pos.get("fund_name") or "")[:40]
            val  = f"{pos['value_eur']:>12,.2f} €" if pos.get("value_eur") else " " * 14
            pct  = f"{pos['weight_pct']:5.2f}%" if pos.get("weight_pct") else "    ?"
            print(f"    {pos['isin']} | {pct} | {val} | {name}")
        if len(parsed["positions"]) > 10:
            print(f"    ... ({len(parsed['positions']) - 10} autres)")
        if parsed.get("transactions"):
            print(f"\n  Aperçu des transactions :")
            for tx in parsed["transactions"][:5]:
                print(f"    {tx['transaction_date']} | {tx['transaction_type']:15} | {tx['amount_eur']:>10,.2f} €")
        print("\n  → Dry-run terminé. Relancer avec --apply pour écrire dans Supabase.")
        return

    # ── Écriture Supabase ────────────────────────────────────────────────
    db = get_client()

    print("\n  Écriture dans Supabase...")

    client_id = upsert_client(db, cgp_id, parsed)
    if not client_id:
        print("  ✗ Impossible de créer/trouver le client — abandon")
        return
    print(f"  ✓ Client     : {client_id}")

    contract_id = upsert_contract(db, cgp_id, client_id, parsed)
    if not contract_id:
        print("  ✗ Impossible de créer/trouver le contrat — abandon")
        return
    print(f"  ✓ Contrat    : {contract_id}")

    pos_ok, pos_fail = upsert_positions(db, contract_id, parsed, verbose)
    print(f"  ✓ Positions  : {pos_ok} OK, {pos_fail} échec")

    tx_ok, tx_fail = upsert_transactions(db, contract_id, parsed, verbose)
    print(f"  ✓ Transact.  : {tx_ok} OK, {tx_fail} échec")

    total_ok   = pos_ok + tx_ok
    total_fail = pos_fail + tx_fail
    print(f"\n  Total        : {total_ok} lignes insérées, {total_fail} échecs")

    log_run(
        scraper="genepro-import",
        status="success" if total_fail == 0 else "partial",
        records_processed=total_ok,
        records_failed=total_fail,
        started_at=started,
    )
    print("  Pipeline run loggé.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import relevé Generali Genepro")
    parser.add_argument("--file",    required=True,  type=Path, help="PDF ou CSV Genepro")
    parser.add_argument("--cgp-id",  required=True,  type=str,  help="UUID du cabinet CGP")
    parser.add_argument("--apply",   action="store_true",       help="Écrire dans Supabase")
    parser.add_argument("--verbose", action="store_true",       help="Détail ligne par ligne")
    args = parser.parse_args()

    if not args.file.exists():
        print(f"Erreur : fichier non trouvé : {args.file}")
        sys.exit(1)

    # Valider UUID
    try:
        uuid.UUID(args.cgp_id)
    except ValueError:
        print(f"Erreur : --cgp-id doit être un UUID valide (ex: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)")
        sys.exit(1)

    run(
        file_path=args.file,
        cgp_id=args.cgp_id,
        apply=args.apply,
        verbose=args.verbose,
    )
