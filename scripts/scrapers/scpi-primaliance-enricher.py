#!/usr/bin/env python3
"""
scpi-primaliance-enricher.py — Enrichissement SCPI via primaliance.com
=======================================================================
Primaliance (groupe ERES) maintient une fiche détaillée par SCPI accessible
via un sitemap public (https://www.primaliance.com/products/sitemap.xml).
Chaque page contient des blocs HTML structurés (Drupal paragraphs) avec :

  - taux_distribution            → performance_1y (TDVM/TD %)
  - tri_5ans                     → performance_5y (TRI 5 ans % annualisé)
  - tri_10ans                    → (info) TRI 10 ans
  - frais_gestion                → ongoing_charges (% des loyers, ≈ TER SCPI)
  - indicateur_risque            → sri (1-7, "Indicateur de risque X/7")
  - capitalisation               → aum_eur
  - date_creation                → inception_date (year)
  - taux_occupation              → (info) TOF
  - valeur_reconstitution        → (info)

Le nom officiel de la SCPI est publié en JSON-LD (@type Product → name),
ce qui permet un matching fiable avec investissement_funds.name.

Source : ~133 SCPIs + 31 OPCI/SCI (avec ISINs réels FR* dans le slug).

Usage :
    python3 scripts/scrapers/scpi-primaliance-enricher.py            # dry-run
    python3 scripts/scrapers/scpi-primaliance-enricher.py --apply    # écrit en DB
    python3 scripts/scrapers/scpi-primaliance-enricher.py --apply --limit 20
"""

import argparse
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests
from parsel import Selector

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402

# Champs « métriques » réécrits en mode --refresh (changent dans le temps) ; les
# autres (identité : SGP, catégorie, date de création, SRI) restent fill-only.
REFRESHABLE = {"performance_1y", "performance_5y", "ongoing_charges", "aum_eur"}

SITEMAP_URL = "https://www.primaliance.com/products/sitemap.xml"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Version/16.0 Safari/605.1.15"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept": "text/html,application/xhtml+xml",
}
TIMEOUT = 20
RATE_LIMIT_SEC = 1.5


# ─── Normalisation des noms ────────────────────────────────────────────────────

def normalize(s: str) -> str:
    s = (s or "").upper().strip()
    # Ligatures : NFD ne les décompose PAS (Œ reste Œ) et [^A-Z0-9] les supprime
    # ensuite → 'Cœur' donnait 'CUR' au lieu de 'COEUR', faisant rater le match
    # avec le slug Primaliance 'coeur-deurope'. On les développe explicitement.
    s = s.replace("Œ", "OE").replace("Æ", "AE")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


# Aliases manuels pour les noms qui diffèrent légèrement entre la base et Primaliance.
# Format : nom normalisé Primaliance → nom normalisé DB (ou vice-versa)
NAME_ALIASES: dict[str, str] = {
    # Exemples — étendus à mesure que des mismatches sont identifiés
    "SCPICAPIFORCE": "CAPIFORCEPIERRE",
    "PIERREEXPANSIONSANTE": "PIERREEXPANSION",
    # Novaxia commercialise sa SCPI sous le seul nom « NEO » côté Primaliance
    # (slug 260-scpi-neo) alors que la base la nomme « Novaxia NEO ».
    "NOVAXIANEO": "NEO",
}


# ─── Parsing ──────────────────────────────────────────────────────────────────

def parse_percent(text: str) -> float | None:
    """Extrait un pourcentage français : '7,98 %' → 7.98"""
    if not text:
        return None
    m = re.search(r"([\-\+]?\d+(?:[\.,]\d+)?)\s*%", text)
    if not m:
        return None
    try:
        val = float(m.group(1).replace(",", "."))
        return round(val, 4)
    except ValueError:
        return None


def parse_capitalisation(text: str) -> int | None:
    """'1 374,39 M€' → 1_374_390_000"""
    if not text:
        return None
    m = re.search(r"([\d][\d\s\xa0]*(?:[\.,]\d+)?)\s*M€", text)
    if not m:
        return None
    raw = re.sub(r"[\s\xa0]", "", m.group(1)).replace(",", ".")
    try:
        val = float(raw)
        if 0.1 <= val <= 200_000:
            return round(val * 1_000_000)  # round, pas int : évite 1051,87→…9999
    except ValueError:
        pass
    return None


def parse_year(text: str) -> int | None:
    """'Date de création 1976' → 1976"""
    if not text:
        return None
    m = re.search(r"\b(19\d{2}|20\d{2})\b", text)
    return int(m.group(1)) if m else None


def parse_prix_part(html: str) -> float | None:
    """Prix de part SCPI : 'Prix de part : 458,00€' → 458.00 (texte dé-balisé)."""
    txt = re.sub(r"<[^>]+>", " ", html)
    m = re.search(r"Prix de part\s*:?\s*([\d\s\xa0]+,\d{2})\s*€", txt)
    if not m:
        return None
    raw = re.sub(r"[\s\xa0]", "", m.group(1)).replace(",", ".")
    try:
        val = float(raw)
        return val if 0 < val <= 100_000 else None
    except ValueError:
        return None


def parse_vl(html: str) -> float | None:
    """Valeur liquidative OPCI/SCI : 'Valeur liquidative 105,50€' → 105.50.

    Les OPCI/SCI ne cotent pas en « Prix de part » mais en VL : c'est le prix
    de souscription/rachat de la part, donc l'équivalent de price_per_share.
    On prend la 1re occurrence (VL principale du fonds, comme parse_prix_part)."""
    txt = re.sub(r"<[^>]+>", " ", html)
    m = re.search(r"Valeur liquidative\s*:?\s*([\d\s\xa0]+,\d{2})\s*€", txt)
    if not m:
        return None
    raw = re.sub(r"[\s\xa0]", "", m.group(1)).replace(",", ".")
    try:
        val = float(raw)
        return val if 0 < val <= 100_000 else None
    except ValueError:
        return None


def extract_isin_from_url(url: str) -> str | None:
    """Les URLs OPCI/SCI Primaliance terminent par l'ISIN : /157-opci-...-FR0010956912"""
    m = re.search(r"-([A-Z]{2}\d{10}|[A-Z0-9]{12,20})$", url)
    if m:
        candidate = m.group(1)
        if re.match(r"^[A-Z]{2}\d{10}$", candidate):
            return candidate
    return None


def _css_text(sel: Selector, selector: str) -> str | None:
    """Extrait le texte du premier élément CSS trouvé."""
    els = sel.css(selector)
    if not els:
        return None
    v = (els[0].css("::text").get() or "").strip()
    return v if v else None


def _jsonld_nodes(sel: Selector) -> list:
    """Tous les nœuds JSON-LD de la page (aplati @graph)."""
    out = []
    for raw in sel.css('script[type="application/ld+json"]::text').getall():
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(data, dict):
            out.extend(data.get("@graph", [data]))
        elif isinstance(data, list):
            out.extend(data)
    return out


def fetch_sitemap_urls(sess: requests.Session) -> list[str]:
    """Récupère toutes les URLs SCPI/OPCI/SCI depuis le sitemap Primaliance."""
    r = sess.get(SITEMAP_URL, headers=HEADERS, timeout=TIMEOUT)
    if r.status_code != 200 or not r.text:
        raise RuntimeError(f"Sitemap HTTP {r.status_code}")
    urls = re.findall(r"<loc>([^<]+)</loc>", r.text)
    return [u for u in urls if "/scpi-" in u or "/opci-" in u or "/sci-" in u]


def parse_scpi_page(sess: requests.Session, url: str) -> dict | None:
    """Récupère une fiche Primaliance et extrait les champs via CSS selectors (parsel)."""
    r = sess.get(url, headers=HEADERS, timeout=TIMEOUT)
    if r.status_code != 200 or not r.text:
        return None
    html_text = r.text
    page = Selector(text=html_text)
    nodes = _jsonld_nodes(page)

    # 1) Nom canonique depuis le JSON-LD Product
    name = None
    for node in nodes:
        if isinstance(node, dict) and node.get("@type") == "Product":
            name = node.get("name")
            break

    # Fallback : h1
    if not name:
        name = _css_text(page, "h1")

    if not name:
        return None

    # 1b) Société de gestion depuis JSON-LD (brand / manufacturer)
    mgmt_co = None
    for node in nodes:
        if not isinstance(node, dict):
            continue
        for key in ("brand", "manufacturer", "seller", "provider"):
            v = node.get(key)
            if isinstance(v, dict):
                mgmt_co = v.get("name")
            elif isinstance(v, str):
                mgmt_co = v
            if mgmt_co:
                break
        if mgmt_co:
            break

    # 2) Métriques via CSS selectors directs (confirmed selectors)
    result: dict = {"name": name.strip(), "url": url}

    def _pct_field(selector: str) -> float | None:
        major = _css_text(page, f"{selector} .major-nb")
        minor = _css_text(page, f"{selector} .minor-nb")
        if major:
            unit = minor or ""
            return parse_percent(f"{major} {unit}")
        return None

    td = _pct_field(".taux_distribution")
    if td is not None:
        result["taux_distribution"] = td

    tri5 = _pct_field(".tri_5ans")
    if tri5 is not None:
        result["tri_5ans"] = tri5

    tri10 = _pct_field(".tri_10ans")
    if tri10 is not None:
        result["tri_10ans"] = tri10

    fg = _pct_field(".frais_gestion")
    if fg is not None:
        result["frais_gestion"] = fg

    fs = _pct_field(".frais_souscription")
    if fs is not None:
        result["frais_souscription"] = fs

    cap_major = _css_text(page, ".capitalisation .major-nb")
    cap_minor = _css_text(page, ".capitalisation .minor-nb")
    if cap_major and cap_minor:
        result["capitalisation_eur"] = parse_capitalisation(f"{cap_major} {cap_minor}")

    prix = parse_prix_part(html_text)  # 'Prix de part : 458,00€' (texte labellisé)
    if prix is None and ("-opci-" in url or "-sci-" in url):
        # OPCI/SCI (type dans le slug : '248-opci-…', '278-sci-…', tous sous
        # /scpi-de-rendement/) : pas de « Prix de part » → la VL fait office de
        # prix de part (prix de souscription/rachat de la part).
        prix = parse_vl(html_text)
    if prix is not None:
        result["prix_part"] = prix

    year_major = _css_text(page, ".date_creation .major-nb")
    if year_major:
        result["year_created"] = parse_year(year_major)

    tof = _pct_field(".taux_occupation")
    if tof is not None:
        result["tof"] = tof

    # SRI — "Indicateur de risque X/7" (pas de CSS class dédiée) ; patterns
    # textuels sur le HTML brut (html_text défini en tête de fonction).
    sri_m = re.search(
        r'Indicateur de risque\s*</div>\s*<div[^>]*>\s*([1-7])\s*/\s*7',
        html_text, re.IGNORECASE
    )
    if sri_m:
        result["sri"] = int(sri_m.group(1))

    # Société de gestion : lien /societes-de-gestion/{slug}
    mgmt_els = page.css('a[href*="/societes-de-gestion/"]')
    if mgmt_els:
        v = (mgmt_els[0].css("::text").get() or "").strip()
        if v and len(v) > 1:
            result["management_company"] = v
    if "management_company" not in result and mgmt_co:
        result["management_company"] = mgmt_co.strip()

    # Catégorie SCPI
    SCPI_TYPES = ["Bureaux", "Résidentielle", "Diversifiée", "Commerces", "Santé",
                  "Logistique", "Tourisme", "Forêts", "Spécialisée", "VEFA",
                  "Hôtellerie", "Éducation", "Mixte"]
    for sel in (".type_scpi", ".categorie_scpi", ".field--name-field-type-scpi",
                ".field--name-field-secteur"):
        v = _css_text(page, sel)
        if v and len(v) > 2:
            result["scpi_category"] = v.strip()
            break
    if "scpi_category" not in result:
        for cat in SCPI_TYPES:
            if re.search(r'\b' + cat[:7], html_text, re.IGNORECASE):
                result["scpi_category"] = cat
                break

    return result


# ─── Matching DB ──────────────────────────────────────────────────────────────

def build_prima_index(records: list[dict]) -> dict[str, dict]:
    """Indexe les fiches Primaliance par nom normalisé."""
    idx: dict[str, dict] = {}
    for rec in records:
        norm = normalize(rec["name"])
        # Suppression du préfixe SCPI si présent
        norm = re.sub(r"^SCPI", "", norm)
        idx[norm] = rec
    return idx


def find_match(db_name: str, prima_index: dict[str, dict]) -> dict | None:
    n = re.sub(r"^SCPI", "", normalize(db_name))
    if n in prima_index:
        return prima_index[n]
    if n in NAME_ALIASES and NAME_ALIASES[n] in prima_index:
        return prima_index[NAME_ALIASES[n]]
    # Partiel — direction longue contient courte
    for pn, rec in prima_index.items():
        if len(n) >= 6 and len(pn) >= 6 and (n in pn or pn in n):
            # Éviter les faux positifs très courts (ex: 'PIERRE' qui matche 10 SCPIs)
            shortest = min(len(n), len(pn))
            longest = max(len(n), len(pn))
            if shortest >= 6 and longest - shortest <= 8:
                return rec
    return None


# ─── Pipeline ─────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None = None, refresh: bool = False):
    print("=" * 70)
    print("  SCPI Primaliance Enricher — TDVM/p5y/TER via primaliance.com")
    print("=" * 70)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}"
          + ("  [REFRESH : réécrit TD/TRI/frais/encours]" if refresh
             else "  [fill-only : ne remplit que les trous]"))
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    sess = requests.Session()

    # 1. Charger sitemap
    print("  [1/3] Téléchargement du sitemap Primaliance...")
    try:
        urls = fetch_sitemap_urls(sess)
    except Exception as e:
        print(f"  ✗ Sitemap inaccessible : {e}")
        return
    print(f"        {len(urls)} URLs SCPI/OPCI/SCI trouvées")

    if limit:
        urls = urls[:limit]
        print(f"        --limit appliqué : {len(urls)} pages à scrape")

    # 2. Charger les SCPIs/OPCI/SCI de la DB
    db_funds = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name, performance_1y, performance_5y, ongoing_charges, ter, aum_eur, inception_date, management_company, category, sri, entry_fee_max")
            .in_("product_type", ["scpi", "opci", "sci"])
            .range(offset, offset + 999)
            .execute().data or []
        )
        db_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"        {len(db_funds)} SCPIs/OPCI/SCI en base")
    print()

    # 3. Scraper chaque page
    print(f"  [2/3] Scraping des fiches Primaliance (~{RATE_LIMIT_SEC}s/req)...")
    records = []
    isin_direct: dict[str, dict] = {}  # OPCI/SCI : on a l'ISIN dans l'URL
    for i, url in enumerate(urls):
        try:
            rec = parse_scpi_page(sess, url)
        except Exception as e:
            print(f"        ✗ {url} : {e}")
            continue
        if not rec:
            continue
        records.append(rec)

        # Si l'URL contient un ISIN (cas OPCI/SCI), on s'en sert directement
        isin = extract_isin_from_url(url)
        if isin:
            isin_direct[isin] = rec

        if (i + 1) % 20 == 0:
            print(f"        ... {i+1}/{len(urls)} scrapées ({len(records)} parsées)")
        time.sleep(RATE_LIMIT_SEC)

    print(f"        {len(records)} fiches parsées avec succès")
    print(f"        {len(isin_direct)} dont avec ISIN direct (OPCI/SCI)")
    print()

    # 4. Indexer + matcher
    prima_index = build_prima_index(records)

    print("  [3/3] Matching + enrichissement...")
    found = updated = 0
    skipped_no_match = 0
    field_counts = {"p1y": 0, "p5y": 0, "ongoing_charges": 0, "aum_eur": 0, "inception_date": 0, "management_company": 0, "category": 0, "sri": 0, "entry_fee_max": 0}
    now = datetime.now(timezone.utc).isoformat()

    for fund in db_funds:
        isin = fund["isin"]

        # 1) Match direct par ISIN (OPCI/SCI)
        match = isin_direct.get(isin)

        # 2) Match par nom normalisé
        if not match:
            match = find_match(fund.get("name") or "", prima_index)

        if not match:
            skipped_no_match += 1
            continue

        found += 1
        update: dict = {}

        def _take(field: str, val, count_key: str) -> None:
            """Écrit `val` dans `field` : champ métrique + refresh → réécrit si la
            valeur change ; sinon fill-only (seulement si NULL en base)."""
            if val is None:
                return
            if refresh and field in REFRESHABLE:
                if fund.get(field) != val:
                    update[field] = val
                    field_counts[count_key] += 1
            elif fund.get(field) is None:
                update[field] = val
                field_counts[count_key] += 1

        _take("performance_1y", match.get("taux_distribution"), "p1y")
        _take("performance_5y", match.get("tri_5ans"), "p5y")
        # NB : on n'écrit PAS frais_gestion dans ongoing_charges. Les « frais de
        # gestion » SCPI (~8-13 % des loyers) ne sont PAS un TER (% de l'encours) :
        # les mapper sur ongoing_charges affichait un « TER » de 10-18 % trompeur
        # à côté des OPCVM (1-2 %), et violait chk_ongoing_fraction (mauvaise unité).
        _take("aum_eur", match.get("capitalisation_eur"), "aum_eur")

        if match.get("year_created") and not fund.get("inception_date"):
            update["inception_date"] = f"{match['year_created']}-01-01"
            field_counts["inception_date"] += 1

        if match.get("management_company") and not fund.get("management_company"):
            update["management_company"] = match["management_company"]
            field_counts["management_company"] += 1

        if match.get("scpi_category") and not fund.get("category"):
            update["category"] = match["scpi_category"]
            field_counts["category"] += 1

        if match.get("sri") is not None and fund.get("sri") is None:
            update["sri"] = match["sri"]
            field_counts["sri"] += 1

        # Frais de souscription SCPI (commission de souscription, ~8-12 %) →
        # entry_fee_max. Convention DB : FRACTION (5 % = 0.05), comme les OPCVM.
        # C'est LA donnée la plus recherchée par les CGP et quasi vide en base.
        # Fill-only : on ne complète que les trous. Garde-fou de plausibilité
        # (0-15 %) : au-delà, c'est un parse foireux (ex. capté un encours).
        fs = match.get("frais_souscription")
        if fs is not None and fund.get("entry_fee_max") is None and 0 <= fs <= 15:
            update["entry_fee_max"] = round(fs / 100.0, 6)
            field_counts["entry_fee_max"] += 1

        # Métriques SCPI dédiées (table investissement_scpi_metrics) — dont le
        # PRIX DE PART, absent de investissement_funds. Toujours rafraîchi
        # (refresh trimestriel : prix de part / capitalisation bougent chaque T).
        # dvm/tof sont des numeric(6,4) (|v| < 100) : un parse foireux peut donner
        # une valeur ≥ 100 → overflow. On les borne (sinon l'upsert échoue).
        def _pct_ok(v):
            return v is not None and -100 < v < 100
        metrics = {k: v for k, v in {
            "price_per_share": match.get("prix_part"),
            "capitalization":  match.get("capitalisation_eur"),
            "dvm":             match.get("taux_distribution") if _pct_ok(match.get("taux_distribution")) else None,
            "tof":             match.get("tof") if _pct_ok(match.get("tof")) else None,
        }.items() if v is not None}
        if metrics:
            if match.get("prix_part") is not None:
                field_counts["prix_part"] = field_counts.get("prix_part", 0) + 1
            if apply:
                try:
                    client.table("investissement_scpi_metrics").upsert(
                        {"isin": isin, **metrics, "updated_at": now}, on_conflict="isin"
                    ).execute()
                except Exception as e:
                    print(f"        ✗ scpi_metrics {isin} : {e}")

                # Accumulation : 1 point par an dans l'historique (prix de part bouge
                # ~1×/an). on_conflict (isin, year) → met à jour l'année courante,
                # accumule au fil des années. Base d'une future série SCPI.
                if match.get("prix_part") is not None:
                    try:
                        client.table("investissement_scpi_price_history").upsert({
                            "isin": isin,
                            "year": datetime.now(timezone.utc).year,
                            "price_per_share": match.get("prix_part"),
                            "dvm": metrics.get("dvm"),
                            "source": "primaliance",
                            "updated_at": now,
                        }, on_conflict="isin,year").execute()
                    except Exception as e:
                        print(f"        ✗ scpi_price_history {isin} : {e}")

        if not update:
            continue

        updated += 1
        flags = []
        if "performance_1y" in update: flags.append(f"p1y={update['performance_1y']}")
        if "performance_5y" in update: flags.append(f"p5y={update['performance_5y']}")
        if "ongoing_charges" in update: flags.append(f"oc={update['ongoing_charges']}%")
        if "aum_eur" in update: flags.append(f"aum={update['aum_eur']//1_000_000}M€")
        if "inception_date" in update: flags.append(f"inc={update['inception_date'][:4]}")
        if "management_company" in update: flags.append(f"mgmt={update['management_company'][:20]}")
        if "category" in update: flags.append(f"cat={update['category'][:20]}")
        if "sri" in update: flags.append(f"sri={update['sri']}")
        if "entry_fee_max" in update: flags.append(f"entry={update['entry_fee_max']*100:.1f}%")
        print(f"  ✓ {isin:20} | {match['name'][:30]:30} | {' '.join(flags)}")

        if apply:
            try:
                client.table("investissement_funds").update({
                    **update,
                    "updated_at": now,
                }).eq("isin", isin).execute()
            except Exception as e:
                print(f"        ✗ update {isin} échoué : {e}")

    print()
    print("=" * 70)
    print(f"  Résumé :")
    print(f"    - {len(records)} fiches Primaliance parsées")
    print(f"    - {found} SCPIs matchées / {len(db_funds)} en base")
    print(f"    - {skipped_no_match} SCPIs sans match Primaliance")
    print(f"    - {updated} SCPIs effectivement enrichies (champs NULL complétés)")
    print(f"    - Par champ : {field_counts}")
    print("=" * 70)

    if apply:
        log_run(
            "scpi-primaliance-enricher",
            "success" if updated > 0 else "partial",
            records_processed=updated,
            records_failed=len(db_funds) - found,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SCPI Primaliance Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, default=None, help="Limiter le nombre de pages scrapées (debug)")
    parser.add_argument("--refresh", action="store_true",
                        help="Réécrire les métriques (TD/TRI/frais/encours) même si déjà "
                             "remplies — refresh trimestriel. Sans : fill-only.")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, refresh=args.refresh)
