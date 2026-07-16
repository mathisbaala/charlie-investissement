#!/usr/bin/env python3
"""
av-fr-cnp-dic-catalog.py — PER CNP via l'API DIC publique (dic.cnp.fr)
=======================================================================
Le portail DIC de CNP (SPA Angular) est adossé à une API Spring PUBLIQUE,
sans anti-bot ni cookie (repérage 2026-07-16) :
  GET /wkd-web/kid-webapi/sponsors/FR                      → 13 réseaux
  GET /wkd-web/kid-webapi/sponsors/FR/<sponsor>/products   → produits (+version)
  GET /wkd-web/kid-webapi/product/FR/<sponsor>/<version>   → JSON avec
      supports[] (isin, nom, assetManager, SFDR, endDate) et
      codeEntiteJuridique (entité assureur AUTORITAIRE — ex. « CNP Retraite »).

PÉRIMÈTRE : les PER individuels actifs des réseaux LBP (Cachemire PER, ~93
ISIN) et BPCE (PER CE, ~92 ISIN), découverts dynamiquement (produit actif dont
le nom matche PER/retraite). Préfon (produit à points) exclu. L'API couvre
aussi Nuances/EasyVie → pourrait à terme remplacer les PDF de
av-fr-cnp-catalog.py (source plus riche et structurée).

company_name = codeEntiteJuridique du produit (les PER sont portés par le FRPS
CNP Retraite, pas par CNP Assurances — même schéma que CAAR/ex-Predica).

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-fr-cnp-dic-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-cnp-dic-catalog.py --apply
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session, _valid_isin  # noqa: E402

API_ROOT   = "https://dic.cnp.fr/wkd-web/kid-webapi"
SOURCE_URL = "https://dic.cnp.fr"

SPONSORS = ["LBP", "BPCE"]
PER_NAME_RE = re.compile(r"\bper\b|retraite|perin|perp|madelin", re.IGNORECASE)
EXCLUDE_RE  = re.compile(r"prefon", re.IGNORECASE)  # produit à points, pas d'UC classiques

FALLBACK_COMPANY = "CNP Assurances"
# codeEntiteJuridique est parfois un libellé (« CNP Assurances »), parfois un
# code interne. A264 = FRPS CNP Retraite (porteur des PER depuis le transfert,
# cf. repérage 2026-07-16 — même schéma que CAAR/ex-Predica).
ENTITY_LABELS = {"A264": "CNP Retraite"}
TIMEOUT = 45
_ACRONYMS = {"PER", "CE", "LBP", "BPCE", "CNP"}


def _title(name: str) -> str:
    t = " ".join(name.split())
    if t.isupper():
        t = " ".join(w if w in _ACRONYMS else w.title() for w in t.split())
    return t


def _active(obj: dict) -> bool:
    end = obj.get("endDate")
    if not end:
        return True
    return str(end)[:10] >= datetime.now(timezone.utc).date().isoformat()


def discover_products(session) -> list[dict]:
    """PER actifs des réseaux ciblés : [{sponsor, version, name}]."""
    out = []
    for sp in SPONSORS:
        r = session.get(f"{API_ROOT}/sponsors/FR/{sp}/products", timeout=TIMEOUT)
        if r.status_code != 200:
            print(f"  ⚠ products {sp} : HTTP {r.status_code}")
            continue
        for p in r.json():
            name = str(p.get("name") or "")
            if not PER_NAME_RE.search(name) or EXCLUDE_RE.search(name):
                continue
            if not _active(p) or not p.get("version"):
                continue
            out.append({"sponsor": sp, "version": p["version"], "name": _title(name)})
        time.sleep(0.3)
    return out


def fetch_product(session, sponsor: str, version: str) -> tuple[str | None, list[str]]:
    """(codeEntiteJuridique, [isins des supports actifs]) d'un produit."""
    r = session.get(f"{API_ROOT}/product/FR/{sponsor}/{version}", timeout=TIMEOUT)
    if r.status_code != 200:
        print(f"      ⚠ product {version} : HTTP {r.status_code}")
        return None, []
    j = r.json()
    raw = str(j.get("codeEntiteJuridique") or "").strip()
    # libellé si l'API en donne un (contient un espace), sinon mapping des codes
    company = raw if " " in raw else ENTITY_LABELS.get(raw)
    isins = {str(sup.get("isin") or "").strip().upper()
             for sup in (j.get("supports") or []) if _active(sup)}
    return company, sorted(x for x in isins if _valid_isin(x))


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print("  CNP (dic.cnp.fr) — PER individuels par réseau")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    session = make_session()
    products = discover_products(session)
    if limit:
        products = products[:limit]
    print(f"  PER actifs découverts : {len(products)}")

    per_contract: list[tuple[str, str, list[str]]] = []  # (company, contract, isins)
    for i, p in enumerate(products):
        company, isins = fetch_product(session, p["sponsor"], p["version"])
        company = company or FALLBACK_COMPANY
        print(f"  [{i+1}/{len(products)}] {p['name'][:34]:34} ({company[:22]:22}) {len(isins):4} ISIN")
        per_contract.append((company, p["name"], isins))
        time.sleep(0.3)

    union = sorted({x for _, _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — API déplacée ou filtre produits cassé.")
        if apply:
            log_run("av-fr-cnp-dic-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for company, contract_name, isins in per_contract:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": company, "contract_name": contract_name,
                "source_url": SOURCE_URL, "scraped_at": now,
            })
    if batch:
        client.table("investissement_av_lux_eligibility") \
            .upsert(batch, on_conflict="isin,contract_name").execute()
        ok = len(batch)

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} ISIN bruts avant filtre).")
    log_run("av-fr-cnp-dic-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CNP DIC — PER (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N produits (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
