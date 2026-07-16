#!/usr/bin/env python3
"""
av-lux-cali-europe-catalog.py — Catalogue UC CALI Europe (Crédit Agricole, Lux)
================================================================================
CALI Europe S.A. (Crédit Agricole Life Insurance Europe — à ne PAS confondre
avec Cardif Lux Vie/BNP) distribue via les banques privées CA/LCL/Indosuez et
publie ses KID PRIIPS par contrat sur un portail public (sans login) :
  https://www.my-calie.com/FO.PRIIPS/Index.aspx?network=6U9TC

Mécanique (repérage + mise au point 2026-07-16) :
  1. Index.aspx pose la session ; l'iframe SearchKid.aspx contient le grid des
     produits avec des liens KidsHistoric.aspx?…&pnm=<code>&pct=<jeton session>
     (l'accès direct à KidsHistoric SANS le jeton pct → page d'erreur).
  2. On récolte les produits dont le marché contient « France » (France, France
     LPS) et on navigue vers chaque lien dans la même session → KidPartners.aspx.
  3. Le grid « KIDS SUPPORTS » (DevExpress ASPxGridView) est groupé (FID /
     devises / UC) et paginé : les clics DOM sur les icônes d'expansion sont
     inopérants, mais l'API CLIENTE DevExpress fonctionne :
       ASPxClientControl.GetControlCollection().Get('<grid>').ExpandAll()
       …​.GotoPage(i)  (GetPageCount() pages, ~30 pour ~286 UC)
     On regexe les ISIN du HTML après chaque page.

⚠️ NAVIGATEUR REQUIS (Playwright) — callbacks à état DevExpress, irreproduisibles
en requests pur (500, vérifié). À câbler dans av-catalog-refresh-browser.py
(PAS dans le job HTTP). Le paramètre network=6U9TC identifie un réseau de
distribution ; d'autres réseaux peuvent exposer d'autres univers.

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-lux-cali-europe-catalog.py            # dry-run
    python3 scripts/scrapers/av-lux-cali-europe-catalog.py --apply
"""

import re
import sys
import html as htmlmod
import argparse
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, _valid_isin  # noqa: E402

ROOT      = "https://www.my-calie.com/FO.PRIIPS"
INDEX_URL = f"{ROOT}/Index.aspx?network=6U9TC"
PAGES_DIR = f"{ROOT}/AutonomousPages/"

COMPANY = "CALI Europe"

SUPPORTS_GRID = "PriipsMasterContainer_KidPage1_ASPxGridView1"

ISIN_RE   = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
TIMEOUT   = 60_000  # ms
MAX_PAGES = 80      # garde anti-boucle (~30 pages observées par contrat)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def _wait_callback(page):
    """Attend la fin d'un callback DevExpress (overlay de chargement du grid)."""
    try:
        page.wait_for_selector(".dxgvLoadingDiv", state="visible", timeout=3_000)
    except Exception:
        pass  # callback déjà terminé (ou trop rapide pour être vu)
    try:
        page.wait_for_selector(".dxgvLoadingDiv", state="hidden", timeout=45_000)
    except Exception:
        pass
    page.wait_for_load_state("networkidle", timeout=TIMEOUT)


def _grid_eval(page, method: str):
    return page.evaluate(
        f"ASPxClientControl.GetControlCollection().Get('{SUPPORTS_GRID}').{method}")


def _discover_france_products(page) -> list[tuple[str, str]]:
    """(nom de produit, URL absolue KidsHistoric avec jeton pct) — marché France.

    Le grid produits de l'iframe SearchKid tient sur une page pour le réseau
    6U9TC (9 lignes) ; si un pager apparaissait, seuls les produits de la 1re
    page seraient vus (log en aval : contrats attendus manquants).
    """
    frame = next((f for f in page.frames if "SearchKid" in f.url), None)
    if frame is None:
        print("  ⚠ iframe SearchKid introuvable")
        return []
    out: list[tuple[str, str]] = []
    for row in frame.query_selector_all("tr[class*='dxgvDataRow']"):
        cells = [c.inner_text().strip() for c in row.query_selector_all("td")]
        if not any("France" in c for c in cells):
            continue
        link = row.query_selector("a[href*='KidsHistoric']")
        if link is None:
            continue
        name = next((c for c in cells if len(c) > 3), "")
        href = htmlmod.unescape(link.get_attribute("href") or "")
        if name and href:
            out.append((name, urljoin(PAGES_DIR, href)))
    return out


def fetch_contract_isins(page, url: str) -> list[str]:
    """ISIN du grid supports d'un produit (ExpandAll + GotoPage, session posée)."""
    isins: set[str] = set()
    page.goto(url, wait_until="networkidle", timeout=TIMEOUT)
    try:
        _grid_eval(page, "ExpandAll()")
    except Exception as e:
        print(f"      ⚠ grid supports absent : {str(e)[:80]}")
        return []
    _wait_callback(page)
    isins |= {x for x in ISIN_RE.findall(page.content()) if _valid_isin(x)}
    try:
        pages = int(_grid_eval(page, "GetPageCount()") or 1)
    except Exception:
        pages = 1
    for i in range(1, min(pages, MAX_PAGES)):
        try:
            _grid_eval(page, f"GotoPage({i})")
        except Exception as e:
            print(f"      ⚠ GotoPage({i}) : {str(e)[:60]}")
            break
        _wait_callback(page)
        isins |= {x for x in ISIN_RE.findall(page.content()) if _valid_isin(x)}
    return sorted(isins)


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print(f"  {COMPANY} — portail PRIIPS my-calie.com (navigateur)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    if not HAS_PLAYWRIGHT:
        print("  ✗ Playwright absent — scraper NAVIGATEUR (job av-refresh-browser uniquement).")
        if apply:
            log_run("av-lux-cali-europe-catalog", "failed", 0, 0, started_at=started)
        return

    per_contract: list[tuple[str, list[str]]] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA, locale="fr-FR")
        page = ctx.new_page()
        page.goto(INDEX_URL, wait_until="networkidle", timeout=TIMEOUT)
        products = _discover_france_products(page)
        if limit:
            products = products[:limit]
        print(f"  Produits France découverts : {len(products)}")
        for i, (name, url) in enumerate(products):
            isins = fetch_contract_isins(page, url)
            print(f"  [{i+1}/{len(products)}] {name[:46]:46} {len(isins):5} ISIN")
            per_contract.append((name, isins))
        browser.close()

    union = sorted({x for _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — portail/réseau changés ou grid renommé.")
        if apply:
            log_run("av-lux-cali-europe-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  Aperçu (10 premiers ISIN) :", ", ".join(union[:10]))
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for contract_name, isins in per_contract:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": COMPANY, "contract_name": contract_name,
                "source_url": INDEX_URL, "scraped_at": now,
            })
            if len(batch) >= 200:
                client.table("investissement_av_lux_eligibility") \
                    .upsert(batch, on_conflict="isin,contract_name").execute()
                ok += len(batch)
                batch = []
    if batch:
        client.table("investissement_av_lux_eligibility") \
            .upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} ISIN bruts avant filtre).")
    log_run("av-lux-cali-europe-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CALI Europe — catalogue UC (éligibilité-only, navigateur)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N produits (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
