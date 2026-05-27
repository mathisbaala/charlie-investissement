#!/usr/bin/env python3
"""
cgp_common.py — Couche commune pour tous les connecteurs extranets CGP
======================================================================
Fournit :
  - upsert_cgp_client / upsert_cgp_contract / upsert_cgp_positions / upsert_cgp_transactions
  - upsert_all(db, cgp_id, records) — point d'entrée unique pour tous les connecteurs
  - parse_html_table(html) — extraction de tableaux HTML en list[dict]
  - find_json_in_html(html) — extraction de JSON embarqué dans une page HTML
  - explore_portal(session, base_url, headers) — sonde un portail après auth et dumpe sa structure

Utilisation dans les connecteurs :
    from cgp_common import upsert_all, parse_html_table, find_json_in_html, explore_portal
"""

import re
import json
import time
from datetime import datetime, timezone
from typing import Any

try:
    from bs4 import BeautifulSoup
    _BS4 = True
except ImportError:
    _BS4 = False


# ─── Upsert client ────────────────────────────────────────────────────────────

def upsert_cgp_client(db, cgp_id: str, client_data: dict) -> str | None:
    """
    Upsert dans cgp_clients. Retourne l'UUID client_id ou None si erreur.

    client_data attendu :
      client_ref   (str, obligatoire)
      last_name    (str)
      first_name   (str, optionnel)
      email        (str, optionnel)
      birth_date   (str YYYY-MM-DD, optionnel)
    """
    client_ref = client_data.get("client_ref") or client_data.get("ref")
    if not client_ref:
        return None

    try:
        existing = (
            db.table("cgp_clients")
            .select("id")
            .eq("cgp_id", cgp_id)
            .eq("client_ref", str(client_ref))
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]["id"]

        row = {
            "cgp_id":     cgp_id,
            "client_ref": str(client_ref),
            "last_name":  client_data.get("last_name") or "INCONNU",
        }
        for field in ("first_name", "email", "birth_date"):
            if client_data.get(field):
                row[field] = client_data[field]

        res = db.table("cgp_clients").insert(row).execute()
        return res.data[0]["id"] if res.data else None

    except Exception as e:
        print(f"    ✗ cgp_clients : {e}")
        return None


# ─── Upsert contrat ───────────────────────────────────────────────────────────

def upsert_cgp_contract(
    db,
    cgp_id: str,
    client_id: str,
    contract_data: dict,
    insurer: str,
) -> str | None:
    """
    Upsert dans cgp_contracts. Retourne l'UUID contract_id ou None si erreur.

    contract_data attendu :
      contract_number   (str, obligatoire)
      contract_name     (str, optionnel)
      contract_type     (str, optionnel — 'AV', 'PER', 'PEA', etc.)
      total_value_eur   (float, optionnel)
      last_valuation_date (str YYYY-MM-DD, optionnel)
      opening_date      (str YYYY-MM-DD, optionnel)
      source_file       (str, optionnel)
    """
    number = contract_data.get("contract_number") or contract_data.get("number")
    if not number:
        return None

    try:
        existing = (
            db.table("cgp_contracts")
            .select("id")
            .eq("cgp_id", cgp_id)
            .eq("contract_number", str(number))
            .limit(1)
            .execute()
        )

        upd: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
        for field in ("contract_name", "contract_type", "total_value_eur",
                      "last_valuation_date", "source_file"):
            val = contract_data.get(field)
            if val is not None:
                upd[field] = val

        if existing.data:
            contract_id = existing.data[0]["id"]
            db.table("cgp_contracts").update(upd).eq("id", contract_id).execute()
            return contract_id

        row = {
            "client_id":       client_id,
            "cgp_id":          cgp_id,
            "insurer":         insurer,
            "contract_number": str(number),
            **upd,
        }
        if contract_data.get("opening_date"):
            row["opening_date"] = contract_data["opening_date"]

        res = db.table("cgp_contracts").insert(row).execute()
        return res.data[0]["id"] if res.data else None

    except Exception as e:
        print(f"    ✗ cgp_contracts ({number}) : {e}")
        return None


# ─── Upsert positions ─────────────────────────────────────────────────────────

def upsert_cgp_positions(
    db,
    contract_id: str,
    positions: list[dict],
    valuation_date: str | None,
) -> tuple[int, int]:
    """
    Upsert dans cgp_positions.

    Chaque position attendue :
      isin           (str, obligatoire)
      value_eur      (float, obligatoire)
      fund_name      (str, optionnel)
      units          (float, optionnel)
      unit_value     (float, optionnel)
      weight_pct     (float, optionnel)
      source_file    (str, optionnel)
    """
    ok = fail = 0
    for pos in positions:
        isin      = pos.get("isin")
        value_eur = pos.get("value_eur")
        if not isin or value_eur is None:
            fail += 1
            continue

        row: dict[str, Any] = {
            "contract_id":    contract_id,
            "isin":           isin,
            "value_eur":      float(value_eur),
            "valuation_date": valuation_date,
        }
        for field in ("fund_name", "units", "unit_value", "weight_pct", "source_file"):
            if pos.get(field) is not None:
                row[field] = pos[field]
        if pos.get("fund_name"):
            row["fund_name"] = str(pos["fund_name"])[:200]

        try:
            db.table("cgp_positions").upsert(
                row, on_conflict="contract_id,isin,valuation_date"
            ).execute()
            ok += 1
        except Exception as e:
            fail += 1
            print(f"    ✗ position {isin} : {e}")

    return ok, fail


# ─── Upsert transactions ──────────────────────────────────────────────────────

def upsert_cgp_transactions(
    db,
    contract_id: str,
    transactions: list[dict],
) -> tuple[int, int]:
    """
    Upsert dans cgp_transactions.

    Chaque transaction attendue :
      transaction_type  (str, obligatoire — 'versement', 'rachat', 'arbitrage', etc.)
      transaction_date  (str YYYY-MM-DD, obligatoire)
      amount_eur        (float, obligatoire)
      isin              (str, optionnel)
      fund_name         (str, optionnel)
      units             (float, optionnel)
      unit_value        (float, optionnel)
    """
    ok = fail = 0
    for tx in transactions:
        tx_type = tx.get("transaction_type")
        tx_date = tx.get("transaction_date")
        amount  = tx.get("amount_eur")
        if not tx_type or not tx_date or amount is None:
            fail += 1
            continue

        row: dict[str, Any] = {
            "contract_id":      contract_id,
            "transaction_type": tx_type,
            "transaction_date": str(tx_date),
            "amount_eur":       float(amount),
        }
        for field in ("isin", "units", "unit_value"):
            if tx.get(field) is not None:
                row[field] = tx[field]
        if tx.get("fund_name"):
            row["fund_name"] = str(tx["fund_name"])[:200]

        try:
            db.table("cgp_transactions").upsert(
                row,
                on_conflict="contract_id,transaction_type,transaction_date,isin,amount_eur",
            ).execute()
            ok += 1
        except Exception as e:
            fail += 1
            print(f"    ✗ transaction {tx_date} : {e}")

    return ok, fail


# ─── upsert_all ───────────────────────────────────────────────────────────────

def upsert_all(
    db,
    cgp_id: str,
    records: list[dict],
    insurer: str,
    verbose: bool = False,
) -> tuple[int, int]:
    """
    Point d'entrée unique. records est une liste de dicts :
    {
      "client":   {client_ref, last_name, first_name, ...},
      "contract": {contract_number, contract_name, total_value_eur, last_valuation_date, ...},
      "positions": [...],
      "transactions": [...],
    }
    Retourne (total_ok, total_fail).
    """
    total_ok = total_fail = 0

    for rec in records:
        client_data   = rec.get("client", {})
        contract_data = rec.get("contract", {})
        positions     = rec.get("positions", [])
        transactions  = rec.get("transactions", [])

        # Utiliser contract_number comme client_ref si pas de client_ref
        if not client_data.get("client_ref") and not client_data.get("ref"):
            client_data = dict(client_data)
            client_data["client_ref"] = (
                contract_data.get("contract_number")
                or contract_data.get("number")
            )

        client_id = upsert_cgp_client(db, cgp_id, client_data)
        if not client_id:
            total_fail += 1
            continue

        valuation_date = (
            contract_data.get("last_valuation_date")
            or contract_data.get("valuation_date")
        )

        contract_id = upsert_cgp_contract(db, cgp_id, client_id, contract_data, insurer)
        if not contract_id:
            total_fail += 1
            continue

        p_ok, p_fail = upsert_cgp_positions(db, contract_id, positions, valuation_date)
        t_ok, t_fail = upsert_cgp_transactions(db, contract_id, transactions)

        total_ok   += p_ok + t_ok
        total_fail += p_fail + t_fail

        if verbose:
            num = contract_data.get("contract_number") or contract_data.get("number", "?")
            val = contract_data.get("total_value_eur")
            val_str = f" — {val:,.0f} €" if val else ""
            print(f"    ✓ {num}{val_str}  |  {p_ok} positions  {t_ok} tx")

    return total_ok, total_fail


# ─── HTML parsing utilities ───────────────────────────────────────────────────

def parse_html_table(html: str, col_map: dict | None = None) -> list[dict]:
    """
    Extrait le premier tableau HTML trouvé et retourne une liste de dicts.
    col_map : {header_text → field_name} pour renommer les colonnes.
    Requiert beautifulsoup4 (pip install beautifulsoup4).
    """
    if not _BS4:
        print("  ⚠  beautifulsoup4 non installé — pip install beautifulsoup4")
        return []

    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return []

    headers = []
    thead = table.find("thead")
    if thead:
        headers = [th.get_text(strip=True) for th in thead.find_all(["th", "td"])]
    else:
        first_row = table.find("tr")
        if first_row:
            headers = [td.get_text(strip=True) for td in first_row.find_all(["th", "td"])]

    if col_map:
        headers = [col_map.get(h, h) for h in headers]

    rows = []
    tbody = table.find("tbody") or table
    for tr in tbody.find_all("tr"):
        cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
        if len(cells) == len(headers) and any(cells):
            rows.append(dict(zip(headers, cells)))

    return rows


def parse_html_tables_all(html: str) -> list[list[dict]]:
    """Retourne tous les tableaux d'une page HTML."""
    if not _BS4:
        return []
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for table in soup.find_all("table"):
        headers: list[str] = []
        thead = table.find("thead")
        if thead:
            headers = [th.get_text(strip=True) for th in thead.find_all(["th", "td"])]
        else:
            first_row = table.find("tr")
            if first_row:
                headers = [td.get_text(strip=True) for td in first_row.find_all(["th", "td"])]
        if not headers:
            continue
        rows = []
        tbody = table.find("tbody") or table
        for tr in tbody.find_all("tr"):
            cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if len(cells) == len(headers) and any(cells):
                rows.append(dict(zip(headers, cells)))
        if rows:
            results.append(rows)
    return results


def find_json_in_html(html: str) -> list[Any]:
    """
    Tente d'extraire des blobs JSON embarqués dans une page HTML.
    Cherche les patterns : var X = {...}, window.X = {...}, <script>...</script>.
    Retourne une liste des objets JSON trouvés.
    """
    found = []

    # Blobs JSON dans les balises <script type="application/json"> ou __INITIAL_DATA__
    patterns = [
        r'<script[^>]+type=["\']application/json["\'][^>]*>(.*?)</script>',
        r'window\.__(?:INITIAL_?(?:STATE|DATA)|APP_?(?:STATE|DATA)|DATA)\s*=\s*(\{.*?\});',
        r'var\s+(?:initialData|appData|pageData|contractsData)\s*=\s*(\{.*?\});',
        r'JSON\.parse\(["\'](.+?)["\']\)',
    ]

    for pat in patterns:
        for m in re.finditer(pat, html, re.DOTALL):
            raw = m.group(1).strip()
            try:
                obj = json.loads(raw)
                found.append(obj)
            except json.JSONDecodeError:
                pass

    return found


def scan_js_for_api_base(js_content: str) -> list[str]:
    """
    Cherche des URL de base API dans un bundle JavaScript.
    Retourne une liste de candidats uniques.
    """
    patterns = [
        r'["\'](/api/v\d+)["\']',
        r'["\'](/rest/v\d+)["\']',
        r'baseURL?\s*[=:]\s*["\']([^"\']{4,80})["\']',
        r'apiUrl\s*[=:]\s*["\']([^"\']{4,80})["\']',
        r'API_BASE\s*[=:]\s*["\']([^"\']{4,80})["\']',
        r'["\'](https?://[^"\']{10,80}/api/[^"\']+)["\']',
    ]
    candidates = set()
    for pat in patterns:
        for m in re.finditer(pat, js_content):
            url = m.group(1)
            if "/api/" in url or url.startswith("/api") or url.startswith("/rest"):
                candidates.add(url)
    return sorted(candidates)


# ─── Portal explorer ──────────────────────────────────────────────────────────

def explore_portal(
    session,
    base_url: str,
    headers: dict,
    extra_paths: list[str] | None = None,
    verbose: bool = True,
) -> dict:
    """
    Sonde un portail extranet après authentification.
    Essaie une liste exhaustive de chemins et enregistre les réponses.

    Retourne un dict {path: {status, content_type, size, json_keys, tables}}.
    À utiliser avec le flag --explore pour cartographier manuellement le portail.
    """
    import requests
    from urllib.parse import urljoin

    standard_paths = [
        # Listes de contrats
        "/api/v1/contracts", "/api/v1/contrats", "/api/v1/portefeuille",
        "/api/v2/contracts", "/api/contracts", "/api/portfolios",
        "/api/v1/clients", "/api/v1/customers",
        "/rest/v1/contrats", "/rest/contrats",
        # Pages HTML probables
        "/mes-contrats/", "/portefeuille/", "/espace-partenaire/",
        "/dashboard/", "/tableau-de-bord/",
        "/contrats/", "/clients/", "/portefeuilles/",
        # WordPress REST
        "/wp-json/", "/wp-json/wp/v2/",
        # Liferay
        "/api/jsonws", "/o/headless-delivery/v1.0/sites",
        "/web/partenaire/", "/web/partenaire/mes-contrats",
        "/web/partenaire/portefeuille", "/web/partenaire/dashboard",
        # Finagora candidats
        "/finagora/api/v1/contracts",
        "/bnppcardif-api/v1/contracts",
    ]

    paths = standard_paths + (extra_paths or [])

    results = {}
    if verbose:
        print(f"\n  ── Exploration portail : {base_url} ──")

    for path in paths:
        url = urljoin(base_url, path)
        try:
            r = session.get(
                url,
                headers={**headers, "Accept": "application/json, text/html, */*"},
                timeout=15,
                allow_redirects=True,
            )
            content_type = r.headers.get("Content-Type", "")
            size = len(r.content)

            if r.status_code in (404, 403, 401):
                continue

            info: dict[str, Any] = {
                "status":       r.status_code,
                "content_type": content_type,
                "size":         size,
            }

            if "json" in content_type:
                try:
                    data = r.json()
                    if isinstance(data, dict):
                        info["json_keys"] = list(data.keys())[:20]
                    elif isinstance(data, list) and data:
                        info["json_count"] = len(data)
                        if isinstance(data[0], dict):
                            info["json_keys"] = list(data[0].keys())[:20]
                except Exception:
                    pass
            elif "html" in content_type and _BS4:
                tables = parse_html_tables_all(r.text)
                if tables:
                    info["tables"] = len(tables)
                    info["table_headers"] = [list(t[0].keys()) for t in tables[:3] if t]
                json_blobs = find_json_in_html(r.text)
                if json_blobs:
                    info["embedded_json"] = len(json_blobs)

            results[path] = info

            if verbose and r.status_code == 200 and size > 200:
                extra = ""
                if "json_keys" in info:
                    extra = f"  json_keys={info['json_keys'][:5]}"
                elif "tables" in info:
                    extra = f"  tables={info['tables']} headers={info.get('table_headers', [])}"
                print(f"    ✓ {r.status_code} {path:50s}  {size:7d}b  {content_type.split(';')[0]}{extra}")

        except Exception as e:
            if verbose:
                print(f"    ✗ {path} : {e}")

        time.sleep(0.3)

    if not results:
        print("  ⚠  Aucun endpoint accessible — vérifier l'authentification")
    else:
        print(f"\n  → {len(results)} endpoint(s) accessibles")

    return results
