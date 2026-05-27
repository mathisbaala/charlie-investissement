#!/usr/bin/env python3
"""
extranet-oriadys-connector.py — Connecteur extranet Suravenir CGP (Oriadys)
============================================================================
Extrait les données de portefeuilles clients depuis le portail Oriadys.

Portail : https://oriadys.suravenir.fr
Stack   : Liferay DXP (hébergé Arkea)

Architecture d'authentification :
  1. GET /c/portal/login → JSESSIONID + p_auth token dynamique
  2. POST /web/partenaire/login?p_p_id=...&p_auth={p_auth} → session Liferay
  3. GET /api/jsonws → liste des services Liferay disponibles
  4. Appeler les services JSONWS ou pages portlet pour extraire les contrats

Variables d'environnement (ou .env) :
  ORIADYS_LOGIN    — identifiant CGP Oriadys (Suravenir)
  ORIADYS_PASSWORD — mot de passe CGP Oriadys
  CGP_ID           — UUID du cabinet CGP dans Supabase

Usage :
    python3 scripts/importers/extranet-oriadys-connector.py --dry-run
    python3 scripts/importers/extranet-oriadys-connector.py --explore
    python3 scripts/importers/extranet-oriadys-connector.py --apply --cgp-id <UUID>
"""

import os
import re
import sys
import time
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlencode

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

sys.path.insert(0, str(Path(__file__).parent))
from cgp_common import (
    upsert_all, explore_portal,
    parse_html_tables_all, find_json_in_html,
)

# ─── Config ───────────────────────────────────────────────────────────────────

BASE_URL    = "https://oriadys.suravenir.fr"
LOGIN_PAGE  = "/c/portal/login"
INSURER     = "suravenir"

SCOPE_GROUP = "64198"
PORTLET_ID  = "com_liferay_login_web_portlet_LoginPortlet"

LOGIN_PARAMS = {"redirect": "/", "refererPlid": "196", "p_l_id": "293"}

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Origin":          BASE_URL,
    "Referer":         BASE_URL + LOGIN_PAGE,
}

TIMEOUT = 30


# ─── Auth ─────────────────────────────────────────────────────────────────────

class OriadysSession:
    def __init__(self, login: str, password: str):
        self.login    = login
        self.password = password
        self.session  = requests.Session()
        self._logged  = False
        self._jsonws_services: list[str] = []

    def _get_login_page(self) -> tuple[str, str, str]:
        url = f"{BASE_URL}{LOGIN_PAGE}?" + urlencode(LOGIN_PARAMS)
        r   = self.session.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()

        p_auth_m = re.search(r'p_auth=([A-Za-z0-9_-]+)', r.text)
        p_auth   = p_auth_m.group(1) if p_auth_m else ""

        form_date_m = re.search(
            rf'name="_{PORTLET_ID}_formDate"\s+value="(\d+)"', r.text
        )
        form_date = form_date_m.group(1) if form_date_m else str(int(time.time() * 1000))

        form_action = (
            f"{BASE_URL}/web/partenaire/login"
            f"?p_p_id={PORTLET_ID}"
            f"&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view"
            f"&_{PORTLET_ID}_javax.portlet.action=%2Flogin%2Flogin"
            f"&_{PORTLET_ID}_mvcRenderCommandName=%2Flogin%2Flogin"
            f"&p_auth={p_auth}"
        )
        return form_action, form_date, p_auth

    def authenticate(self) -> bool:
        try:
            form_action, form_date, p_auth = self._get_login_page()
        except Exception as e:
            print(f"  ✗ GET page de login : {e}")
            return False

        print(f"  p_auth   : {p_auth}")
        print(f"  formDate : {form_date}")

        post_data = {
            f"_{PORTLET_ID}_formDate":         form_date,
            f"_{PORTLET_ID}_saveLastPath":      "false",
            f"_{PORTLET_ID}_redirect":          "/",
            f"_{PORTLET_ID}_doActionAfterLogin": "false",
            f"_{PORTLET_ID}_scopeGroupId":      SCOPE_GROUP,
            f"_{PORTLET_ID}_login":             self.login,
            f"_{PORTLET_ID}_password":          self.password,
        }

        try:
            r2 = self.session.post(
                form_action,
                data=post_data,
                headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
                timeout=TIMEOUT,
                allow_redirects=True,
            )
        except Exception as e:
            print(f"  ✗ POST login : {e}")
            return False

        logged_in = (
            r2.status_code == 200
            and ("signOut" in r2.text or "déconnexion" in r2.text.lower()
                 or "tableau-de-bord" in r2.url or "portail" in r2.text.lower())
        )

        if not logged_in and r2.status_code in (200, 302):
            still_login = "Authentication" in r2.text or "_password" in r2.text
            if still_login:
                print("  ✗ Identifiants incorrects")
                return False
            logged_in = "/web/partenaire" in r2.url and "login" not in r2.url

        if not logged_in:
            print(f"  ✗ Authentification échouée (HTTP {r2.status_code}, URL: {r2.url[:80]})")
            return False

        self._logged = True
        print("  ✓ Authentification Oriadys réussie")

        # Découvrir les services JSONWS Liferay disponibles
        self._enumerate_jsonws()
        return True

    def _enumerate_jsonws(self):
        """GET /api/jsonws pour lister les services Liferay disponibles."""
        try:
            r = self.session.get(
                f"{BASE_URL}/api/jsonws",
                headers={**HEADERS, "Accept": "application/json"},
                timeout=TIMEOUT,
            )
            if r.status_code == 200:
                ct = r.headers.get("Content-Type", "")
                if "json" in ct:
                    data = r.json()
                    if isinstance(data, dict):
                        self._jsonws_services = list(data.keys())[:30]
                        if self._jsonws_services:
                            print(f"  → JSONWS services : {self._jsonws_services[:5]} …")
                elif "html" in ct:
                    # La page JSONWS HTML liste les services dans une table
                    tables = parse_html_tables_all(r.text)
                    if tables:
                        print(f"  → JSONWS HTML ({len(tables)} tables) — services listés dans le portail")
        except Exception:
            pass

    def get(self, path: str, **kwargs) -> requests.Response:
        url = urljoin(BASE_URL, path)
        return self.session.get(url, headers=HEADERS, timeout=TIMEOUT, **kwargs)

    def get_json(self, path: str, **kwargs) -> requests.Response:
        url = urljoin(BASE_URL, path)
        return self.session.get(
            url, headers={**HEADERS, "Accept": "application/json"},
            timeout=TIMEOUT, **kwargs,
        )

    def jsonws_invoke(self, service: str, method: str, params: dict | None = None) -> requests.Response:
        """Appelle un service Liferay JSONWS."""
        url = f"{BASE_URL}/api/jsonws/{service}/{method}"
        return self.session.get(
            url, params=params or {},
            headers={**HEADERS, "Accept": "application/json"},
            timeout=TIMEOUT,
        )


# ─── Découverte + extraction ──────────────────────────────────────────────────

# Services JSONWS Liferay courants pour gestion de contrats assurance
_JSONWS_SERVICES_CANDIDATES = [
    ("contract", "get-contracts"),
    ("contract", "list"),
    ("contrat", "get-contrats"),
    ("contrat", "list"),
    ("portefeuille", "get"),
    ("portfolio", "get"),
    ("client-contract", "list"),
]

# Pages portlet Liferay à explorer
_ORIADYS_PORTLET_PAGES = [
    "/web/partenaire/",
    "/web/partenaire/mes-contrats",
    "/web/partenaire/portefeuille",
    "/web/partenaire/dashboard",
    "/web/partenaire/contrats",
    "/web/partenaire/clients",
    "/web/partenaire/tableau-de-bord",
]

# APIs REST Liferay headless (v7.x+)
_ORIADYS_REST_PATHS = [
    "/o/headless-delivery/v1.0/sites",
    "/o/suravenir-api/v1/contracts",
    "/o/suravenir-api/v1/contrats",
    "/o/extranet-api/v1/contracts",
    "/o/cgp-api/v1/contracts",
    "/o/partenaire-api/v1/contrats",
]


def discover_contracts(oriadys: OriadysSession) -> list[dict]:
    """
    Récupère les contrats depuis Oriadys.
    Ordre de tentative :
      1. Services JSONWS Liferay
      2. APIs REST headless Liferay
      3. Pages portlet HTML avec parsing
    """

    # 1. JSONWS — essayer les combinaisons service/méthode candidates
    for service, method in _JSONWS_SERVICES_CANDIDATES:
        # Aussi essayer si le service est dans la liste découverte
        if oriadys._jsonws_services:
            if not any(service in s.lower() for s in oriadys._jsonws_services):
                continue
        try:
            r = oriadys.jsonws_invoke(service, method)
            if r.status_code == 200 and "json" in r.headers.get("Content-Type", ""):
                data = r.json()
                if data and not isinstance(data, dict) or (
                    isinstance(data, dict) and "exception" not in data
                ):
                    print(f"  → JSONWS trouvé : {service}/{method}")
                    raw = data if isinstance(data, list) else data.get("data", [data])
                    return _normalize_oriadys_contracts(raw)
        except Exception:
            pass

    # 2. REST headless Liferay
    for path in _ORIADYS_REST_PATHS:
        try:
            r = oriadys.get_json(path)
            if r.status_code == 200 and "json" in r.headers.get("Content-Type", ""):
                data = r.json()
                if data:
                    print(f"  → REST headless trouvé : {path}")
                    raw = data if isinstance(data, list) else (
                        data.get("items") or data.get("contracts") or [data]
                    )
                    return _normalize_oriadys_contracts(raw)
        except Exception:
            pass

    # 3. Pages portlet HTML
    for path in _ORIADYS_PORTLET_PAGES:
        try:
            r = oriadys.get(path)
            if r.status_code != 200 or len(r.content) < 500:
                continue

            # JSON embarqué dans la page Liferay (portlet data)
            blobs = find_json_in_html(r.text)
            for blob in blobs:
                if isinstance(blob, list) and blob and isinstance(blob[0], dict):
                    if any(k in blob[0] for k in
                           ("numeroContrat", "contractNumber", "numContrat", "id", "reference")):
                        print(f"  → JSON embarqué Liferay trouvé : {path}")
                        return _normalize_oriadys_contracts(blob)

            # Tableaux HTML Liferay
            tables = parse_html_tables_all(r.text)
            for table in tables:
                if not table:
                    continue
                keys = list(table[0].keys())
                if any(k.lower() in ("n° contrat", "numéro", "contrat", "référence", "encours")
                       for k in keys):
                    print(f"  → Table HTML contrats trouvée : {path}")
                    return _normalize_oriadys_from_html(table)

        except Exception:
            pass

    print("  ⚠  Portail Oriadys non cartographié — relancer avec --explore")
    return []


def _normalize_oriadys_contracts(raw: list) -> list[dict]:
    """Normalise les données contrats Oriadys vers le format cgp_common."""
    result = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        result.append({
            "client": {
                "client_ref":  (item.get("clientId") or item.get("souscripteurId")
                                or item.get("numeroContrat") or item.get("contractNumber") or ""),
                "last_name":   item.get("nomSouscripteur") or item.get("souscripteurNom")
                               or item.get("lastName") or "INCONNU",
                "first_name":  item.get("prenomSouscripteur") or item.get("souscripteurPrenom")
                               or item.get("firstName"),
            },
            "contract": {
                "contract_number":     (item.get("numeroContrat") or item.get("contractNumber")
                                        or item.get("numContrat") or item.get("id")),
                "contract_name":       item.get("libelleContrat") or item.get("contractName") or item.get("nom"),
                "contract_type":       item.get("typeContrat") or item.get("contractType"),
                "total_value_eur":     _to_float(item.get("encours") or item.get("montantTotal")
                                                  or item.get("totalAmount") or item.get("valeur")),
                "last_valuation_date": item.get("dateValorisation") or item.get("valuationDate"),
                "opening_date":        item.get("dateEffet") or item.get("dateSouscription")
                                       or item.get("openingDate"),
            },
            "positions":    _normalize_oriadys_positions(
                item.get("positions") or item.get("supports") or item.get("uniteCompte") or []
            ),
            "transactions": [],
        })
    return result


def _normalize_oriadys_from_html(rows: list[dict]) -> list[dict]:
    col_map = {
        "N° contrat": "contract_number", "Numéro contrat": "contract_number",
        "Référence": "contract_number", "Numéro": "contract_number",
        "Souscripteur": "last_name", "Nom": "last_name", "Client": "last_name",
        "Encours": "total_value_eur", "Valeur": "total_value_eur", "Montant": "total_value_eur",
        "Date valorisation": "last_valuation_date", "Date": "last_valuation_date",
        "Type contrat": "contract_type", "Type": "contract_type",
        "Produit": "contract_name", "Libellé": "contract_name",
    }
    result = []
    for row in rows:
        mapped = {col_map.get(k, k): v for k, v in row.items()}
        number = mapped.get("contract_number")
        if not number:
            continue
        result.append({
            "client": {"client_ref": number, "last_name": mapped.get("last_name") or "INCONNU"},
            "contract": {
                "contract_number":     number,
                "contract_name":       mapped.get("contract_name"),
                "contract_type":       mapped.get("contract_type"),
                "total_value_eur":     _to_float(mapped.get("total_value_eur")),
                "last_valuation_date": mapped.get("last_valuation_date"),
            },
            "positions": [], "transactions": [],
        })
    return result


def _normalize_oriadys_positions(raw: list) -> list[dict]:
    result = []
    for pos in raw:
        if not isinstance(pos, dict):
            continue
        isin = pos.get("isin") or pos.get("codeISIN") or pos.get("code") or pos.get("codeValeur")
        if not isin:
            continue
        result.append({
            "isin":       isin,
            "fund_name":  pos.get("libelle") or pos.get("nomFonds") or pos.get("fundName"),
            "value_eur":  _to_float(pos.get("valeur") or pos.get("montant") or pos.get("encours")),
            "units":      _to_float(pos.get("nbParts") or pos.get("nombreParts") or pos.get("units")),
            "unit_value": _to_float(pos.get("valeurLiquidative") or pos.get("vl") or pos.get("unitValue")),
            "weight_pct": _to_float(pos.get("poids") or pos.get("repartition") or pos.get("weight")),
        })
    return result


def extract_positions(oriadys: OriadysSession, record: dict) -> list[dict]:
    """Récupère les positions d'un contrat si non embarquées."""
    number = (record.get("contract") or {}).get("contract_number")
    if not number:
        return []

    for path in [
        f"/o/suravenir-api/v1/contracts/{number}/positions",
        f"/api/jsonws/contract/get-positions?contractNumber={number}",
        f"/web/partenaire/contrats/{number}",
    ]:
        try:
            r = oriadys.get_json(path)
            if r.status_code == 200:
                ct = r.headers.get("Content-Type", "")
                if "json" in ct:
                    data = r.json()
                    if data and isinstance(data, list):
                        positions = _normalize_oriadys_positions(data)
                        if positions:
                            return positions
                elif "html" in ct:
                    tables = parse_html_tables_all(r.text)
                    if tables:
                        return _normalize_oriadys_positions(tables[0])
        except Exception:
            pass

    return []


def _to_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(str(val).replace(" ", "").replace(",", ".").replace("\xa0", ""))
    except (ValueError, TypeError):
        return None


# ─── Runner ───────────────────────────────────────────────────────────────────

def run(login: str, password: str, cgp_id: str, apply: bool, explore: bool, verbose: bool):
    print("=" * 60)
    print("  Suravenir Oriadys Extranet Connector")
    print("=" * 60)
    print(f"  Portail : {BASE_URL}")
    print(f"  Login   : {login}")
    print(f"  Mode    : {'EXPLORE' if explore else ('APPLY' if apply else 'DRY-RUN')}")
    print()

    started = datetime.now(timezone.utc)

    oriadys = OriadysSession(login, password)
    print("  Authentification Liferay (Oriadys)...")
    if not oriadys.authenticate():
        if apply:
            log_run("extranet-oriadys", "failed", 0, 0, started_at=started)
        return

    if explore:
        explore_portal(
            oriadys.session, BASE_URL, HEADERS,
            extra_paths=_ORIADYS_PORTLET_PAGES + _ORIADYS_REST_PATHS,
            verbose=True,
        )
        return

    print("  Récupération des contrats...")
    records = discover_contracts(oriadys)
    print(f"  → {len(records)} contrat(s)")

    if not records:
        print("\n  ℹ  Portail non encore cartographié — relancer avec --explore")
        return

    for rec in records:
        if not rec.get("positions"):
            rec["positions"] = extract_positions(oriadys, rec)

    if apply:
        db = get_client()
        ok, fail = upsert_all(db, cgp_id, records, insurer=INSURER, verbose=verbose)
        print(f"  → {ok} OK, {fail} échec")
        status = "success" if fail == 0 else "partial"
        log_run("extranet-oriadys", status, ok, fail, started_at=started)
    else:
        total_pos = sum(len(r.get("positions", [])) for r in records)
        print(f"  Dry-run : {len(records)} contrats, {total_pos} positions")
        if verbose:
            for rec in records:
                c = rec["contract"]
                print(f"    {c.get('contract_number')}  {len(rec.get('positions',[]))} pos")
        print("  Relancer avec --apply pour écrire dans Supabase")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Suravenir Oriadys CGP Extranet Connector")
    parser.add_argument("--login",    default=os.environ.get("ORIADYS_LOGIN", ""))
    parser.add_argument("--password", default=os.environ.get("ORIADYS_PASSWORD", ""))
    parser.add_argument("--cgp-id",   default=os.environ.get("CGP_ID", ""))
    parser.add_argument("--apply",    action="store_true")
    parser.add_argument("--explore",  action="store_true",
                        help="Cartographie les endpoints accessibles après auth")
    parser.add_argument("--dry-run",  action="store_true")
    parser.add_argument("--verbose",  action="store_true")
    args = parser.parse_args()

    apply = args.apply and not args.dry_run

    if not args.login or not args.password:
        print("Erreur : --login et --password requis (ou ORIADYS_LOGIN / ORIADYS_PASSWORD)")
        sys.exit(1)

    run(
        login=args.login,
        password=args.password,
        cgp_id=args.cgp_id,
        apply=apply,
        explore=args.explore,
        verbose=args.verbose,
    )
