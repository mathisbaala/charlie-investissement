#!/usr/bin/env python3
"""
fonds-euros-enricher.py — Enrichissement performance_3y + taux historiques
==========================================================================
Source PRIMAIRE : goodvalueformoney.eu (GVFM)
  URL : https://www.goodvalueformoney.eu/documentation/tableau-de-suivi-du-rendement-des-fonds-en-euros
  Format : HTML statique (~2.5 Mo), 140 fonds en euros uniques, données 2018-2025
  Structure : "<fund_name> (fonds en euros <type>) Taux servi en YYYY : X,XX %"

Champs enrichis pour nos 50 fonds_euros (FE_*) :
  - performance_3y  : cumul 2022+2023+2024 (cible : période 3 ans glissants)
  - performance_5y  : cumul 2020+2021+2022+2023+2024 (si dispo)

AUM par fonds : aucune source publique gratuite identifiée
  (encours globaux assureurs sont disponibles mais pas par fonds individuel).
  Voir docs/data-sources-fonds-euros.md pour la cartographie complète.

Stratégie de matching :
  Mapping explicite ISIN → GVFM fund_name (lower-cased) car les 50 fonds
  sont nommés différemment chez GVFM et la heuristique de normalisation
  donne trop de faux positifs sur "Actif Général" (présent ~30 fois).

Usage :
    python3 scripts/scrapers/fonds-euros-enricher.py           # dry-run
    python3 scripts/scrapers/fonds-euros-enricher.py --apply   # appliquer
"""

import re
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run, compute_completeness  # noqa: E402

GVFM_URL = "https://www.goodvalueformoney.eu/documentation/tableau-de-suivi-du-rendement-des-fonds-en-euros"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
TIMEOUT = 30


# ─── Mapping explicite ISIN synthétique → GVFM fund_name ──────────────────────
# Clé : ISIN dans investissement_funds (product_type='fonds_euros')
# Valeur : (fund_name_gvfm_lower, fund_type_gvfm) — pour résoudre les ambiguïtés
# fund_name_lower correspond exactement au champ extrait du tableau GVFM
# (les accents sont déjà supprimés par notre parser — "actif g n ral" pas "actif général")
#
# None signifie : aucune correspondance fiable dans GVFM (ex. fonds très récent
# ou destiné à des courtiers spécifiques sans suivi GVFM)
ISIN_TO_GVFM: dict[str, tuple[str, str] | None] = {
    # Grands assureurs — fonds principaux
    "FE_GENERALI":     ("eurossima", "classique"),                # Generali Vie — fonds référence
    "FE_SWISSLIFE":    ("actif g n ral swisslife", "classique"),  # SwissLife Actif Général
    "FE_SWISSLIFE_P":  ("actif g n ral swiss life", "classique"), # variante (premium = mêmes taux servis)
    "FE_SURAVENIR":    ("suravenir opportunit s 2", "dynamique"), # Suravenir Opportunités (dynamique)
    "FE_SURAVENIR_R":  ("suravenir rendement 2", "classique"),    # Suravenir Rendement (classique)
    "FE_SPIRICA":      ("actif g n ral spirica", "classique"),    # Spirica Actif Général
    "FE_ALLIANZ":      ("garanti en euros", "classique"),         # Allianz Actif Garanti — closest match
    "FE_CARDIF":       ("en euro cardif", "classique"),           # BNP Paribas Cardif
    "FE_AXA":          ("actif g n ral axa france", "classique"), # AXA France Vie
    "FE_PREDICA":      ("actif g n ral pr dica", "classique"),    # Predica (CA Vie)
    "FE_PREDICA_GC":   ("actif g n ral pr dica", "classique"),    # variante Garanti Croissance
    "FE_LCL_VIE":      ("actif g n ral pr dica", "classique"),    # LCL distribue Predica
    "FE_CNP":          ("cnp patrimoine euros", "classique"),     # CNP Assurances
    "FE_AVIVA":        ("abeille euro", "classique"),             # Abeille Vie (ex-Aviva)
    "FE_GMF":          ("euro libert", "classique"),              # GMF Vie (Liberté)
    "FE_SOGECAP":      ("s curit euro", "classique"),             # Sogecap Sécurité Euro
    "FE_MAAF":         ("nuances s curit", "classique"),          # MAAF Vie (Nuances)
    "FE_PACIFIC":      ("euros", "classique"),                    # Pacific Vie (générique)

    # Mutuelles
    "FE_MACSF":        ("rp actif garanti", "classique"),         # MACSF (RES Pluriel)
    "FE_AG2R":         ("actif g n ral la mondiale", "classique"),# AG2R La Mondiale
    "FE_MNEF":         ("euro epargne", "classique"),             # Harmonie Mutuelle
    "FE_MIF":          ("monceau euros", "classique"),            # MIF — fonds monceau-like
    "FE_MACIF":        ("agipi en euros", "classique"),           # Macif via Agipi
    "FE_MGEN":         ("euros", "classique"),                    # MGEN (fonds Eparmil) — générique
    "FE_MMA":          ("euro patrimoine", "classique"),          # MMA Vie
    "FE_TUTELARE":     ("euros", "classique"),                    # Tutélaire — générique
    "FE_APICIL":       ("apicil euro garanti", "classique"),
    "FE_FRANCE_MUT":   ("garantie long terme g.l.t.", "classique"),  # France Mutualiste GLT
    "FE_GARANCE":      None,  # Garance — pas dans GVFM (mutuelle transport spécialisée)
    "FE_CARAC":        None,  # CARAC — pas trouvé dans GVFM
    "FE_MNT":          None,  # MNT (fonctions publiques) — pas dans GVFM

    # Plateformes web / courtiers
    "FE_PLACEMENT_D":  ("suravenir rendement 2 en gestion libre", "classique"),  # Placement-Direct via Suravenir
    "FE_BOURSO":       ("eurossima", "classique"),                # Boursorama Vie utilise Generali Eurossima
    "FE_FORTUNEO":     ("suravenir rendement 2 en gestion libre", "classique"),  # Fortuneo via Suravenir
    "FE_ASSURANCEVIE": ("suravenir rendement 2 en gestion libre", "classique"),  # AssuranceVie.com via Suravenir
    "FE_YOMONI":       ("suravenir rendement 2 en gestion libre", "classique"),  # Yomoni via Suravenir
    "FE_NALO":         ("eurossima", "classique"),                # Nalo via Generali Eurossima
    "FE_GOODVEST":     ("actif g n ral swiss life", "classique"), # Goodvest via SwissLife
    "FE_RAMIFY":       ("eurossima", "classique"),                # Ramify via Generali
    "FE_LINXEA":       ("actif g n ral spirica", "classique"),    # Linxea Spirit 2 via Spirica

    # Réseaux bancaires / spécialisés
    "FE_PALATINE":     ("euros", "classique"),                    # Banque Palatine — générique
    "FE_UAF_LIFE":     ("actif g n ral pr dica", "classique"),    # UAF Life (CA filière)
    "FE_PRIMONIAL":    ("s curit pierre euro", "immobilier"),     # Sécurité Pierre Euro immobilier
    "FE_CAPITAL_VIE":  None,  # Capital Vie — pas dans GVFM
    "FE_VAUBAN":       None,  # Vauban Humanis — pas dans GVFM
    "FE_SMAVIE":       None,  # SMAVIE BTP — pas dans GVFM
    "FE_MARCH_VIE":    None,  # March Vie — pas dans GVFM
    "FE_ACTIVA":       None,  # Activa Mutuelle — pas dans GVFM
    "FE_NOVALIS":      None,  # Novalis Taitbout — pas dans GVFM
    "FE_GAN":          ("nuances s curit", "classique"),          # GAN Vie (Nuances Privilège)
}


# ─── Parser GVFM ──────────────────────────────────────────────────────────────

def fetch_gvfm() -> str:
    """Télécharge la page GVFM (HTML ~2.5 Mo)."""
    resp = requests.get(GVFM_URL, timeout=TIMEOUT)
    if resp.status_code != 200:
        raise RuntimeError(f"GVFM HTTP {resp.status_code}")
    return resp.text


def parse_gvfm(html: str) -> dict[str, dict]:
    """
    Parse le HTML GVFM, retourne un dict {fund_name_lower: {fund_type, taux: {year: %}}}.
    140 fonds en euros uniques attendus.
    """
    # Nettoyage HTML → texte brut
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&[#a-z0-9]+;", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    # Markers : "(fonds en euros <type>)" — chaque marker = un fonds dans un contrat
    markers = list(re.finditer(r"\(fonds en euros\s+([a-zà-ÿ\-]+)\)", text))

    records = []
    for i, m in enumerate(markers):
        fund_type = m.group(1)
        before_start = markers[i-1].end() if i > 0 else max(0, m.start() - 500)
        before = text[before_start:m.start()].strip()

        # Le fund_name est le dernier "Fonds <name>" ou la dernière séquence capitalisée
        name_match = re.search(
            r"(?:Fonds\s+)([A-ZÀ-ÿa-zà-ÿ0-9 \-\'\.,&]+?)\s*$", before
        )
        if not name_match:
            name_match = re.search(
                r"([A-ZÀ-ÿ][A-Za-zÀ-ÿ0-9 \-\'\.,&]{3,80}?)\s*$", before
            )
        if not name_match:
            continue
        fund_name = name_match.group(1).strip()
        if not fund_name or fund_name in ("?", "Fonds"):
            continue

        # Taux après le marker (jusqu'au prochain marker)
        after_end = markers[i+1].start() if i+1 < len(markers) else min(len(text), m.end() + 2000)
        after = text[m.end():after_end]

        # Pattern : "Taux servi en YYYY : X,XX %"
        # Exclure les valeurs ambiguës ("X,XX % 3,45 %" → cas "gestion libre X / mandat Y")
        taux_raw = re.findall(r"Taux\s+servi\s+en\s+(\d{4})\s*:\s*([\d,\s]+?\d)\s*%", after)
        taux = {}
        for year, val in taux_raw:
            v_clean = val.replace(",", ".").strip()
            # Si plusieurs nombres collés (ambigu), on skip
            if re.search(r"\s\d", v_clean):
                continue
            try:
                v_float = float(v_clean.replace(" ", ""))
                if 0 <= v_float < 10:  # sanity check : fonds euros 2018-2025 entre 0% et 10%
                    taux[year] = v_float
            except ValueError:
                continue

        records.append({
            "fund_name": fund_name,
            "fund_name_lower": fund_name.lower(),
            "fund_type": fund_type,
            "taux": taux,
        })

    # Dedupe : pour chaque fund_name_lower, garder le record avec le plus d'années
    unique: dict[str, dict] = {}
    for r in records:
        key = r["fund_name_lower"]
        existing = unique.get(key)
        if not existing or len(r["taux"]) > len(existing["taux"]):
            unique[key] = r

    return unique


# ─── Calculs ──────────────────────────────────────────────────────────────────

def compound(rates_pct: list[float]) -> float:
    """Cumul composé : [2.0, 3.0, 2.5] → ((1.02)*(1.03)*(1.025)-1)*100"""
    result = 1.0
    for r in rates_pct:
        result *= (1 + r / 100)
    return round((result - 1) * 100, 2)


def _window_ending_latest(taux: dict[str, float], latest: int, n: int) -> float | None:
    """Cumul composé des n années CONSÉCUTIVES finissant à `latest`
    (ex. n=3, latest=2025 → 2023+2024+2025). None si une année manque."""
    years = [str(latest - k) for k in range(n - 1, -1, -1)]
    vals = [taux.get(y) for y in years]
    if all(v is not None for v in vals):
        return compound([v for v in vals])  # type: ignore[arg-type]
    return None


def compute_perfs(taux: dict[str, float]) -> tuple[float | None, float | None, float | None]:
    """
    Calcule (p1y, p3y, p5y) en années DYNAMIQUES : la fenêtre finit toujours sur
    la dernière année pleine publiée par GVFM (pas une année figée dans le code).
    En 2026, GVFM publie les taux 2025 → p1y=2025, p3y=cumul 2023-2025,
    p5y=cumul 2021-2025. Les fonds euros raisonnent en années pleines (taux servi
    annuel), donc « 1y » = dernière année servie. None si la fenêtre est trouée.
    """
    if not taux:
        return None, None, None
    latest = max(int(y) for y in taux.keys())
    p1y = taux.get(str(latest))
    p3y = _window_ending_latest(taux, latest, 3)
    p5y = _window_ending_latest(taux, latest, 5)
    return p1y, p3y, p5y


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, refresh: bool = False):
    print("=" * 70)
    print("  Fonds Euros Enricher — GVFM (taux servis → perf 1y/3y/5y)")
    print("=" * 70)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}"
          + ("  [REFRESH : écrase les perf existantes]" if refresh
             else "  [fill-only : ne remplit que les trous]"))
    print()

    started = datetime.now(timezone.utc)

    # 1. Télécharger + parser GVFM
    print("  [1/3] Téléchargement goodvalueformoney.eu...")
    try:
        html = fetch_gvfm()
    except Exception as e:
        print(f"  ✗ GVFM inaccessible : {e}")
        return
    print(f"        {len(html):,} octets reçus")

    print("  [2/3] Parsing du tableau GVFM...")
    gvfm = parse_gvfm(html)
    print(f"        {len(gvfm)} fonds en euros uniques extraits")
    print()

    # 2. Charger nos 50 fonds_euros (avec tous les champs nécessaires au calcul de completeness)
    client = get_client()
    db_funds = (
        client.table("investissement_funds")
        .select(
            "isin, name, ter, ongoing_charges, sri, srri, "
            "performance_1y, performance_3y, performance_5y, "
            "sfdr_article, aum_eur, kid_parsed_at, management_company"
        )
        .eq("product_type", "fonds_euros")
        .execute()
        .data
    ) or []
    print(f"  [3/3] {len(db_funds)} fonds_euros chargés depuis Supabase")
    print()

    # 3. Matcher + enrichir
    now = datetime.now(timezone.utc).isoformat()
    matched = updated = no_mapping = no_match = 0
    skipped_existing = 0

    def _take(field: str, val, fund) -> bool:
        """Décide si on écrit `val` dans `field` : refresh → toujours (si val
        change) ; fill-only → seulement si le champ est NULL en base."""
        if val is None:
            return False
        if refresh:
            return fund.get(field) != val
        return fund.get(field) is None

    print(f"  {'ISIN':18} | {'Name':32} | {'GVFM match':30} | p1y   | p3y    | p5y")
    print("  " + "─" * 118)

    for fund in db_funds:
        isin = fund["isin"]
        mapping = ISIN_TO_GVFM.get(isin)

        if mapping is None:
            if isin in ISIN_TO_GVFM:
                no_mapping += 1
                print(f"  {isin:18} | {fund['name'][:32]:32} | (no GVFM mapping)")
            else:
                no_mapping += 1
                print(f"  {isin:18} | {fund['name'][:32]:32} | (ISIN absent du mapping)")
            continue

        gvfm_key, gvfm_type = mapping
        gvfm_rec = gvfm.get(gvfm_key)

        if not gvfm_rec:
            no_match += 1
            print(f"  {isin:18} | {fund['name'][:32]:32} | NOT FOUND: {gvfm_key[:25]}")
            continue

        matched += 1
        p1y, p3y, p5y = compute_perfs(gvfm_rec["taux"])

        update: dict = {}
        for field, val in (("performance_1y", p1y), ("performance_3y", p3y),
                           ("performance_5y", p5y)):
            if _take(field, val, fund):
                update[field] = val
            elif val is not None and not refresh and fund.get(field) is not None:
                skipped_existing += 1
        if update:
            updated += 1

        match_label = f"{gvfm_key[:28]}({gvfm_rec['fund_type'][:3]})"
        p1y_str = f"{p1y:5.2f}%" if p1y is not None else "  —  "
        p3y_str = f"{p3y:5.2f}%" if p3y is not None else "  —  "
        p5y_str = f"{p5y:5.2f}%" if p5y is not None else "  —  "
        marker = "✓" if update else "·"
        print(f"  {marker} {isin:16} | {fund['name'][:32]:32} | {match_label:30} | {p1y_str} | {p3y_str} | {p5y_str}")

        if apply and update:
            # Recompute completeness with new fields
            merged = {**fund, **update}
            update["data_completeness"] = compute_completeness(merged)
            update["updated_at"] = now
            try:
                client.table("investissement_funds") \
                    .update(update) \
                    .eq("isin", isin) \
                    .execute()
            except Exception as e:
                print(f"    ✗ update failed: {e}")

    print()
    print(f"  ─── Résumé ─────────────────────────────────────────────")
    print(f"  Fonds DB                  : {len(db_funds)}")
    print(f"  Mapping vers GVFM         : {len(db_funds) - no_mapping}")
    print(f"  Sans mapping (no GVFM)    : {no_mapping}")
    print(f"  Mapping mais pas trouvé   : {no_match}")
    print(f"  Matchés et données OK     : {matched}")
    print(f"  → fonds mis à jour        : {updated}")
    if not refresh:
        print(f"  Déjà rempli (skip)        : {skipped_existing}")
    print()

    if apply:
        log_run(
            "fonds-euros-enricher",
            "success" if matched > 0 else "partial",
            records_processed=updated,
            records_failed=no_match + no_mapping,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Enrichit perf 1y/3y/5y des fonds en euros depuis GVFM")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase (sinon dry-run)")
    parser.add_argument("--refresh", action="store_true",
                        help="Écraser les perf existantes (refresh annuel). Sans ce flag : "
                             "fill-only (ne remplit que les champs NULL).")
    args = parser.parse_args()
    run(apply=args.apply, refresh=args.refresh)
