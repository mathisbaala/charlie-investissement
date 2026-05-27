#!/usr/bin/env python3
"""
genepro_parser.py — Parser PDF/CSV relevés Generali Genepro
============================================================
Extrait depuis un relevé de situation Generali Patrimoine (format PDF Genepro) :
  - En-tête contrat : numéro, nom, date, valorisation totale
  - Positions : ISIN, libellé, nb parts, VL, valeur €, %
  - Transactions : date, type, support, montant

Formats supportés :
  - PDF "Relevé de situation" Generali Patrimoine (pdfplumber)
  - CSV export Genepro (pandas-free, stdlib only)

Résultat :
    {
        "client":       {"last_name": ..., "first_name": ..., "ref": ...},
        "contract":     {"number": ..., "name": ..., "opening_date": ...,
                         "valuation_date": ..., "total_value_eur": ...},
        "positions":    [{"isin": ..., "fund_name": ..., "units": ...,
                          "unit_value": ..., "value_eur": ..., "weight_pct": ...}],
        "transactions": [{"date": ..., "type": ..., "isin": ...,
                          "fund_name": ..., "amount_eur": ..., "units": ...,
                          "unit_value": ...}],
        "_source_file": str,
        "_parse_warnings": [str],
    }

Usage autonome (test) :
    python3 scripts/parsers/genepro_parser.py chemin/vers/releve.pdf
"""

import re
import sys
import json
import csv
import io
from datetime import date, datetime
from pathlib import Path
from typing import Any

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

# ─── Constantes ───────────────────────────────────────────────────────────────

ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{10})\b")
FLAGS   = re.IGNORECASE | re.DOTALL

# Formats de date français courants dans les PDFs Generali
DATE_PATTERNS = [
    (r"(\d{1,2})[./](\d{1,2})[./](\d{4})", "%d/%m/%Y"),  # 31/12/2024
    (r"(\d{4})-(\d{2})-(\d{2})",            "%Y-%m-%d"),  # 2024-12-31
]

# Types de transaction reconnus (libellés Genepro normalisés)
TRANSACTION_TYPE_MAP = {
    "versement":            "versement",
    "prime":                "versement",
    "dépôt":                "versement",
    "rachat":               "rachat",
    "retrait":              "rachat",
    "remboursement":        "rachat",
    "arbitrage entrant":    "arbitrage_in",
    "arbitrage sortant":    "arbitrage_out",
    "arbitrage":            "arbitrage_in",   # précisé par le signe du montant
    "frais":                "frais",
    "commission":           "frais",
    "prélèvement":          "frais",
}


# ─── Utilitaires numériques ───────────────────────────────────────────────────

def parse_french_number(s: str) -> float | None:
    """'1 234,56 €' → 1234.56  |  '89,45' → 89.45  |  '1.234,56' → 1234.56"""
    if not s:
        return None
    s = s.strip().replace("\xa0", "").replace(" ", "").replace("€", "").replace("%", "")
    # Format 1.234,56 (séparateur milliers = point, décimal = virgule)
    if re.match(r"^\d{1,3}(\.\d{3})+(,\d+)?$", s):
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_date(s: str) -> date | None:
    """Parse une date en format français. Retourne un objet date ou None."""
    if not s:
        return None
    s = s.strip()
    for pattern, fmt in DATE_PATTERNS:
        m = re.fullmatch(pattern, s)
        if m:
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                pass
    # Tentative générique
    for fmt in ("%d/%m/%Y", "%d.%m.%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            pass
    return None


def normalize_transaction_type(raw: str) -> str:
    raw_lower = raw.lower().strip()
    for key, val in TRANSACTION_TYPE_MAP.items():
        if key in raw_lower:
            return val
    return "autre"


# ─── Parser PDF ───────────────────────────────────────────────────────────────

def _extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extrait tout le texte du PDF via pdfplumber, page par page."""
    if pdfplumber is None:
        raise ImportError("pdfplumber requis : pip install pdfplumber")
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages = []
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            pages.append(text)
    return "\n".join(pages)


def _extract_tables_from_pdf(pdf_bytes: bytes) -> list[list[list[str]]]:
    """Extrait les tables structurées du PDF (pdfplumber table detection)."""
    if pdfplumber is None:
        return []
    tables = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                tables.append(table)
    return tables


def parse_header(text: str) -> dict:
    """Extrait les métadonnées du contrat depuis le texte brut."""
    result = {}

    # Numéro de contrat — patterns Generali Patrimoine
    for pattern in [
        r"(?:n[°o°\.]\s*(?:de\s+)?contrat|contrat\s+n[°o°\.?])\s*:?\s*([\w\-]+)",
        r"contrat\s+([\w]{6,12})",
        r"police\s+n[°o°\.]\s*:?\s*([\w\-]+)",
    ]:
        m = re.search(pattern, text, FLAGS)
        if m:
            result["contract_number"] = m.group(1).strip()
            break

    # Date de valorisation / situation
    for pattern in [
        r"(?:au|valorisation\s+au|situation\s+au|arrêt[eé]\s+au)\s+(\d{1,2}[./]\d{1,2}[./]\d{4})",
        r"relevé\s+(?:de\s+situation\s+)?au\s+(\d{1,2}[./]\d{1,2}[./]\d{4})",
        r"au\s+(\d{1,2}\s+\w+\s+\d{4})",  # "au 31 décembre 2024"
    ]:
        m = re.search(pattern, text, FLAGS)
        if m:
            result["valuation_date"] = parse_date(m.group(1).strip())
            break

    # Valeur totale du contrat
    for pattern in [
        r"(?:valorisation|valeur\s+totale|total\s+contrat|solde)\s*:?\s*([\d\s\xa0,.]+)\s*€",
        r"valeur\s+de\s+votre\s+(?:contrat|épargne)\s*:?\s*([\d\s\xa0,.]+)\s*€",
        r"total\s+général\s*:?\s*([\d\s\xa0,.]+)\s*€",
    ]:
        m = re.search(pattern, text, FLAGS)
        if m:
            val = parse_french_number(m.group(1))
            if val and val > 0:
                result["total_value_eur"] = val
                break

    # Nom du client
    for pattern in [
        r"(?:monsieur|madame|m\.?|mme\.?)\s+([A-ZÉÀÂ][A-ZÉÀÂ\s\-]+?)\n",
        r"(?:client|assuré|souscripteur)\s*:?\s+([A-ZÉÀÂ][A-Za-zéàâùûêîôäëïöü\s\-]+?)\n",
    ]:
        m = re.search(pattern, text, re.MULTILINE)
        if m:
            full_name = m.group(1).strip()
            parts = full_name.split()
            if len(parts) >= 2:
                result["last_name"]  = parts[0]
                result["first_name"] = " ".join(parts[1:])
            else:
                result["last_name"] = full_name
            break

    # Nom du contrat (ex: "Generali Patrimoine", "Generali Épargne")
    for pattern in [
        r"(Generali\s+(?:Patrimoine|Épargne|Vie|Retraite|Millesima)[^\n]*)",
        r"(GENERALI\s+[A-Z][^\n]{3,40})",
    ]:
        m = re.search(pattern, text)
        if m:
            result["contract_name"] = m.group(1).strip()
            break
    if "contract_name" not in result:
        result["contract_name"] = "Generali Patrimoine"

    return result


def parse_positions_from_tables(tables: list[list[list[str]]]) -> list[dict]:
    """Tente d'extraire les positions depuis les tables détectées par pdfplumber."""
    positions = []
    for table in tables:
        if not table or len(table) < 2:
            continue
        headers = [str(c).lower().strip() if c else "" for c in table[0]]
        # Identifier si c'est une table de positions (contient "isin" ou "valeur")
        has_isin  = any("isin" in h for h in headers)
        has_value = any(h in ("valeur", "valorisation", "montant", "€") for h in headers)
        if not (has_isin or has_value):
            continue

        # Mapper les colonnes
        col = {
            "isin":       next((i for i, h in enumerate(headers) if "isin" in h), None),
            "name":       next((i for i, h in enumerate(headers)
                                if any(w in h for w in ["libellé", "support", "fonds", "nom"])), None),
            "units":      next((i for i, h in enumerate(headers)
                                if any(w in h for w in ["parts", "unités", "quantité", "nb"])), None),
            "unit_value": next((i for i, h in enumerate(headers)
                                if any(w in h for w in ["vl", "valeur de part", "liquidative"])), None),
            "value":      next((i for i, h in enumerate(headers)
                                if any(w in h for w in ["valorisation", "valeur totale", "montant", "€"])), None),
            "weight":     next((i for i, h in enumerate(headers)
                                if any(w in h for w in ["%", "poids", "répartition"])), None),
        }

        for row in table[1:]:
            if not row:
                continue
            cells = [str(c).strip() if c else "" for c in row]
            if len(cells) < 2:
                continue

            # Chercher ISIN dans la ligne
            isin = None
            if col["isin"] is not None and col["isin"] < len(cells):
                m = ISIN_RE.search(cells[col["isin"]])
                if m:
                    isin = m.group(1)
            if not isin:
                # Scan toutes les cellules
                for cell in cells:
                    m = ISIN_RE.search(cell)
                    if m:
                        isin = m.group(1)
                        break
            if not isin:
                continue

            pos = {"isin": isin}
            if col["name"] is not None and col["name"] < len(cells):
                pos["fund_name"] = cells[col["name"]]
            if col["units"] is not None and col["units"] < len(cells):
                pos["units"] = parse_french_number(cells[col["units"]])
            if col["unit_value"] is not None and col["unit_value"] < len(cells):
                pos["unit_value"] = parse_french_number(cells[col["unit_value"]])
            if col["value"] is not None and col["value"] < len(cells):
                pos["value_eur"] = parse_french_number(cells[col["value"]])
            if col["weight"] is not None and col["weight"] < len(cells):
                pos["weight_pct"] = parse_french_number(cells[col["weight"]])

            if pos.get("value_eur") and pos["value_eur"] > 0:
                positions.append(pos)

    return positions


def _extract_fr_numbers(text: str) -> list[float]:
    """Extrait tous les nombres en format français d'une chaîne.

    Reconnaît :  245,12  |  21 920,06  |  21\xa0920,06  |  1 234 567,89
    N'utilise pas l'espace régulier comme joker — évite de fusionner deux nombres.
    """
    # \d{1,3} + groupes milliers (espace/NBSP + 3 chiffres)* + décimale obligatoire
    NUM_RE = re.compile(r"\d{1,3}(?:[ \xa0 ]\d{3})*[,.]\d{1,6}")
    results = []
    for raw in NUM_RE.findall(text):
        n = parse_french_number(raw)
        if n is not None and n > 0:
            results.append(n)
    return results


def parse_positions_from_text(text: str) -> list[dict]:
    """
    Fallback : cherche les positions dans le texte brut quand la détection
    de tables échoue. Pour chaque ligne contenant un ISIN, extrait les nombres
    après l'ISIN et sélectionne le plus grand comme value_eur.
    """
    positions = []
    seen_isins: set[str] = set()

    pct_re = re.compile(r"([\d\xa0 ,.]+)\s*%")

    for line in text.split("\n"):
        m = ISIN_RE.search(line)
        if not m:
            continue
        isin = m.group(1)
        if isin in seen_isins:
            continue

        fund_name = line[:m.start()].strip()
        after     = line[m.end():]

        # Extraire le % (weight_pct) en priorité pour ne pas le confondre avec un montant
        pct: float | None = None
        pct_m = pct_re.search(after)
        if pct_m:
            pct   = parse_french_number(pct_m.group(1))
            after = after[:pct_m.start()] + after[pct_m.end():]

        numbers = _extract_fr_numbers(after)

        if not numbers:
            continue

        pos: dict = {"isin": isin}
        if fund_name:
            pos["fund_name"] = fund_name[:200]
        if pct is not None:
            pos["weight_pct"] = pct

        # value_eur = le plus grand (valorisation totale du support)
        pos["value_eur"] = max(numbers)
        others = sorted([n for n in numbers if n != pos["value_eur"]], reverse=True)
        if others:
            pos["units"] = others[0]
        if len(others) >= 2:
            pos["unit_value"] = others[1]

        seen_isins.add(isin)
        positions.append(pos)

    # Fallback 2 : ISIN + recherche sur la ligne courante (200 chars max)
    if not positions:
        for m in ISIN_RE.finditer(text):
            isin = m.group(1)
            if isin in seen_isins:
                continue
            after = text[m.end():m.end() + 200]
            # Limiter à la ligne courante
            nl = after.find("\n")
            line_after = after[:nl] if nl != -1 else after

            numbers = _extract_fr_numbers(line_after)
            if not numbers:
                continue

            seen_isins.add(isin)
            before = text[max(0, m.start() - 100):m.start()]
            name_m = re.search(r"([A-Za-z][^\n]{4,50})\s*$", before)
            positions.append({
                "isin":      isin,
                "fund_name": name_m.group(1).strip() if name_m else None,
                "value_eur": max(numbers),
            })

    return positions


def parse_transactions_from_text(text: str) -> list[dict]:
    """Extrait les transactions depuis le texte brut."""
    transactions = []
    seen: set = set()

    # Section transactions (Genepro titre souvent "Opérations réalisées" ou "Historique")
    section_start = -1
    for header in ["opérations réalisées", "historique des opérations",
                   "mouvements", "historique", "opérations"]:
        idx = text.lower().find(header)
        if idx != -1:
            section_start = idx
            break

    section_text = text[section_start:] if section_start != -1 else text

    # Pattern de ligne de transaction :
    # "15/01/2024  Versement  -  5 000,00 €"
    # "20/02/2024  Arbitrage  Amundi MSCI World IE00B0M62Q58  -3 000,00 €"
    tx_re = re.compile(
        r"(\d{1,2}[./]\d{1,2}[./]\d{4})\s+"       # date
        r"([A-Za-zéàâùûêîôäëïöü][^\n]{2,40}?)\s+"  # type / libellé
        r"([+-]?[\d\s\xa0]{2,}[,\.]\d{2})\s*€?",   # montant
        re.MULTILINE,
    )

    for m in tx_re.finditer(section_text):
        raw_date    = m.group(1)
        raw_type    = m.group(2).strip()
        raw_amount  = m.group(3)

        tx_date  = parse_date(raw_date)
        amount   = parse_french_number(raw_amount)
        tx_type  = normalize_transaction_type(raw_type)

        if not tx_date or amount is None:
            continue

        # Détecter un ISIN dans le libellé
        isin_m = ISIN_RE.search(raw_type)
        isin   = isin_m.group(1) if isin_m else None

        # Dédup
        key = (str(tx_date), tx_type, isin, amount)
        if key in seen:
            continue
        seen.add(key)

        transactions.append({
            "transaction_date": tx_date,
            "transaction_type": tx_type,
            "isin":             isin,
            "fund_name":        raw_type if not isin_m else None,
            "amount_eur":       abs(amount),
        })

    return transactions


def parse_pdf(pdf_bytes: bytes, source_file: str = "") -> dict:
    """Parse un PDF Genepro. Retourne le dict standardisé."""
    warnings: list[str] = []

    text = _extract_text_from_pdf(pdf_bytes)
    if len(text) < 100:
        warnings.append("Texte extrait très court — PDF peut-être scanné/image")

    tables = _extract_tables_from_pdf(pdf_bytes)

    header = parse_header(text)
    if not header.get("contract_number"):
        warnings.append("Numéro de contrat non trouvé")
    if not header.get("valuation_date"):
        warnings.append("Date de valorisation non trouvée")

    positions = parse_positions_from_tables(tables)
    if not positions:
        positions = parse_positions_from_text(text)
    if not positions:
        warnings.append("Aucune position trouvée")

    transactions = parse_transactions_from_text(text)

    # Recalculer weight_pct si total connu mais poids absent
    total = header.get("total_value_eur")
    if total and total > 0:
        for pos in positions:
            if pos.get("weight_pct") is None and pos.get("value_eur"):
                pos["weight_pct"] = round(pos["value_eur"] * 100 / total, 4)

    return {
        "client":           {
            "last_name":   header.get("last_name"),
            "first_name":  header.get("first_name"),
            "ref":         header.get("contract_number"),  # fallback ref = N° contrat
        },
        "contract":         {
            "number":          header.get("contract_number"),
            "name":            header.get("contract_name", "Generali Patrimoine"),
            "opening_date":    None,   # rarement dans les relevés
            "valuation_date":  header.get("valuation_date"),
            "total_value_eur": header.get("total_value_eur"),
        },
        "positions":        positions,
        "transactions":     transactions,
        "_source_file":     source_file,
        "_parse_warnings":  warnings,
    }


# ─── Parser CSV ───────────────────────────────────────────────────────────────

def parse_csv(csv_bytes: bytes, source_file: str = "") -> dict:
    """
    Parse un export CSV Genepro.
    Les exports varient ; on détecte le format par les headers.
    """
    warnings: list[str] = []
    text = csv_bytes.decode("utf-8-sig", errors="replace")  # BOM éventuel
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    rows = list(reader)
    if not rows:
        return _empty_result(source_file, ["CSV vide"])

    # Normaliser les headers (minuscules, sans accents approx)
    norm = {k.lower().strip(): k for k in rows[0].keys()}

    positions: list[dict] = []
    transactions: list[dict] = []
    contract_number = None
    valuation_date  = None
    total_value     = None
    client_name     = None

    for row in rows:
        # Chercher ISIN
        isin = None
        for key in ("isin", "code isin", "code_isin"):
            val = row.get(norm.get(key, ""), "").strip().upper()
            if ISIN_RE.match(val):
                isin = val
                break

        if isin:
            # Ligne de position
            pos: dict = {"isin": isin}
            for key in ("libellé", "libelle", "nom", "support", "fonds", "label"):
                val = row.get(norm.get(key, ""), "").strip()
                if val:
                    pos["fund_name"] = val
                    break
            for key in ("nombre de parts", "nb parts", "quantite", "quantité", "parts"):
                val = parse_french_number(row.get(norm.get(key, ""), ""))
                if val:
                    pos["units"] = val
                    break
            for key in ("valeur de part", "vl", "valeur liquidative", "prix"):
                val = parse_french_number(row.get(norm.get(key, ""), ""))
                if val:
                    pos["unit_value"] = val
                    break
            for key in ("valorisation", "valeur totale", "montant", "valeur"):
                val = parse_french_number(row.get(norm.get(key, ""), ""))
                if val and val > 0:
                    pos["value_eur"] = val
                    break
            for key in ("%", "poids", "répartition", "repartition", "pct"):
                val = parse_french_number(row.get(norm.get(key, ""), ""))
                if val is not None:
                    pos["weight_pct"] = val
                    break
            if pos.get("value_eur"):
                positions.append(pos)

        # Chercher métadonnées contrat
        for key in ("n° contrat", "numero contrat", "contrat"):
            val = row.get(norm.get(key, ""), "").strip()
            if val and not contract_number:
                contract_number = val
        for key in ("date", "date de valorisation", "date valorisation"):
            val = row.get(norm.get(key, ""), "").strip()
            d = parse_date(val)
            if d and not valuation_date:
                valuation_date = d
        for key in ("total", "total contrat", "valeur totale"):
            val = parse_french_number(row.get(norm.get(key, ""), ""))
            if val and not total_value:
                total_value = val

    if not positions:
        warnings.append("Aucune position trouvée dans le CSV")

    return {
        "client":    {"last_name": client_name, "first_name": None, "ref": contract_number},
        "contract":  {
            "number":          contract_number,
            "name":            "Generali Patrimoine",
            "opening_date":    None,
            "valuation_date":  valuation_date,
            "total_value_eur": total_value,
        },
        "positions":    positions,
        "transactions": transactions,
        "_source_file":    source_file,
        "_parse_warnings": warnings,
    }


def _empty_result(source_file: str, warnings: list[str]) -> dict:
    return {
        "client": {}, "contract": {}, "positions": [], "transactions": [],
        "_source_file": source_file, "_parse_warnings": warnings,
    }


# ─── Dispatcher ───────────────────────────────────────────────────────────────

def parse(file_bytes: bytes, filename: str) -> dict:
    """Point d'entrée : détecte PDF vs CSV et dispatche."""
    if file_bytes.startswith(b"%PDF"):
        return parse_pdf(file_bytes, filename)
    # Essayer CSV
    try:
        text = file_bytes.decode("utf-8-sig", errors="replace")
        if ";" in text[:500] or "," in text[:500]:
            return parse_csv(file_bytes, filename)
    except Exception:
        pass
    return _empty_result(filename, ["Format non reconnu (ni PDF ni CSV)"])


# ─── CLI test ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 genepro_parser.py <fichier.pdf|fichier.csv>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"Fichier non trouvé : {path}")
        sys.exit(1)

    result = parse(path.read_bytes(), path.name)

    print(f"\n{'='*60}")
    print(f"  Fichier   : {result['_source_file']}")
    print(f"  Contrat   : {result['contract'].get('number')} — {result['contract'].get('name')}")
    print(f"  Date      : {result['contract'].get('valuation_date')}")
    print(f"  Total     : {result['contract'].get('total_value_eur'):,.2f} €"
          if result['contract'].get('total_value_eur') else "  Total     : N/A")
    print(f"  Client    : {result['client'].get('last_name')} {result['client'].get('first_name') or ''}")
    print(f"  Positions : {len(result['positions'])}")
    print(f"  Transact. : {len(result['transactions'])}")
    if result["_parse_warnings"]:
        print(f"  ⚠ Warnings : {'; '.join(result['_parse_warnings'])}")

    print(f"\n  Positions :")
    for p in result["positions"][:15]:
        name = (p.get("fund_name") or "")[:40]
        val  = f"{p['value_eur']:>12,.2f} €" if p.get("value_eur") else " " * 14
        pct  = f"{p['weight_pct']:5.2f}%" if p.get("weight_pct") else "    ?"
        print(f"    {p['isin']} | {pct} | {val} | {name}")
    if len(result["positions"]) > 15:
        print(f"    ... ({len(result['positions']) - 15} autres)")

    if result["transactions"]:
        print(f"\n  Transactions :")
        for t in result["transactions"][:10]:
            print(f"    {t['transaction_date']} | {t['transaction_type']:15} | {t['amount_eur']:>10,.2f} € | {t.get('isin') or '-'}")
