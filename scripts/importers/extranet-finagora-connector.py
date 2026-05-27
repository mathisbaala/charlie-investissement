#!/usr/bin/env python3
"""
extranet-finagora-connector.py — Connecteur extranet Finagora (BNP Cardif CGP)
===============================================================================
Extrait les données de portefeuilles clients depuis le portail CGP Finagora.

Portail : https://finagora.cardif.fr
Auth    : OpenID Connect PKCE via Keycloak
          Realm : digital-courtage
          Client: bnpp-cardif-FR-portailfinagora-aucacc-prod

Architecture OIDC PKCE :
  1. Générer code_verifier (random 128 chars) + code_challenge (SHA-256, base64url)
  2. GET authorization_endpoint → page de login Keycloak (HTML form)
  3. POST credentials → Keycloak redirect avec ?code=...
  4. POST token_endpoint avec code + code_verifier → access_token
  5. Utiliser access_token pour appeler les APIs Finagora

Variables d'environnement (ou .env) :
  FINAGORA_LOGIN    — identifiant CGP Finagora
  FINAGORA_PASSWORD — mot de passe CGP Finagora
  CGP_ID            — UUID du cabinet CGP dans Supabase

Usage :
    python3 scripts/importers/extranet-finagora-connector.py --dry-run
    python3 scripts/importers/extranet-finagora-connector.py --explore
    python3 scripts/importers/extranet-finagora-connector.py --apply --cgp-id <UUID>

Notes :
  - Le flow PKCE est implémenté sans dépendance externe (hashlib + secrets stdlib)
  - Mode --explore : cartographie tous les endpoints accessibles après auth
"""

import os
import sys
import re
import json
import base64
import hashlib
import secrets
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs, urlencode

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

sys.path.insert(0, str(Path(__file__).parent))
from cgp_common import (
    upsert_all, explore_portal,
    parse_html_tables_all, find_json_in_html, scan_js_for_api_base,
)

# ─── Config ───────────────────────────────────────────────────────────────────

PORTAL_URL = "https://finagora.cardif.fr"
INSURER    = "bnp-cardif"

KEYCLOAK_REALM  = "digital-courtage"
KEYCLOAK_BASE   = "https://fr-sesame-websso.bnpparibascardif.com/auth/realms"
AUTH_ENDPOINT   = f"{KEYCLOAK_BASE}/{KEYCLOAK_REALM}/protocol/openid-connect/auth"
TOKEN_ENDPOINT  = f"{KEYCLOAK_BASE}/{KEYCLOAK_REALM}/protocol/openid-connect/token"

CLIENT_ID    = "bnpp-cardif-FR-portailfinagora-aucacc-prod"
REDIRECT_URI = f"{PORTAL_URL}/callback"
SCOPE        = "openid profile email"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9",
}

TIMEOUT = 30


# ─── PKCE ─────────────────────────────────────────────────────────────────────

def generate_pkce() -> tuple[str, str]:
    code_verifier  = secrets.token_urlsafe(96)[:128]
    digest         = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


# ─── Auth ─────────────────────────────────────────────────────────────────────

class FinagoraSession:
    def __init__(self, login: str, password: str):
        self.login        = login
        self.password     = password
        self.session      = requests.Session()
        self.access_token: str | None = None
        self.token_type   = "Bearer"
        self._api_base: str | None = None

    def _get_keycloak_login_url(self, code_challenge: str, state: str) -> str:
        params = {
            "response_type":         "code",
            "client_id":             CLIENT_ID,
            "redirect_uri":          REDIRECT_URI,
            "scope":                 SCOPE,
            "state":                 state,
            "code_challenge":        code_challenge,
            "code_challenge_method": "S256",
        }
        return f"{AUTH_ENDPOINT}?{urlencode(params)}"

    def _submit_credentials(self, auth_url: str) -> str | None:
        r1 = self.session.get(auth_url, headers=HEADERS, timeout=TIMEOUT)
        if r1.status_code != 200:
            print(f"  ✗ Keycloak auth page : HTTP {r1.status_code}")
            return None

        action_match = re.search(r'action="([^"]+)"', r1.text)
        if not action_match:
            print("  ✗ Formulaire Keycloak introuvable")
            return None

        action_url = action_match.group(1).replace("&amp;", "&")

        r2 = self.session.post(
            action_url,
            data={"username": self.login, "password": self.password, "credentialId": ""},
            headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded",
                     "Referer": auth_url},
            timeout=TIMEOUT,
            allow_redirects=False,
        )

        if r2.status_code in (301, 302):
            location = r2.headers.get("Location", "")
            qs = parse_qs(urlparse(location).query)
            code = qs.get("code", [None])[0]
            if code:
                return code
            error = qs.get("error", [None])[0]
            print(f"  ✗ Keycloak error : {error}")
            return None

        if r2.status_code == 200:
            if "invalid" in r2.text.lower() or "incorrect" in r2.text.lower():
                print("  ✗ Identifiants incorrects (Keycloak)")
            else:
                print(f"  ⚠  Réponse inattendue (2FA ?) — URL: {r2.url}")
        else:
            print(f"  ✗ POST credentials : HTTP {r2.status_code}")
        return None

    def _exchange_code(self, code: str, code_verifier: str) -> bool:
        r = requests.post(
            TOKEN_ENDPOINT,
            data={
                "grant_type":    "authorization_code",
                "client_id":     CLIENT_ID,
                "code":          code,
                "redirect_uri":  REDIRECT_URI,
                "code_verifier": code_verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            print(f"  ✗ Token exchange : HTTP {r.status_code} — {r.text[:200]}")
            return False
        token_data        = r.json()
        self.access_token = token_data.get("access_token")
        self.token_type   = token_data.get("token_type", "Bearer")
        return bool(self.access_token)

    def authenticate(self) -> bool:
        code_verifier, code_challenge = generate_pkce()
        state    = secrets.token_urlsafe(16)
        auth_url = self._get_keycloak_login_url(code_challenge, state)
        print(f"  OIDC : {AUTH_ENDPOINT}")

        code = self._submit_credentials(auth_url)
        if not code:
            return False
        ok = self._exchange_code(code, code_verifier)
        if ok:
            print("  ✓ Token obtenu")
            self._discover_api_base()
        return ok

    def _discover_api_base(self):
        """Scanne le bundle JS de la SPA pour identifier l'URL de base des APIs."""
        try:
            r = self.session.get(
                PORTAL_URL,
                headers={**HEADERS, "Authorization": f"{self.token_type} {self.access_token}"},
                timeout=TIMEOUT,
            )
            if r.status_code != 200:
                return

            # Chercher les balises script src
            script_srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', r.text)
            for src in script_srcs:
                if not src.startswith("http"):
                    src = urljoin(PORTAL_URL, src)
                # Cibler les gros bundles JS (main, app, chunk)
                if not any(k in src for k in ("main", "app", "bundle", "chunk", "vendor")):
                    continue
                try:
                    js_r = self.session.get(src, timeout=20)
                    if js_r.status_code == 200:
                        candidates = scan_js_for_api_base(js_r.text)
                        if candidates:
                            print(f"  → API base candidates (JS scan) : {candidates[:5]}")
                            self._api_base = candidates[0]
                            return
                except Exception:
                    pass
        except Exception:
            pass

    def api_get(self, path: str, **kwargs) -> requests.Response:
        url = urljoin(self._api_base or PORTAL_URL, path)
        return self.session.get(
            url,
            headers={
                **HEADERS,
                "Authorization": f"{self.token_type} {self.access_token}",
                "Accept": "application/json",
            },
            timeout=TIMEOUT,
            **kwargs,
        )


# ─── Découverte + extraction ──────────────────────────────────────────────────

# Endpoints candidats Finagora (React SPA BNP Cardif)
# Mappés depuis les patterns typiques des portails Keycloak + React
_FINAGORA_CONTRACT_ENDPOINTS = [
    "/api/v1/contracts",
    "/api/v1/contrats",
    "/api/v1/portefeuille",
    "/api/v1/clients/{cgp}/contracts",
    "/api/contracts",
    "/api/portfolios",
    "/rest/v1/contrats",
    "/finagora/api/v1/contracts",
    "/cgp/api/v1/contracts",
    "/portail/api/v1/contrats",
    "/api/v2/contracts",
    "/api/v1/intermediaries/contracts",
    "/api/v1/broker/contracts",
]


def discover_contracts(finagora: FinagoraSession) -> list[dict]:
    """
    Récupère les contrats/portefeuilles du CGP.
    Essaie les endpoints connus + parsing HTML en fallback.
    """
    for endpoint in _FINAGORA_CONTRACT_ENDPOINTS:
        try:
            r = finagora.api_get(endpoint)
            if r.status_code == 200:
                ct = r.headers.get("Content-Type", "")
                if "json" in ct:
                    try:
                        data = r.json()
                        if data:
                            print(f"  → Endpoint JSON trouvé : {endpoint}")
                            return _normalize_contracts(
                                data if isinstance(data, list)
                                else data.get("data") or data.get("contracts")
                                or data.get("contrats") or [data]
                            )
                    except Exception:
                        pass
                elif "html" in ct and len(r.content) > 500:
                    # Fallback HTML : chercher JSON embarqué ou tableau
                    json_blobs = find_json_in_html(r.text)
                    for blob in json_blobs:
                        if isinstance(blob, list) and blob and isinstance(blob[0], dict):
                            if any(k in blob[0] for k in
                                   ("contractNumber", "contratNumber", "numero", "id")):
                                print(f"  → JSON embarqué trouvé : {endpoint}")
                                return _normalize_contracts(blob)
                    tables = parse_html_tables_all(r.text)
                    if tables:
                        print(f"  → Table HTML trouvée : {endpoint} ({len(tables)} tables)")
                        return _normalize_contracts_from_html(tables[0])
        except Exception:
            pass

    print("  ⚠  Endpoints Finagora non cartographiés.")
    print("     → Relancer avec --explore pour identifier les endpoints après auth")
    return []


def _normalize_contracts(raw: list | None) -> list[dict]:
    """Normalise les données contrats Finagora vers le format cgp_common."""
    if not raw:
        return []
    result = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        result.append({
            "client": {
                "client_ref":  (item.get("clientId") or item.get("souscripteurId")
                                or item.get("contractNumber") or item.get("numero") or ""),
                "last_name":   item.get("souscripteurNom") or item.get("clientLastName") or "INCONNU",
                "first_name":  item.get("souscripteurPrenom") or item.get("clientFirstName"),
            },
            "contract": {
                "contract_number":      item.get("contractNumber") or item.get("numero") or item.get("id"),
                "contract_name":        item.get("contractName") or item.get("nomContrat") or item.get("libelle"),
                "contract_type":        item.get("contractType") or item.get("typeContrat"),
                "total_value_eur":      _to_float(item.get("totalAmount") or item.get("encours") or item.get("valeur")),
                "last_valuation_date":  item.get("valuationDate") or item.get("dateValorisation"),
                "opening_date":         item.get("openingDate") or item.get("dateEffet") or item.get("dateSouscription"),
            },
            "positions":     _normalize_positions(item.get("positions") or item.get("positionsUA") or []),
            "transactions":  [],
        })
    return result


def _normalize_contracts_from_html(table_rows: list[dict]) -> list[dict]:
    """Normalise un tableau HTML contrats extrait par parse_html_tables_all."""
    # Mapping heuristique des en-têtes courants
    col_map = {
        "N° contrat": "contract_number", "Numéro": "contract_number",
        "Numéro contrat": "contract_number", "Référence": "contract_number",
        "Souscripteur": "last_name", "Client": "last_name", "Nom": "last_name",
        "Encours": "total_value_eur", "Valeur": "total_value_eur",
        "Date valorisation": "last_valuation_date",
        "Type": "contract_type",
    }
    result = []
    for row in table_rows:
        mapped = {}
        for k, v in row.items():
            dest = col_map.get(k, k)
            mapped[dest] = v
        number = mapped.get("contract_number")
        if not number:
            continue
        result.append({
            "client": {
                "client_ref": number,
                "last_name":  mapped.get("last_name") or "INCONNU",
            },
            "contract": {
                "contract_number": number,
                "contract_type":   mapped.get("contract_type"),
                "total_value_eur": _to_float(mapped.get("total_value_eur")),
                "last_valuation_date": mapped.get("last_valuation_date"),
            },
            "positions":    [],
            "transactions": [],
        })
    return result


def _normalize_positions(raw: list) -> list[dict]:
    """Normalise les positions Finagora."""
    result = []
    for pos in raw:
        if not isinstance(pos, dict):
            continue
        isin = pos.get("isin") or pos.get("codeISIN") or pos.get("codeFonds")
        if not isin:
            continue
        result.append({
            "isin":       isin,
            "fund_name":  pos.get("fundName") or pos.get("libelleFonds") or pos.get("nomFonds"),
            "value_eur":  _to_float(pos.get("value") or pos.get("montant") or pos.get("valorisation")),
            "units":      _to_float(pos.get("units") or pos.get("nbParts") or pos.get("nombreParts")),
            "unit_value": _to_float(pos.get("unitValue") or pos.get("valeurLiquidative") or pos.get("vl")),
            "weight_pct": _to_float(pos.get("weight") or pos.get("poids") or pos.get("repartition")),
        })
    return result


def extract_positions(finagora: FinagoraSession, record: dict) -> list[dict]:
    """Récupère les positions d'un contrat — appelé si non déjà embarquées."""
    contract_number = (record.get("contract") or {}).get("contract_number")
    if not contract_number:
        return []

    for endpoint in [
        f"/api/v1/contracts/{contract_number}/positions",
        f"/api/v1/contrats/{contract_number}/positions",
        f"/api/v1/contrats/{contract_number}/portefeuille",
    ]:
        try:
            r = finagora.api_get(endpoint)
            if r.status_code == 200 and "json" in r.headers.get("Content-Type", ""):
                data = r.json()
                if data:
                    raw = data if isinstance(data, list) else data.get("positions", [])
                    return _normalize_positions(raw)
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
    print("  Finagora (BNP Cardif) Extranet Connector")
    print("=" * 60)
    print(f"  Login  : {login}")
    print(f"  Mode   : {'EXPLORE' if explore else ('APPLY' if apply else 'DRY-RUN')}")
    print()

    started = datetime.now(timezone.utc)

    finagora = FinagoraSession(login, password)
    print("  Authentification OIDC PKCE...")
    if not finagora.authenticate():
        if apply:
            log_run("extranet-finagora", "failed", 0, 0, started_at=started)
        return

    if explore:
        explore_portal(finagora.session, PORTAL_URL, {
            **HEADERS,
            "Authorization": f"{finagora.token_type} {finagora.access_token}",
        }, verbose=True)
        return

    print("  Récupération des contrats...")
    records = discover_contracts(finagora)
    print(f"  → {len(records)} contrat(s)")

    if not records:
        print("\n  ℹ  Portail non encore cartographié — relancer avec --explore")
        return

    # Compléter les positions manquantes
    for rec in records:
        if not rec.get("positions"):
            rec["positions"] = extract_positions(finagora, rec)

    if apply:
        db = get_client()
        ok, fail = upsert_all(db, cgp_id, records, insurer=INSURER, verbose=verbose)
        print(f"  → {ok} OK, {fail} échec")
        status = "success" if fail == 0 else "partial"
        log_run("extranet-finagora", status, ok, fail, started_at=started)
    else:
        total_pos = sum(len(r.get("positions", [])) for r in records)
        print(f"  Dry-run : {len(records)} contrats, {total_pos} positions")
        if verbose:
            for rec in records:
                c = rec["contract"]
                print(f"    {c.get('contract_number')}  {len(rec.get('positions',[]))} pos")
        print("  Relancer avec --apply pour écrire dans Supabase")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Finagora (BNP Cardif) CGP Extranet Connector")
    parser.add_argument("--login",    default=os.environ.get("FINAGORA_LOGIN", ""))
    parser.add_argument("--password", default=os.environ.get("FINAGORA_PASSWORD", ""))
    parser.add_argument("--cgp-id",   default=os.environ.get("CGP_ID", ""))
    parser.add_argument("--apply",    action="store_true")
    parser.add_argument("--explore",  action="store_true",
                        help="Cartographie les endpoints accessibles après auth")
    parser.add_argument("--verbose",  action="store_true")
    args = parser.parse_args()

    if not args.login or not args.password:
        print("Erreur : --login et --password requis (ou FINAGORA_LOGIN / FINAGORA_PASSWORD)")
        sys.exit(1)

    run(
        login=args.login,
        password=args.password,
        cgp_id=args.cgp_id,
        apply=args.apply,
        explore=args.explore,
        verbose=args.verbose,
    )
