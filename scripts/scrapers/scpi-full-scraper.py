#!/usr/bin/env python3
"""
scpi-full-scraper.py — Données SCPI depuis sources multiples
=============================================================
Collecte les données de toutes les SCPIs françaises depuis :
  1. france-scpi.fr     — liste complète + données clés (DVM, TOF, prix)
  2. meilleuresscpi.com — données complémentaires (capitalisation, rendements)
  3. scpi-lab.com       — données de marché et géographie

Pour chaque SCPI :
  - Nom, ISIN (si disponible), société de gestion
  - Prix de souscription (part)
  - Taux de distribution (DVM %)
  - Taux d'occupation financier (TOF %)
  - Capitalisation totale (€)
  - Type d'actifs (bureaux, commerces, résidentiel, santé, logistique…)
  - Géographie (France, Europe, International)
  - Délai de jouissance (mois)
  - Délai de retrait (jours)
  - Frais de souscription (%)
  - Fréquence de distribution (annuelle, trimestrielle, mensuelle)

Usage :
    python3 scripts/scrapers/scpi-full-scraper.py [--apply] [--source france-scpi]
    python3 scripts/scrapers/scpi-full-scraper.py --apply  (toutes les sources)
"""

import re
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path
from html.parser import HTMLParser

import requests
from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT_SEC = 1.2
TIMEOUT        = 20

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
}

# Mapping type actifs SCPI → asset_class
SCPI_TYPE_MAP = {
    "bureaux":      "immobilier",
    "commerces":    "immobilier",
    "résidentiel":  "immobilier",
    "résidences":   "immobilier",
    "santé":        "immobilier",
    "logistique":   "immobilier",
    "hôtellerie":   "immobilier",
    "hotellerie":   "immobilier",
    "diversifié":   "immobilier",
    "international":"immobilier",
    "europe":       "immobilier",
}

# ─── Utilitaires ──────────────────────────────────────────────────────────────

def parse_percent(s: str | None) -> float | None:
    if not s:
        return None
    try:
        clean = re.sub(r"[^\d.,]", "", str(s).replace(",", "."))
        val = float(clean)
        return round(val / 100, 6) if val > 1 else round(val, 6)
    except (ValueError, TypeError):
        return None

def parse_price(s: str | None) -> float | None:
    if not s:
        return None
    try:
        clean = re.sub(r"[^\d.,]", "", str(s).replace(",", ".").replace(" ", ""))
        return round(float(clean), 2)
    except (ValueError, TypeError):
        return None

def parse_millions(s: str | None) -> int | None:
    """Parse '1,2 Md€' ou '850 M€' ou '1200000000' → entier euros."""
    if not s:
        return None
    s = str(s).replace("\xa0", " ").strip()
    multiplier = 1
    if re.search(r"Md|milliard", s, re.IGNORECASE):
        multiplier = 1_000_000_000
    elif re.search(r"M\b|million", s, re.IGNORECASE):
        multiplier = 1_000_000
    clean = re.sub(r"[^\d.,]", "", s).replace(",", ".")
    try:
        return int(float(clean) * multiplier)
    except (ValueError, TypeError):
        return None


# ─── Source 1 : france-scpi.fr ────────────────────────────────────────────────

FRANCE_SCPI_LIST = "https://www.france-scpi.fr/scpi/liste-scpi"
FRANCE_SCPI_BASE = "https://www.france-scpi.fr"

def scrape_france_scpi_list(session: FetcherSession) -> list[dict]:
    """Récupère la liste des SCPIs depuis france-scpi.fr."""
    print("  [france-scpi.fr] Chargement de la liste...", end=" ", flush=True)
    time.sleep(RATE_LIMIT_SEC)
    try:
        page = session.get(FRANCE_SCPI_LIST, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            print(f"✗ HTTP {page.status}")
            return []
    except Exception as e:
        print(f"✗ {e}")
        return []

    html = page.body.decode("utf-8")

    # Extraire les liens et noms SCPI
    # Pattern typique : <a href="/scpi/detail/nom-scpi">Nom SCPI</a>
    pattern = r'href=["\'](/scpi/[a-z0-9-]+(?:/\d+)?)["\'][^>]*>([^<]{3,60})</a>'
    matches = re.findall(pattern, html, re.IGNORECASE)

    scpi_links = []
    seen = set()
    for href, name in matches:
        if href in seen or "liste" in href:
            continue
        seen.add(href)
        scpi_links.append({"url": FRANCE_SCPI_BASE + href, "name": name.strip()})

    print(f"✓ {len(scpi_links)} SCPIs trouvées")
    return scpi_links


def scrape_france_scpi_detail(session: FetcherSession, url: str, name: str) -> dict | None:
    """Scrape la fiche détail d'une SCPI sur france-scpi.fr."""
    time.sleep(RATE_LIMIT_SEC)
    try:
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            return None
        html = page.body.decode("utf-8")
    except Exception:
        return None

    data = {"name": name, "product_type": "scpi", "asset_class": "immobilier",
            "distributor_france": True, "data_source": "france-scpi", "currency": "EUR"}

    # Extraire données clés via regex sur le HTML

    # Taux de distribution (DVM)
    m = re.search(r"(?:taux de distribution|DVM)[^%\d]*(\d+[.,]\d+)\s*%", html, re.IGNORECASE)
    if m:
        data["distribution_yield"] = parse_percent(m.group(1))

    # Taux d'occupation financier (TOF)
    m = re.search(r"taux d.occupation\s+financier[^%\d]*(\d+[.,]\d+)\s*%", html, re.IGNORECASE)
    if m:
        data["occupancy_rate"] = parse_percent(m.group(1))

    # Prix de part
    m = re.search(r"(?:prix de\s+(?:souscription|part))[^€\d]*(\d[\d\s]*[.,]?\d*)\s*€", html, re.IGNORECASE)
    if m:
        data["price_per_share"] = parse_price(m.group(1))

    # Capitalisation
    m = re.search(r"capitalisation[^€\d]*(\d+[.,]?\d*\s*(?:Md|M|million|milliard)?\s*€)", html, re.IGNORECASE)
    if m:
        data["aum_eur"] = parse_millions(m.group(1))

    # ISIN
    m = re.search(r'\b(FR\d{10})\b', html)
    if m:
        data["isin"] = m.group(1)

    # Société de gestion
    m = re.search(r"(?:société de gestion|gestionnaire)[^<]*<[^>]+>([^<]{3,60})<", html, re.IGNORECASE)
    if m:
        data["management_company"] = m.group(1).strip()

    # Type d'actifs
    for typ in ["bureaux", "commerces", "résidentiel", "santé", "logistique", "hôtellerie", "diversifié"]:
        if typ.lower() in html.lower():
            data["category"] = typ
            break

    # Frais de souscription
    m = re.search(r"frais de\s+(?:souscription|entrée)[^%\d]*(\d+[.,]\d+)\s*%", html, re.IGNORECASE)
    if m:
        data["entry_fee_max"] = parse_percent(m.group(1))

    # Valider : besoin d'au moins un champ financier + nom
    if not data.get("isin") and not data.get("distribution_yield") and not data.get("price_per_share"):
        return None

    # Si pas d'ISIN → utiliser le nom comme identifiant temporaire
    if not data.get("isin"):
        # Construire un pseudo-ISIN depuis le nom (pour référence interne)
        clean = re.sub(r"[^A-Z0-9]", "", name.upper())[:10].ljust(10, "0")
        data["isin"] = f"FR{clean}"

    return data


def scrape_france_scpi(session: FetcherSession) -> list[dict]:
    """Pipeline complet france-scpi.fr."""
    links = scrape_france_scpi_list(session)
    results = []
    for i, link in enumerate(links, 1):
        d = scrape_france_scpi_detail(session, link["url"], link["name"])
        if d:
            results.append(d)
            if i % 20 == 0:
                print(f"    france-scpi.fr : {i}/{len(links)} traités, {len(results)} valides")
    print(f"  [france-scpi.fr] → {len(results)} SCPIs collectées")
    return results


# ─── Source 2 : meilleuresscpi.com ────────────────────────────────────────────

MSCPI_LIST = "https://www.meilleuresscpi.com/liste-des-scpi/"

def scrape_meilleuresscpi(session: FetcherSession) -> list[dict]:
    """Scrape meilleuresscpi.com pour les données complémentaires."""
    print("  [meilleuresscpi.com] Chargement...", end=" ", flush=True)
    time.sleep(RATE_LIMIT_SEC)
    try:
        page = session.get(MSCPI_LIST, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            print(f"✗ HTTP {page.status}")
            return []
        html = page.body.decode("utf-8")
    except Exception as e:
        print(f"✗ {e}")
        return []

    results = []

    # Chercher les blocs de données SCPI dans le HTML
    # Structure typique : tableau avec colonnes Nom, DVM, Prix, TOF, Capitalisation
    rows = re.findall(
        r'<tr[^>]*>.*?</tr>',
        html, re.DOTALL | re.IGNORECASE
    )

    for row in rows:
        # Extraire cellules
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL | re.IGNORECASE)
        if len(cells) < 3:
            continue

        # Nettoyer HTML dans les cellules
        clean_cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]

        # Détecter si c'est une ligne SCPI (première cellule = nom, pas trop court)
        name = clean_cells[0]
        if len(name) < 3 or re.match(r'^\d', name):
            continue

        data = {
            "name":          name,
            "product_type":  "scpi",
            "asset_class":   "immobilier",
            "currency":      "EUR",
            "data_source":   "meilleuresscpi",
            "distributor_france": True,
        }

        # Tenter de parser les colonnes restantes
        for cell in clean_cells[1:]:
            if re.search(r'\d+[.,]\d+\s*%', cell):
                val = parse_percent(re.search(r'(\d+[.,]\d+)', cell).group(1))
                if val and 0.01 < val < 0.2:  # DVM typiquement 1-20%
                    data["distribution_yield"] = val
                elif val and val < 0.01:  # frais
                    data.setdefault("entry_fee_max", val)
            elif re.search(r'\d+\s*€', cell):
                price = parse_price(cell)
                if price and 100 < price < 50_000:  # prix de part typique
                    data["price_per_share"] = price
                elif price and price > 50_000:  # capitalisation
                    data["aum_eur"] = int(price)

        # ISIN — souvent dans le HTML via data-isin ou lien
        isin_m = re.search(r'(FR\d{10})', row)
        if isin_m:
            data["isin"] = isin_m.group(1)
        else:
            clean = re.sub(r"[^A-Z0-9]", "", name.upper())[:10].ljust(10, "0")
            data["isin"] = f"FR{clean}"

        if data.get("distribution_yield") or data.get("price_per_share"):
            results.append(data)

    print(f"✓ {len(results)} SCPIs collectées")
    return results


# ─── Merge & dedup ────────────────────────────────────────────────────────────

def merge_scpi_data(sources: list[list[dict]]) -> list[dict]:
    """Fusionne les données de plusieurs sources. france-scpi.fr a priorité."""
    by_isin: dict[str, dict] = {}
    by_name: dict[str, dict] = {}

    for source in sources:
        for d in source:
            isin = d.get("isin", "")
            name_key = re.sub(r"[^A-Z0-9]", "", d["name"].upper())

            existing = by_isin.get(isin) or by_name.get(name_key)
            if existing:
                # Enrichir avec les champs manquants
                for k, v in d.items():
                    if v is not None and existing.get(k) is None:
                        existing[k] = v
            else:
                by_isin[isin]     = d
                by_name[name_key] = d

    return list(by_isin.values())


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, source: str | None):
    print("=" * 60)
    print("  SCPI Full Scraper — france-scpi.fr + meilleuresscpi.com")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()
    all_results = []

    # Source 1 : france-scpi.fr
    if not source or source == "france-scpi":
        data = scrape_france_scpi(session)
        all_results.append(data)
        print()

    # Source 2 : meilleuresscpi.com
    if not source or source == "meilleuresscpi":
        data = scrape_meilleuresscpi(session)
        all_results.append(data)
        print()

    # Fusion
    merged = merge_scpi_data(all_results)
    print(f"  Total après fusion : {len(merged)} SCPIs uniques")

    if not merged:
        print("  ⚠️  Aucune donnée collectée")
        return

    if apply:
        ok, fail = upsert_funds_bulk(merged)
        print(f"  → Upsert : {ok} OK, {fail} échec")

        # Mettre à jour investissement_scpi_metrics
        client = get_client()
        for d in merged:
            isin = d.get("isin")
            if not isin:
                continue
            metrics = {}
            if d.get("distribution_yield"):
                metrics["dvm"] = d["distribution_yield"]
            if d.get("occupancy_rate"):
                metrics["tof"] = d["occupancy_rate"]
            if d.get("price_per_share"):
                metrics["price_per_share"] = d["price_per_share"]
            if d.get("aum_eur"):
                metrics["capitalization"] = d["aum_eur"]
            if metrics:
                metrics["isin"]   = isin
                metrics["period"] = f"{datetime.now().year}-Q{(datetime.now().month - 1) // 3 + 1}"
                metrics["updated_at"] = datetime.now(timezone.utc).isoformat()
                try:
                    client.table("investissement_scpi_metrics") \
                        .upsert(metrics, on_conflict="isin") \
                        .execute()
                except Exception:
                    pass

            # Minimum à investir d'une SCPI/OPCI = prix d'UNE part (on ne peut pas
            # souscrire moins). On alimente le champ fund-level min_subscription_eur
            # (fiche fonds « Minimum d'investissement »), fill-only pour ne pas
            # écraser une valeur curée éventuelle. Cf. migration 20260723140000.
            if d.get("price_per_share"):
                try:
                    client.table("investissement_funds") \
                        .update({"min_subscription_eur": d["price_per_share"]}) \
                        .eq("isin", isin) \
                        .is_("min_subscription_eur", "null") \
                        .execute()
                except Exception:
                    pass

        log_run("scpi-full-scraper", "success", ok, fail, started_at=started)
    else:
        print("\n  Aperçu (5 premiers) :")
        for d in merged[:5]:
            dvm   = f"{d.get('distribution_yield', 0)*100:.2f}%" if d.get("distribution_yield") else "N/A"
            price = f"{d.get('price_per_share', 0):.0f}€" if d.get("price_per_share") else "N/A"
            print(f"  {d['isin']} | DVM:{dvm:6} | Prix:{price:8} | {d['name'][:40]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SCPI Full Scraper")
    parser.add_argument("--apply",  action="store_true",       help="Écrire dans Supabase")
    parser.add_argument("--source", type=str, default=None,    help="france-scpi | meilleuresscpi")
    args = parser.parse_args()
    run(apply=args.apply, source=args.source)
