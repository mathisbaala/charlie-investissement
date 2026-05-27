#!/usr/bin/env python3
"""
extranet-spirica-connector.py — Connecteur extranet Spirica CGP
===============================================================
Extrait les données de portefeuilles clients depuis l'extranet Spirica.

Portail : https://extranet.spirica.fr/login/
Stack   : WordPress + Theme My Login (form POST simple, cookie SESSIONID)

Architecture :
  1. GET /login/                 → SESSIONID cookie + wp_test_cookie
  2. POST /login/                → authentification (log, pwd, testcookie=1)
  3. GET /wp-json/               → découverte des endpoints REST WordPress
  4. Naviguer le portail pour récupérer la liste des contrats

Variables d'environnement (ou .env) :
  SPIRICA_LOGIN    — identifiant CGP Spirica
  SPIRICA_PASSWORD — mot de passe CGP Spirica
  CGP_ID           — UUID du cabinet CGP dans Supabase

Usage :
    python3 scripts/importers/extranet-spirica-connector.py --dry-run
    python3 scripts/importers/extranet-spirica-connector.py --explore
    python3 scripts/importers/extranet-spirica-connector.py --apply --cgp-id <UUID>
"""

import os
import sys
import re
import json
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

sys.path.insert(0, str(Path(__file__).parent))
from cgp_common import (
    upsert_all, explore_portal,
    parse_html_tables_all, find_json_in_html,
)

# ─── Config ───────────────────────────────────────────────────────────────────

BASE_URL  = "https://extranet.spirica.fr"
LOGIN_URL = f"{BASE_URL}/login/"
INSURER   = "spirica"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer":         LOGIN_URL,
}

TIMEOUT = 30

# En-têtes JSON pour les appels REST WordPress
HEADERS_JSON = {**HEADERS, "Accept": "application/json", "Content-Type": "application/json"}


# ─── Auth ─────────────────────────────────────────────────────────────────────

class SpirikaSession:
    def __init__(self, login: str, password: str):
        self.login       = login
        self.password    = password
        self.session     = requests.Session()
        self._logged_in  = False
        self._wp_nonce: str | None = None
        self._api_routes: list[str] = []

    def authenticate(self) -> bool:
        r1 = self.session.get(LOGIN_URL, headers=HEADERS, timeout=TIMEOUT)
        if r1.status_code != 200:
            print(f"  ✗ GET /login/ : HTTP {r1.status_code}")
            return False

        post_data = {
            "log":         self.login,
            "pwd":         self.password,
            "rememberme":  "forever",
            "redirect_to": f"{BASE_URL}/",
            "testcookie":  "1",
        }
        r2 = self.session.post(
            LOGIN_URL,
            data=post_data,
            headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
            timeout=TIMEOUT,
            allow_redirects=True,
        )

        logged_in = any("wordpress_logged_in" in k for k in self.session.cookies.keys())
        if not logged_in:
            logged_in = "/wp-admin/" in r2.url or "dashboard" in r2.url or "logout" in r2.text.lower()

        if not logged_in and r2.status_code == 200:
            if "incorrect" in r2.text.lower() or "invalide" in r2.text.lower():
                print("  ✗ Identifiants incorrects")
            else:
                print(f"  ✗ Authentification échouée (URL finale : {r2.url})")
            return False

        self._logged_in = True
        print("  ✓ Authentification Spirica réussie")

        # Récupérer le nonce WordPress pour les appels AJAX/REST
        self._fetch_wp_nonce()
        # Découvrir les routes REST disponibles
        self._discover_wp_api()
        return True

    def _fetch_wp_nonce(self):
        """Extrait le nonce WordPress depuis la page d'administration."""
        for page in [f"{BASE_URL}/", f"{BASE_URL}/wp-admin/"]:
            try:
                r = self.session.get(page, headers=HEADERS, timeout=TIMEOUT)
                m = re.search(r'"nonce"\s*:\s*"([a-f0-9]+)"', r.text)
                if not m:
                    m = re.search(r'nonce["\s:=]+"([a-f0-9]{10})"', r.text)
                if m:
                    self._wp_nonce = m.group(1)
                    print(f"  → WP nonce : {self._wp_nonce}")
                    return
            except Exception:
                pass

    def _discover_wp_api(self):
        """GET /wp-json/ pour lister les namespaces REST disponibles."""
        try:
            r = self.session.get(
                f"{BASE_URL}/wp-json/",
                headers={**HEADERS, "Accept": "application/json"},
                timeout=TIMEOUT,
            )
            if r.status_code == 200 and "json" in r.headers.get("Content-Type", ""):
                data = r.json()
                namespaces = data.get("namespaces", [])
                routes     = list(data.get("routes", {}).keys())
                if namespaces:
                    print(f"  → WP REST namespaces : {namespaces}")
                self._api_routes = routes
        except Exception:
            pass

    def get(self, path: str, **kwargs) -> requests.Response:
        url = urljoin(BASE_URL, path)
        return self.session.get(url, headers=HEADERS, timeout=TIMEOUT, **kwargs)

    def get_json(self, path: str, **kwargs) -> requests.Response:
        url = urljoin(BASE_URL, path)
        h = {**HEADERS, "Accept": "application/json"}
        if self._wp_nonce:
            h["X-WP-Nonce"] = self._wp_nonce
        return self.session.get(url, headers=h, timeout=TIMEOUT, **kwargs)

    def ajax(self, action: str, data: dict | None = None) -> requests.Response:
        """WordPress admin-ajax.php call."""
        payload = {"action": action, **(data or {})}
        if self._wp_nonce:
            payload["nonce"] = self._wp_nonce
        url = f"{BASE_URL}/wp-admin/admin-ajax.php"
        return self.session.post(
            url,
            data=payload,
            headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
            timeout=TIMEOUT,
        )


# ─── Découverte + extraction ──────────────────────────────────────────────────

# Chemins à explorer après auth sur l'extranet Spirica
_SPIRICA_HTML_PATHS = [
    "/mes-contrats/",
    "/portefeuille/",
    "/espace-partenaire/",
    "/espace-cgp/",
    "/contrats/",
    "/dashboard/",
    "/tableau-de-bord/",
    "/clients/",
]

# Namespaces REST WordPress connus pour des extranets assurance
_WP_REST_CONTRACT_PATHS = [
    "/wp-json/spirica/v1/contracts",
    "/wp-json/spirica/v1/contrats",
    "/wp-json/spirica/v1/portefeuille",
    "/wp-json/sp/v1/contracts",
    "/wp-json/extranet/v1/contracts",
    "/wp-json/cgp/v1/contracts",
    "/wp-json/assurance/v1/contrats",
]

# Actions AJAX WordPress à tester
_WP_AJAX_ACTIONS = [
    "get_contracts", "get_contrats", "get_portefeuille",
    "spirica_get_contracts", "spirica_list_contracts",
    "cgp_contracts", "load_contracts",
]


def discover_contracts(spirica: SpirikaSession) -> list[dict]:
    """
    Récupère les contrats CGP depuis Spirica.
    Ordre de tentative :
      1. Endpoints WP REST custom
      2. Actions AJAX WordPress
      3. Pages HTML avec parsing de tableaux
      4. JSON embarqué dans les pages
    """

    # 1. Endpoints REST WordPress custom
    for path in _WP_REST_CONTRACT_PATHS:
        # Ajouter les routes découvertes dynamiquement
        if spirica._api_routes:
            dyn = [r for r in spirica._api_routes
                   if "contract" in r.lower() or "contrat" in r.lower()
                   or "portefeuille" in r.lower()]
            if dyn:
                print(f"  → Routes REST dynamiques : {dyn}")

        try:
            r = spirica.get_json(path)
            if r.status_code == 200:
                data = r.json()
                if data:
                    print(f"  → REST endpoint trouvé : {path}")
                    raw = data if isinstance(data, list) else (
                        data.get("contracts") or data.get("contrats") or [data]
                    )
                    return _normalize_spirica_contracts(raw)
        except Exception:
            pass

    # 2. Actions AJAX WordPress
    for action in _WP_AJAX_ACTIONS:
        try:
            r = spirica.ajax(action)
            if r.status_code == 200 and len(r.content) > 50:
                try:
                    data = r.json()
                    if data and data != 0 and data != "0":
                        print(f"  → AJAX action trouvée : {action}")
                        raw = data if isinstance(data, list) else data.get("data", [data])
                        return _normalize_spirica_contracts(raw)
                except Exception:
                    pass
        except Exception:
            pass

    # 3. Pages HTML avec parsing
    for path in _SPIRICA_HTML_PATHS:
        try:
            r = spirica.get(path)
            if r.status_code != 200 or len(r.content) < 500:
                continue

            # JSON embarqué
            blobs = find_json_in_html(r.text)
            for blob in blobs:
                if isinstance(blob, list) and blob:
                    if isinstance(blob[0], dict) and any(
                        k in blob[0] for k in
                        ("numero", "contractNumber", "numContrat", "id", "reference")
                    ):
                        print(f"  → JSON embarqué trouvé : {path}")
                        return _normalize_spirica_contracts(blob)

            # Tableaux HTML
            tables = parse_html_tables_all(r.text)
            if tables:
                # Trouver la table la plus susceptible de contenir des contrats
                for table in tables:
                    if table and any(
                        k.lower() in ("numéro", "contrat", "référence", "client", "encours")
                        for k in (table[0] or {}).keys()
                    ):
                        print(f"  → Table HTML contrats trouvée : {path}")
                        return _normalize_spirica_from_html(table)

        except Exception:
            pass

    print("  ⚠  Portail Spirica non cartographié — relancer avec --explore")
    return []


def _normalize_spirica_contracts(raw: list) -> list[dict]:
    """Normalise les données contrats Spirica vers le format cgp_common."""
    result = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        result.append({
            "client": {
                "client_ref": (item.get("clientId") or item.get("souscripteurRef")
                               or item.get("contractNumber") or item.get("numero") or ""),
                "last_name":  item.get("souscripteurNom") or item.get("lastName") or "INCONNU",
                "first_name": item.get("souscripteurPrenom") or item.get("firstName"),
            },
            "contract": {
                "contract_number":     item.get("contractNumber") or item.get("numero") or item.get("numContrat") or item.get("id"),
                "contract_name":       item.get("contractName") or item.get("libelle") or item.get("nomContrat"),
                "contract_type":       item.get("contractType") or item.get("typeContrat"),
                "total_value_eur":     _to_float(item.get("totalAmount") or item.get("encours") or item.get("valeur")),
                "last_valuation_date": item.get("valuationDate") or item.get("dateValorisation"),
                "opening_date":        item.get("openingDate") or item.get("dateSouscription"),
            },
            "positions":    _normalize_spirica_positions(item.get("positions") or item.get("supports") or []),
            "transactions": [],
        })
    return result


def _normalize_spirica_from_html(rows: list[dict]) -> list[dict]:
    """Normalise les lignes d'un tableau HTML Spirica."""
    col_map = {
        "Numéro": "contract_number", "N° contrat": "contract_number", "Référence": "contract_number",
        "Souscripteur": "last_name", "Client": "last_name", "Nom": "last_name",
        "Encours": "total_value_eur", "Valeur": "total_value_eur", "Montant": "total_value_eur",
        "Date": "last_valuation_date", "Type": "contract_type",
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
                "contract_number": number,
                "contract_type":   mapped.get("contract_type"),
                "total_value_eur": _to_float(mapped.get("total_value_eur")),
                "last_valuation_date": mapped.get("last_valuation_date"),
            },
            "positions": [], "transactions": [],
        })
    return result


def _normalize_spirica_positions(raw: list) -> list[dict]:
    result = []
    for pos in raw:
        if not isinstance(pos, dict):
            continue
        isin = pos.get("isin") or pos.get("codeISIN") or pos.get("code")
        if not isin:
            continue
        result.append({
            "isin":       isin,
            "fund_name":  pos.get("libelle") or pos.get("nom") or pos.get("fundName"),
            "value_eur":  _to_float(pos.get("valeur") or pos.get("montant") or pos.get("value")),
            "units":      _to_float(pos.get("nbParts") or pos.get("units") or pos.get("quantite")),
            "unit_value": _to_float(pos.get("vl") or pos.get("valeurLiquidative") or pos.get("unitValue")),
            "weight_pct": _to_float(pos.get("poids") or pos.get("repartition") or pos.get("weight")),
        })
    return result


def extract_positions(spirica: SpirikaSession, record: dict) -> list[dict]:
    """Récupère les positions d'un contrat si non embarquées."""
    number = (record.get("contract") or {}).get("contract_number")
    if not number:
        return []

    for path in [
        f"/wp-json/spirica/v1/contracts/{number}/positions",
        f"/wp-json/sp/v1/contracts/{number}/positions",
        f"/mes-contrats/{number}/positions/",
        f"/contrats/{number}/",
    ]:
        try:
            r = spirica.get_json(path)
            if r.status_code == 200 and len(r.content) > 100:
                data = r.json()
                if data:
                    raw = data if isinstance(data, list) else data.get("positions", [])
                    positions = _normalize_spirica_positions(raw)
                    if positions:
                        return positions
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
    print("  Spirica Extranet Connector")
    print("=" * 60)
    print(f"  Login  : {login}")
    print(f"  Mode   : {'EXPLORE' if explore else ('APPLY' if apply else 'DRY-RUN')}")
    print()

    started = datetime.now(timezone.utc)

    spirica = SpirikaSession(login, password)
    if not spirica.authenticate():
        if apply:
            log_run("extranet-spirica", "failed", 0, 0, started_at=started)
        return

    if explore:
        explore_portal(
            spirica.session, BASE_URL, HEADERS,
            extra_paths=_SPIRICA_HTML_PATHS + _WP_REST_CONTRACT_PATHS,
            verbose=True,
        )
        return

    print("  Récupération des contrats...")
    records = discover_contracts(spirica)
    print(f"  → {len(records)} contrat(s)")

    if not records:
        print("\n  ℹ  Portail non encore cartographié — relancer avec --explore")
        return

    for rec in records:
        if not rec.get("positions"):
            rec["positions"] = extract_positions(spirica, rec)

    if apply:
        db = get_client()
        ok, fail = upsert_all(db, cgp_id, records, insurer=INSURER, verbose=verbose)
        print(f"  → {ok} OK, {fail} échec")
        status = "success" if fail == 0 else "partial"
        log_run("extranet-spirica", status, ok, fail, started_at=started)
    else:
        total_pos = sum(len(r.get("positions", [])) for r in records)
        print(f"  Dry-run : {len(records)} contrats, {total_pos} positions")
        if verbose:
            for rec in records:
                c = rec["contract"]
                print(f"    {c.get('contract_number')}  {len(rec.get('positions',[]))} pos")
        print("  Relancer avec --apply pour écrire dans Supabase")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Spirica CGP Extranet Connector")
    parser.add_argument("--login",    default=os.environ.get("SPIRICA_LOGIN", ""))
    parser.add_argument("--password", default=os.environ.get("SPIRICA_PASSWORD", ""))
    parser.add_argument("--cgp-id",   default=os.environ.get("CGP_ID", ""))
    parser.add_argument("--apply",    action="store_true")
    parser.add_argument("--explore",  action="store_true",
                        help="Cartographie les endpoints accessibles après auth")
    parser.add_argument("--verbose",  action="store_true")
    args = parser.parse_args()

    if not args.login or not args.password:
        print("Erreur : --login et --password requis (ou SPIRICA_LOGIN / SPIRICA_PASSWORD)")
        sys.exit(1)

    run(
        login=args.login,
        password=args.password,
        cgp_id=args.cgp_id,
        apply=args.apply,
        explore=args.explore,
        verbose=args.verbose,
    )
