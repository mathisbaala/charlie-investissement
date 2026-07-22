#!/usr/bin/env python3
"""
sfdr-annex-enricher.py — Durabilité MiFID/DDA depuis l'ANNEXE précontractuelle SFDR
====================================================================================
Distinct de sfdr-enricher.py (qui ne lit que le KID → cul-de-sac : les 3 champs
DDA vivent dans l'annexe SFDR séparée, template RTS Annexe II art.8 / Annexe III
art.9). Ce script va chercher CETTE annexe et en extrait :

    - sustainable_investment_pct  (part minimale d'investissements durables, art.2(17))
    - taxonomy_alignment_pct      (part minimale alignée sur la taxinomie UE)
    - pai_considered              (prise en compte des PAI — booléen)

Source : la plupart des `kid_url` pointent vers
    doc.morningstar.com/LatestDoc.aspx?...&investmentid=F00000...&documenttype=299...
En swappant `documenttype=398`, la MÊME URL sert l'annexe précontractuelle SFDR
(399 = rapport périodique). C'est un téléchargement de DOCUMENT STATIQUE — ce n'est
PAS l'API Morningstar sal-service/ecint (interdite, throttle). Repli FR possible :
registre EPR PRIIPs (epr.amfinesoft.com), non câblé ici (Morningstar suffit au PoC).

Univers cible : fonds Art. 8/9 UNIQUEMENT (les Art. 6 n'ont pas d'annexe).

RÈGLES :
  - FILL-ONLY STRICT : on n'écrit jamais sur une valeur existante non-nulle
    (update_funds_bulk + on ne met dans la row que les champs trouvés et NULL en base).
  - sustainability_source = 'sfdr-annex' (ou 'sfdr-annex-none' si annexe vue mais
    rien d'extrait), sustainability_computed_at = now() sur TOUT fonds traité (annexe
    absente / illisible comprise) → on ne le re-télécharge pas au prochain run.
  - Aucun upsert destructif, jamais de toucher à sfdr_article. Pas de commit/push.

Le parsing s'appuie sur les ANCRES fixes du template RTS (« la part minimale
d'investissements durables … s'élève à X% », « … taxinomie … s'élève à X% », encart
« Ce produit financier prend-il en considération les principales incidences
négatives … ? Oui/Non »), bien plus fiable qu'une recherche de % au plus proche.

Usage :
    # PoC : affiche les valeurs extraites + URL, n'écrit RIEN
    python3 scripts/enrichers/sfdr-annex-enricher.py --poc [--limit 8]

    # Montée en charge fill-only
    python3 scripts/enrichers/sfdr-annex-enricher.py --apply [--limit N] [--isin ISIN]
"""

import re
import io
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, update_funds_bulk, log_run, reset_client, now_iso

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CharlieBot/1.0)"}
TIMEOUT = 30
SLEEP_BETWEEN = 0.4  # politesse : PDF statiques mais on espace quand même

# ─── Résolution de l'URL d'annexe ────────────────────────────────────────────

_MS_HOST = "doc.morningstar.com"


def annex_url(kid_url: str) -> str | None:
    """Dérive l'URL de l'annexe précontractuelle SFDR depuis un kid_url Morningstar.

    Swap documenttype=299 (KID) → 398 (annexe précontractuelle SFDR).
    Renvoie None si l'URL n'est pas un LatestDoc Morningstar exploitable.
    """
    if not kid_url or _MS_HOST not in kid_url:
        return None
    if "documenttype=" not in kid_url:
        return None
    # Ne dérive que depuis le KID (299) — les autres types ne sont pas un KID.
    if "documenttype=299" not in kid_url:
        return None
    return kid_url.replace("documenttype=299", "documenttype=398")


# ─── Téléchargement + extraction texte ───────────────────────────────────────

def download_pdf(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        if r.status_code != 200 or not r.content:
            return None
        if not r.content[:5].startswith(b"%PDF"):
            return None
        return r.content
    except Exception:
        return None


def extract_text(pdf_bytes: bytes) -> str | None:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = []
            for page in pdf.pages:
                t = page.extract_text(x_tolerance=2, y_tolerance=2)
                if t:
                    pages.append(t)
            return "\n".join(pages) if pages else None
    except Exception:
        return None


# ─── Parsing annexe SFDR (ancres du template RTS) ────────────────────────────

# Les annexes sont sur 2 colonnes : l'extraction texte interleave les colonnes,
# donc on aplatit les espaces et on s'appuie sur des tournures STABLES du template
# plutôt que sur la proximité d'un % quelconque. Tolère « taxonomie »/« taxinomie ».

_NUM = r"(\d{1,3}(?:[.,]\d+)?)\s*%"


def _first_pct(text: str, patterns: list[str]) -> float | None:
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                v = float(m.group(1).replace(",", "."))
            except (ValueError, IndexError):
                continue
            if 0 <= v <= 100:
                return round(v, 2)
    return None


def parse_annex(text: str) -> dict:
    """Extrait {sustainable_investment_pct, taxonomy_alignment_pct, pai_considered}
    depuis le texte d'une annexe précontractuelle SFDR. Champs absents = non présents."""
    out: dict = {}
    # Aplatit les blancs (les colonnes s'entrelacent sur plusieurs lignes).
    flat = re.sub(r"\s+", " ", text.lower())

    # ── % investissement durable (SFDR art. 2(17)) ──
    si = _first_pct(flat, [
        r"part\s+minimale\s+d['’]investissements?\s+durables?[^%]{0,140}?s['’]?[ée]l[èe]ve\s+à\s*" + _NUM,
        r"investissements?\s+durables?\s+au\s+sens\s+de\s+l['’]article\s*2\s*\(?17\)?[^%]{0,140}?" + _NUM,
        r"proportion\s+minimale\s+de\s*" + _NUM + r"\s*d['’]investissements?\s+durables?",
        r"part\s+minimale\s+d['’]investissements?\s+durables?[^%]{0,60}?" + _NUM,
    ])
    if si is not None:
        out["sustainable_investment_pct"] = si

    # ── % aligné taxonomie UE ──
    # On n'accepte QUE des tournures où le % est l'engagement d'alignement, jamais
    # un % « au plus proche » (les annexes truffent les légendes de graphes de %
    # parasites : « ce graphique représente 89,5 % », « au moins 90 % d'autres
    # investissements… »). Toutes les ancres ci-dessous lient explicitement le
    # nombre à un engagement minimal d'alignement taxonomie.
    taxo = _first_pct(flat, [
        r"tax[io]nomie\s+de\s+l['’]union\s+europ[ée]enne\s+s['’]?[ée]l[èe]ve\s+à\s*" + _NUM,
        r"align[ée]s?\s+sur\s+la\s+tax[io]nomie[^.%]{0,80}?s['’]?[ée]l[èe]ve\s+à\s*" + _NUM,
        r"pourcentage\s+minim(?:um|al)\s+de\s*" + _NUM + r"[^.%]{0,60}?align[ée]s?\s+sur\s+la\s+tax[io]nomie",
        r"au\s+moins\s*" + _NUM + r"\s+de\s+la\s+valeur\s+(?:liquidative|nette)[^.%]{0,80}?align[ée]s?\s+sur\s+la\s+tax[io]nomie",
        r"(?:soit\s+)?align[ée]e?\s+sur\s+la\s+tax[io]nomie\s+de\s+l['’](?:ue|union)[^.%]{0,10}?\.?\s*(?:au\s+moins\s+)?" + _NUM,
    ])
    if taxo is not None:
        out["taxonomy_alignment_pct"] = taxo

    # ── PAI (principales incidences négatives) — booléen ──
    # Encart standard : « Ce produit financier prend-il en considération les
    # principales incidences négatives … ? Oui / Non ».
    m_box = re.search(
        r"prend-il\s+en\s+(?:consid[ée]ration|compte)\s+les\s+principales\s+incidences\s+n[ée]gatives"
        r"[^?]{0,60}?\?\s*(oui|non)", flat)
    if m_box:
        out["pai_considered"] = (m_box.group(1) == "oui")
    elif re.search(r"ne\s+prend\s+pas\s+en\s+(?:compte|consid[ée]ration)[^.]{0,80}incidences\s+n[ée]gatives", flat):
        out["pai_considered"] = False
    elif re.search(
            r"prend\s+en\s+(?:compte|consid[ée]ration)[^.]{0,90}principales\s+incidences\s+n[ée]gatives", flat) or \
            re.search(r"principales\s+incidences\s+n[ée]gatives[^.]{0,90}sont\s+pris(?:es)?\s+en\s+compte", flat):
        out["pai_considered"] = True

    return out


# ─── Politique d'exclusion (tags normalisés « excl-* » dans labels) ──────────
# Le template RTS décrit les « éléments contraignants de la stratégie
# d'investissement » : c'est là que vivent les exclusions sectorielles. On ne
# tague un thème que si un mot-clé du thème apparaît PRÈS d'un marqueur
# d'exclusion (exclut / interdit / écarte / liste noire / zéro tolérance…) —
# jamais sur simple mention : les tableaux PAI citent « combustibles fossiles »
# comme indicateur d'exposition, sans exclusion. Les tags alimentent le mode
# strict du moteur d'allocation (exclusions éthiques du profil client) et sont
# PRÉSERVÉS par populate-screener-labels (cf. PRESERVED_LABELS).

_EXCL_MARKER = re.compile(
    r"exclu\w*|interdit\w*|[ée]cart[ée]\w*|banni\w*|liste\s+noire|black[- ]?list"
    r"|ne\s+(?:peut|peuvent|doit|doivent)\s+pas\s+(?:être\s+)?invest"
    r"|n['’]invest\w*\s+pas|aucune?\s+(?:exposition|investissement|position)"
    r"|z[ée]ro\s+tol[ée]rance|s['’]interdit|restrictions?\s+sectorielle",
    re.IGNORECASE)

_EXCL_THEMES = {
    "excl-fossiles": re.compile(
        r"combustibles?\s+fossiles?|[ée]nergies?\s+fossiles?|charbon|p[ée]trole"
        r"|gaz\s+(?:naturel|de\s+schiste)|hydrocarbures|sables?\s+bitumineux"
        r"|fossil\s+fuels?|thermal\s+coal|\boil\b", re.IGNORECASE),
    "excl-tabac": re.compile(r"tabac|tobacco", re.IGNORECASE),
    "excl-armes": re.compile(r"\barmes?\b|armement|weapons?", re.IGNORECASE),
    "excl-jeux": re.compile(
        r"jeux\s+d['’]argent|jeux\s+de\s+hasard|gambling|paris\s+sportifs|casinos?",
        re.IGNORECASE),
    "excl-alcool": re.compile(
        r"alcool|alcohol|spiritueux|boissons?\s+alcoolis", re.IGNORECASE),
}

_EXCL_WINDOW = 260  # caractères de contexte autour du mot-clé thème


def parse_exclusions(text: str) -> list[str]:
    """Tags « excl-* » déclarés par l'annexe (liste triée, vide si rien)."""
    flat = re.sub(r"\s+", " ", text.lower())
    tags: list[str] = []
    for tag, theme_re in _EXCL_THEMES.items():
        for m in theme_re.finditer(flat):
            lo = max(0, m.start() - _EXCL_WINDOW)
            win = flat[lo:m.end() + _EXCL_WINDOW]
            if not _EXCL_MARKER.search(win):
                continue
            # Armes : l'exclusion des seules armes CONTROVERSÉES (obligatoire en
            # droit français) ne vaut PAS exclusion de l'armement — on ignore les
            # occurrences dont le voisinage immédiat dit « controversées ».
            if tag == "excl-armes":
                around = flat[max(0, m.start() - 60):m.end() + 60]
                if re.search(r"controvers|non\s+conventionnelles|prohib[ée]es\s+par", around):
                    continue
            tags.append(tag)
            break
    return sorted(tags)


def merged_labels(existing: list | None, new_tags: list[str]) -> list[str] | None:
    """labels fusionnés (existants ∪ nouveaux tags), ou None si rien à écrire.
    Additif STRICT : ne retire jamais un label existant."""
    if not new_tags:
        return None
    cur = [str(x) for x in (existing or [])]
    merged = sorted(set(cur) | set(new_tags))
    return merged if merged != sorted(cur) else None


def _sane(parsed: dict) -> dict:
    """Garde-fous de plausibilité. Taxo > SI est suspect (la part taxo est un
    sous-ensemble de l'inv. durable) → on jette la taxo dans ce cas plutôt que
    d'écrire une valeur douteuse. % hors 0-100 déjà filtrés en amont."""
    si = parsed.get("sustainable_investment_pct")
    taxo = parsed.get("taxonomy_alignment_pct")
    if si is not None and taxo is not None and taxo > si + 0.01:
        parsed.pop("taxonomy_alignment_pct", None)
    return parsed


# ─── Chargement des cibles ───────────────────────────────────────────────────

def referenced_isins(client) -> set[str]:
    """ISIN référencés dans au moins un contrat (MV assureurs) — permet de
    prioriser le drain sur les fonds que le moteur d'allocation peut réellement
    servir aux CGP, avant la longue traîne jamais référencée."""
    out: set[str] = set()
    offset, page = 0, 1000
    while True:
        chunk = client.table("investissement_fund_insurers_mv").select("isin") \
            .not_.is_("contracts", "null") \
            .order("isin").range(offset, offset + page - 1).execute().data or []
        out.update(r["isin"] for r in chunk)
        if len(chunk) < page:
            break
        offset += page
    return out


def load_targets(client, isin_filter: str | None, redo: bool = False) -> list[dict]:
    """Fonds Art.8/9 avec kid_url Morningstar, non encore traités par CE source.

    On re-traite tant que sustainability_source n'est pas un marqueur 'sfdr-annex*'
    (donc on peut compléter des fonds que sfdr-enricher.py 'kid' avait marqués sans
    rien trouver, sans jamais écraser une valeur non-nulle existante)."""
    sel = ("isin, name, kid_url, sfdr_article, sustainable_investment_pct, "
           "taxonomy_alignment_pct, pai_considered, sustainability_source, labels")
    if isin_filter:
        return client.table("investissement_funds").select(sel) \
            .eq("isin", isin_filter).execute().data or []

    funds: list[dict] = []
    offset, page = 0, 1000
    while True:
        chunk = client.table("investissement_funds").select(sel) \
            .in_("sfdr_article", [8, 9]) \
            .ilike("kid_url", "%doc.morningstar.com%") \
            .ilike("kid_url", "%documenttype=299%") \
            .order("isin").range(offset, offset + page - 1).execute().data or []
        funds.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    # Skip ceux déjà traités par cette source (idempotence des runs) — sauf en
    # --redo (utile pour repasser l'extraction des politiques d'exclusion sur
    # des fonds traités avant qu'elle n'existe). En redo on ne re-lit que ceux
    # SANS tag excl-* (ne re-télécharge pas ce qui est déjà taggé).
    if redo:
        funds = [f for f in funds
                 if not any(str(l).startswith("excl-") for l in (f.get("labels") or []))]
    else:
        funds = [f for f in funds
                 if not str(f.get("sustainability_source") or "").startswith("sfdr-annex")]
    return funds


def _fill_only(fund: dict, parsed: dict) -> dict:
    """Ne garde que les champs trouvés ET NULL en base (fill-only strict)."""
    keep = {}
    for col in ("sustainable_investment_pct", "taxonomy_alignment_pct", "pai_considered"):
        if col in parsed and fund.get(col) is None:
            keep[col] = parsed[col]
    return keep


# ─── PoC ──────────────────────────────────────────────────────────────────────

def run_poc(limit: int, redo: bool = False) -> None:
    print("=" * 70)
    print("  SFDR-ANNEX enricher — PoC (AUCUNE écriture)")
    print("=" * 70)
    client = get_client()
    funds = load_targets(client, None, redo=redo)[: max(limit * 4, limit)]
    print(f"  {len(funds)} candidats chargés, cible {limit} annexes lues\n")

    seen = good = 0
    for f in funds:
        if seen >= limit:
            break
        url = annex_url(f["kid_url"])
        if not url:
            continue
        pdf = download_pdf(url)
        time.sleep(SLEEP_BETWEEN)
        if not pdf:
            print(f"  [{f['isin']}] art{f['sfdr_article']}  annexe 398 absente/non-PDF")
            continue
        text = extract_text(pdf)
        if not text:
            print(f"  [{f['isin']}] art{f['sfdr_article']}  PDF illisible")
            seen += 1
            continue
        parsed = _sane(parse_annex(text))
        excl = parse_exclusions(text)
        seen += 1
        n = len(parsed)
        if n or excl:
            good += 1
        print(f"  [{f['isin']}] art{f['sfdr_article']}  "
              f"SI={parsed.get('sustainable_investment_pct')!s:>6}  "
              f"TAXO={parsed.get('taxonomy_alignment_pct')!s:>6}  "
              f"PAI={parsed.get('pai_considered')!s:>5}  ({n}/3 champs)  "
              f"EXCL={','.join(t.removeprefix('excl-') for t in excl) or '-'}")
        print(f"        {url}")

    print(f"\n  PoC : {seen} annexes lues, {good} avec ≥1 champ extrait")
    if seen:
        print(f"  Taux d'extraction : {good}/{seen} = {100*good//seen}%")
    print("  (vérifier manuellement la plausibilité ci-dessus avant --apply)")


# ─── Run plein (fill-only) ───────────────────────────────────────────────────

def run_apply(limit: int | None, isin_filter: str | None, redo: bool = False,
              referenced_only: bool = False) -> None:
    print("=" * 70)
    print("  SFDR-ANNEX enricher — APPLY (fill-only strict)")
    print("=" * 70)
    started = datetime.now(timezone.utc)
    client = get_client()
    funds = load_targets(client, isin_filter, redo=redo)
    if referenced_only:
        refs = referenced_isins(client)
        before = len(funds)
        funds = [f for f in funds if f["isin"] in refs]
        print(f"  --referenced-only : {len(funds)} fonds référencés (sur {before})")
    if limit:
        funds = funds[:limit]
    print(f"  {len(funds)} fonds Art.8/9 à traiter\n")

    updates: list[dict] = []
    seen_annex = found = 0
    col_count = {"sustainable_investment_pct": 0, "taxonomy_alignment_pct": 0,
                 "pai_considered": 0, "exclusion_tags": 0}

    for i, f in enumerate(funds, 1):
        if i % 500 == 0:
            client = reset_client()
            print(f"  [{i}/{len(funds)}] annexes:{seen_annex} enrichis:{found}")

        url = annex_url(f["kid_url"])
        marker = "sfdr-annex-none"
        keep: dict = {}

        labels_update: list[str] | None = None
        if url:
            pdf = download_pdf(url)
            time.sleep(SLEEP_BETWEEN)
            if pdf:
                text = extract_text(pdf)
                if text:
                    seen_annex += 1
                    parsed = _sane(parse_annex(text))
                    keep = _fill_only(f, parsed)
                    # Politique d'exclusion → tags excl-* fusionnés dans labels
                    # (additif : ne retire jamais un label existant).
                    labels_update = merged_labels(f.get("labels"), parse_exclusions(text))
                    if labels_update is not None:
                        col_count["exclusion_tags"] += 1
                    if keep or labels_update is not None:
                        marker = "sfdr-annex"
                        found += 1
                        for k in keep:
                            col_count[k] += 1

        # Marquer TOUT fonds traité (même annexe absente) pour ne pas le re-tirer.
        row = {
            "isin": f["isin"],
            "sustainability_source": marker,
            "sustainability_computed_at": now_iso(),
            **keep,
        }
        if labels_update is not None:
            row["labels"] = labels_update
        updates.append(row)

    print(f"\n  → {seen_annex} annexes lues, {found} fonds enrichis (≥1 champ)")
    print(f"     SI:{col_count['sustainable_investment_pct']}  "
          f"TAXO:{col_count['taxonomy_alignment_pct']}  "
          f"PAI:{col_count['pai_considered']}  "
          f"EXCL:{col_count['exclusion_tags']}")

    if updates:
        print(f"  Écriture fill-only ({len(updates)} fonds)…", end=" ", flush=True)
        ok, fail = update_funds_bulk(updates, batch_size=200)
        print(f"✓ {ok} OK, {fail} échec")
        log_run(scraper="sfdr-annex-enricher", status="success",
                records_processed=ok, records_failed=fail, started_at=started)


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Durabilité DDA depuis l'annexe SFDR (fill-only)")
    p.add_argument("--poc", action="store_true", help="PoC : affiche, n'écrit rien")
    p.add_argument("--apply", action="store_true", help="Écrire (fill-only) dans Supabase")
    p.add_argument("--limit", type=int, help="Limiter à N fonds")
    p.add_argument("--isin", type=str, help="Un seul ISIN")
    p.add_argument("--referenced-only", action="store_true",
                   help="Ne traiter que les fonds référencés dans au moins un contrat")
    p.add_argument("--redo", action="store_true",
                   help="Repasser les fonds déjà traités mais sans tag excl-* (politiques d'exclusion)")
    args = p.parse_args()

    if args.poc:
        run_poc(limit=args.limit or 8, redo=args.redo)
    elif args.apply:
        run_apply(limit=args.limit, isin_filter=args.isin, redo=args.redo,
                  referenced_only=args.referenced_only)
    else:
        p.error("Préciser --poc ou --apply")
