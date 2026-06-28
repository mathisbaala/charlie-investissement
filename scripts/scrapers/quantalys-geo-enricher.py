#!/usr/bin/env python3
"""
quantalys-geo-enricher.py — Ventilation géographique OPCVM via Quantalys (FILL-ONLY)
=====================================================================================
Cible : OPCVM FRANÇAIS (ISIN FR…) SANS ventilation géo en base — le profil que
Morningstar ne référence pas (no_sec_id) et qui n'a pas de KID retail.

Source : endpoint AJAX non documenté de Quantalys
    POST /Fonds/GetCompoTableAndGraph  {ID_Produit, typeCompo}
    → JSON {graph:{dataProvider:[{x:date, "<bucket>":poids, ...}]}, errorMessage}

Le catalogue ISIN→ID_Produit vient de GET /Recherche/Produits (~62 000 fonds).

typeCompo :
    1  = Geo (actions)         — buckets "Act. <géo>"
    10 = GeoOblig (obligations)— buckets "Obl. <géo>"
    7  = Decompo (diversifiés) — buckets "Act./Obl. <géo>" + "Monétaire"

La répartition est une analyse de style (returns/holdings based) à granularité
pays + zones régionales (mêmes zones que Morningstar : NA, EU, JP, EM, ASD…).
On agrège par géographie, on rejette tout ce qui ne somme pas ~100 %, on
renormalise à 100, puis on écrit dans investissement_fund_geos (source='quantalys').

GARDES QUALITÉ
    - Σ des poids ∈ [85, 115] % sinon REJET (double-comptage / vide).
    - FILL-ONLY strict : on n'écrit que pour les ISIN SANS ligne géo existante,
      re-vérifié juste avant insertion.
    - Pas de placeholder : un fonds sans données Quantalys est simplement ignoré.

Usage :
    python3 scripts/scrapers/quantalys-geo-enricher.py [--apply] [--limit N]
    python3 scripts/scrapers/quantalys-geo-enricher.py --limit 20          (dry-run PoC)
    python3 scripts/scrapers/quantalys-geo-enricher.py --apply --limit 400 (run borné)
"""

import re
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT_SEC = 1.2        # délai entre chaque fonds (anti-ban)
TIMEOUT_SEC    = 25
HOME_URL       = "https://www.quantalys.com/"
CATALOG_URL    = "https://www.quantalys.com/Recherche/Produits"
COMPO_URL      = "https://www.quantalys.com/Fonds/GetCompoTableAndGraph"

# typeCompo à tenter selon la classe d'actif (premier non-vide retenu)
TC_BY_CLASS = {
    "action":     [1, 7],
    "obligation": [10, 7],
    "diversifie": [7, 1, 10],
    "alternatif": [7, 1],
    "immobilier": [7, 1],
}
TC_DEFAULT = [1, 10, 7]

SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ", "fcp dédié", "fcpr ", "fpci ")


# ─── Mapping label Quantalys → (country_code, country_label) ───────────────────
# On suit la convention déjà présente en base (Morningstar) : pays ISO pour les
# pays, codes régionaux (NA/EU/JP/EM/ASD/ASE/LA/EE/WD) pour les zones.

GEO_MAP: dict[str, tuple[str | None, str]] = {
    # — Pays développés (ISO-2) —
    "France":       ("FR", "France"),
    "Allemagne":    ("DE", "Germany"),
    "Italie":       ("IT", "Italy"),
    "Espagne":      ("ES", "Spain"),
    "Pays-Bas":     ("NL", "Netherlands"),
    "Belgique":     ("BE", "Belgium"),
    "Autriche":     ("AT", "Austria"),
    "Portugal":     ("PT", "Portugal"),
    "Irlande":      ("IE", "Ireland"),
    "Finlande":     ("FI", "Finland"),
    "Grèce":        ("GR", "Greece"),
    "Suisse":       ("CH", "Switzerland"),
    "Royaume-Uni":  ("GB", "United Kingdom"),
    "Suède":        ("SE", "Sweden"),
    "Danemark":     ("DK", "Denmark"),
    "Norvège":      ("NO", "Norway"),
    "Japon":        ("JP", "Japan"),
    "États-Unis":   ("US", "United States"),
    "Etats-Unis":   ("US", "United States"),
    "US":           ("NA", "North America"),       # libellé Obl. US = Amérique du Nord
    "Canada":       ("CA", "Canada"),
    # — Zones régionales (codes Morningstar déjà en base) —
    "Amérique du Nord": ("NA",  "North America"),
    "Europe":           ("EU",  "Europe Developed"),
    "Europe du Nord":   ("EU",  "Europe Developed"),
    "Zone Euro":        ("EMU", "Eurozone"),
    "Marchés Emerg.":   ("EM",  "Emerging Markets"),
    "Pacif. ex Japon":  ("ASD", "Developed Asia"),
    "Asie":             ("ASD", "Developed Asia"),
    "Emerg. Asie":      ("ASE", "Emerging Asia"),
    "Am. Latine":       ("LA",  "Latin America"),
    "Emerg. Europe":    ("EE",  "Emerging Europe"),
    "Monde ex Europe":  ("WD",  "World ex-Europe"),
    "Monde":            ("WD",  "World"),
    "Sterling":         ("GB",  "United Kingdom"),  # Obl. Sterling
}

# "Monétaire" = liquidités, pas une géographie → bucket cash dédié.
CASH_LABEL = "Monétaire"
CASH_GEO   = ("CASH", "Cash")


def map_label(raw: str) -> tuple[str | None, str] | None:
    """'Act. Amérique du Nord' / 'Obl. Japon' / 'Monétaire' → (code, label) ou None."""
    raw = raw.strip()
    if raw == CASH_LABEL:
        return CASH_GEO
    # retirer le préfixe classe d'actif
    geo = re.sub(r"^(Act|Obl)\.\s*", "", raw).strip()
    return GEO_MAP.get(geo)


# ─── Session / catalogue ──────────────────────────────────────────────────────

def init_session() -> FetcherSession:
    sess = FetcherSession(impersonate="chrome").__enter__()
    page = sess.get(HOME_URL, stealthy_headers=True, timeout=TIMEOUT_SEC)
    body = page.body.decode("utf-8", "ignore") if page.body else ""
    m = re.search(r"location\.href='(/[^']+)'", body)
    if m:
        sess.get(f"https://www.quantalys.com{m.group(1)}", stealthy_headers=True, timeout=TIMEOUT_SEC)
    return sess


def fetch_catalog(sess: FetcherSession) -> dict[str, int]:
    def _get() -> bytes:
        p = sess.get(
            CATALOG_URL,
            headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"},
            timeout=60,
        )
        if p.status != 200 or not p.body:
            raise RuntimeError(f"Catalogue Quantalys : HTTP {p.status}")
        return p.body

    body = _get()
    raw = body.decode("utf-8", "ignore")
    if raw.strip().startswith("<"):                       # challenge JS
        m = re.search(r"location\.href='(/[^']+)'", raw)
        if m:
            sess.get(f"https://www.quantalys.com{m.group(1)}", stealthy_headers=True, timeout=15)
            raw = _get().decode("utf-8", "ignore")
    funds = json.loads(raw)
    return {f["sCodeISIN"]: f["ID_Produit"] for f in funds if f.get("sCodeISIN")}


# ─── Composition géo ──────────────────────────────────────────────────────────

def fetch_geo(sess: FetcherSession, fund_id: int, asset_class: str | None) -> list[dict] | None:
    """
    Retourne une ventilation géo validée [{country_code, country_label, weight}, …]
    sommant à ~100 (renormalisée), ou None si indisponible / invalide.
    """
    tcs = TC_BY_CLASS.get(asset_class or "", TC_DEFAULT)
    for tc in tcs:
        try:
            r = sess.post(
                COMPO_URL,
                data={"ID_Produit": fund_id, "typeCompo": tc},
                headers={"X-Requested-With": "XMLHttpRequest"},
                stealthy_headers=True,
                timeout=TIMEOUT_SEC,
            )
            if r.status != 200 or not r.body:
                continue
            obj = json.loads(r.body.decode("utf-8", "ignore"))
        except Exception:
            continue

        graph = obj.get("graph") or {}
        dp = graph.get("dataProvider") if isinstance(graph, dict) else None
        if not dp:
            continue

        last = dp[-1]   # dernière date = répartition la plus récente
        raw_weights: dict[str, float] = {}
        for k, v in last.items():
            if k == "x" or not isinstance(v, (int, float)):
                continue
            mapped = map_label(k)
            if mapped is None:
                # libellé inconnu → on ne devine pas, on l'ignore (et on log côté appelant)
                raw_weights.setdefault("__unmapped__", 0.0)
                raw_weights["__unmapped__"] += float(v)
                continue
            code, label = mapped
            key = label
            raw_weights[key] = raw_weights.get(key, 0.0) + float(v)
            # mémoriser le code associé au label
            raw_weights[f"__code__{label}"] = code  # type: ignore

        # poids réels (hors clés techniques)
        weights = {k: v for k, v in raw_weights.items()
                   if not k.startswith("__") and isinstance(v, (int, float))}
        # Quantalys renvoie des pourcentages (0-100) ; la table stocke des
        # FRACTIONS (0-1, cf. convention FT/Morningstar/justetf). On garde la
        # somme en % pour la garde qualité, puis on normalise à 1.0.
        mapped_total = sum(weights.values())
        unmapped = raw_weights.get("__unmapped__", 0.0)
        total = mapped_total + unmapped

        # garde qualité : somme plausible (en %) ET majorité des libellés mappés
        # (sinon on normaliserait quelques buckets résiduels → Σ ≪ 1, données fausses)
        if total < 85 or total > 115 or not weights:
            continue
        if mapped_total < 85:        # >15 % de poids non mappé → on rejette
            continue

        # renormaliser à 1.0 (fraction) sur les seuls poids mappés (≥85 % du total)
        norm = 1.0 / mapped_total if mapped_total else 0.0
        out = []
        for label, w in weights.items():
            code = raw_weights.get(f"__code__{label}")
            frac = round(min(w * norm, 1.0), 4)   # cap 1.0 → respecte numeric(6,4)
            out.append({
                "country_code":  code,
                "country_label": label,
                "weight":        frac,
            })
        # filtrer les poids quasi nuls (< 0,01 % → < 0.0001 en fraction)
        out = [o for o in out if o["weight"] >= 0.0001]
        if not out:
            continue
        return out
    return None


# ─── Cibles ───────────────────────────────────────────────────────────────────

def fetch_existing_geo_isins(client) -> set[str]:
    out: set[str] = set()
    off = 0
    while True:
        b = client.table("investissement_fund_geos").select("isin").range(off, off + 999).execute().data or []
        out.update(r["isin"] for r in b)
        if len(b) < 1000:
            break
        off += 1000
    return out


# Classes d'actif porteuses d'une ventilation géo sur Quantalys.
# On exclut monetaire/crypto/matieres_premieres : pas de géographie (taux ~0 %).
GEO_BEARING_CLASSES = ("action", "obligation", "diversifie", "immobilier", "alternatif")


def fetch_target_funds(client, limit: int | None, catalog: dict[str, int] | None = None) -> list[dict]:
    """
    OPCVM FR sans géo, restreints aux classes porteuses d'une ventilation géo
    (action/obligation/diversifie/immobilier/alternatif), triés AUM décroissant.
    On évite les monétaires (gros AUM mais aucune géographie → 0 % de rendement).
    Si `catalog` est fourni, on ne retient que les ISIN présents dans Quantalys
    (sinon --limit gaspille des places sur des fonds absents du catalogue).
    """
    existing = fetch_existing_geo_isins(client)
    funds: list[dict] = []
    seen: set[str] = set()
    # Ordre de priorité : action / obligation d'abord (forte résolution),
    # puis diversifié (gros gisement), puis immobilier / alternatif.
    for ac in ("action", "obligation", "diversifie", "immobilier", "alternatif"):
        for with_aum in (True, False):
            off = 0
            while True:
                q = (client.table("investissement_funds")
                     .select("isin, name, asset_class_broad, aum_eur")
                     .eq("product_type", "opcvm")
                     .eq("asset_class_broad", ac)
                     .like("isin", "FR%"))
                if with_aum:
                    q = q.not_.is_("aum_eur", "null").order("aum_eur", desc=True)
                else:
                    q = q.is_("aum_eur", "null")
                batch = q.range(off, off + 999).execute().data or []
                for r in batch:
                    isin = r["isin"]
                    if isin in seen or isin in existing:
                        continue
                    if catalog is not None and isin not in catalog:
                        continue
                    if any(p in (r.get("name") or "").lower() for p in SKIP_PATTERNS):
                        continue
                    seen.add(isin)
                    funds.append(r)
                if len(batch) < 1000:
                    break
                off += 1000
            if limit and len(funds) >= limit:
                return funds[:limit]
    if limit:
        funds = funds[:limit]
    return funds


def geo_already_exists(client, isin: str) -> bool:
    """Re-vérif fill-only juste avant écriture (anti-race / anti-doublon)."""
    d = client.table("investissement_fund_geos").select("isin").eq("isin", isin).limit(1).execute().data
    return bool(d)


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None) -> None:
    print("=" * 64)
    print("  Quantalys Geo Enricher — ventilation géo OPCVM FR (FILL-ONLY)")
    print("=" * 64)
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    print("  Initialisation session Quantalys…", flush=True)
    sess = init_session()
    print("  Téléchargement catalogue ISIN → ID…", end=" ", flush=True)
    cat = fetch_catalog(sess)
    print(f"{len(cat):,} entrées", flush=True)

    print("  Sélection des fonds cibles (DB)…", flush=True)
    funds = fetch_target_funds(client, limit, catalog=cat)
    targets = [(f, cat[f["isin"]]) for f in funds if f["isin"] in cat]
    print(f"  {len(targets)} OPCVM FR sans géo présents dans Quantalys (ciblés)", flush=True)
    print(flush=True)

    found = 0
    empty = 0
    written = 0
    unmapped_labels: dict[str, int] = {}

    for i, (fund, fid) in enumerate(targets, 1):
        isin = fund["isin"]
        ac = fund.get("asset_class_broad")
        name = (fund.get("name") or "")[:36]
        time.sleep(RATE_LIMIT_SEC)

        geo = fetch_geo(sess, fid, ac)
        if not geo:
            empty += 1
            if i <= 12 or i % 100 == 0:
                print(f"  ·  [{i:5d}/{len(targets)}] {isin} | pas de géo | {name}")
            continue

        found += 1
        total = sum(g["weight"] for g in geo)   # fraction → ~1.0
        if i <= 30 or i % 50 == 0:
            buckets = ", ".join(f"{g['country_label']} {g['weight']*100:.0f}%" for g in geo[:5])
            print(f"  ✓  [{i:5d}/{len(targets)}] {isin} Σ={total*100:.0f}% | {buckets} | {name}", flush=True)

        if apply:
            # fill-only : re-vérifier juste avant écriture
            if geo_already_exists(client, isin):
                continue
            rows = [{
                "isin":          isin,
                "country_code":  g["country_code"],
                "country_label": g["country_label"],
                "weight":        g["weight"],
                "source":        "quantalys",
                "updated_at":    datetime.now(timezone.utc).isoformat(),
            } for g in geo]
            try:
                client.table("investissement_fund_geos").upsert(
                    rows, on_conflict="isin,country_label"
                ).execute()
                written += 1
            except Exception as e:
                print(f"  ! [{i:5d}] {isin} | insert error: {repr(e)[:90]}")

    print()
    print("=" * 64)
    print(f"  Ventilations trouvées : {found}/{len(targets)} "
          f"({found / max(1, len(targets)) * 100:.1f}%)")
    print(f"  Sans données          : {empty}")
    if apply:
        print(f"  Fonds écrits en base  : {written}")
    print(f"  Durée : {(datetime.now(timezone.utc) - started).seconds}s")
    print("=" * 64)

    if apply:
        log_run("quantalys-geo-enricher", "success", written, empty, started_at=started)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Quantalys Geo Enricher (FILL-ONLY)")
    p.add_argument("--apply", action="store_true", help="Écrire dans investissement_fund_geos")
    p.add_argument("--limit", type=int, default=None, help="Limiter à N fonds cibles")
    args = p.parse_args()
    run(apply=args.apply, limit=args.limit)
