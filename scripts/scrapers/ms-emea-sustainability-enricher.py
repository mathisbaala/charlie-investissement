#!/usr/bin/env python3
"""
ms-emea-sustainability-enricher.py — Durabilité MiFID via Morningstar EMEA
==========================================================================
Comble les champs SFDR QUANTITATIFS restés quasi vides (cul-de-sac KID, cf.
mémoire "sustainability-dda") en les puisant dans l'annexe SFDR agrégée par
Morningstar, exposée via l'API EMEA (mêmes credentials Linxea que
ms-emea-sri-enricher.py) :

  - taxonomy_alignment_pct     : % d'alignement taxonomie UE
  - sustainable_investment_pct : % d'investissement durable (SFDR)
  - pai_considered             : prise en compte des PAI (bool)

Cible : OPCVM/ETF classés SFDR Article 8 ou 9 (les seuls à publier ces chiffres)
et dont au moins un des 3 champs manque. Fill-only, idempotent, 0 token IA.

⚠️ IDs de champs Morningstar EMEA à CONFIRMER : lancer d'ABORD `--probe` pour
découvrir quels securityDataPoints remontent réellement la donnée sur un
échantillon d'Article 9 (Morningstar ignore les data points inconnus, donc on
en teste plusieurs orthographes). Le probe imprime, par champ candidat, combien
de l'échantillon renvoient une valeur non nulle → on garde les gagnants dans
CONFIRMED_FIELDS puis on lance `--apply`.

Usage :
    python3 scripts/scrapers/ms-emea-sustainability-enricher.py --probe [--sample 25]
    python3 scripts/scrapers/ms-emea-sustainability-enricher.py --apply [--limit N]
"""

import sys, time, argparse, base64, requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

OAUTH_URL = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER  = "https://www.emea-api.morningstar.com/ecint/v1/screener"
_CREDS    = base64.b64encode(b"ec-Linxe-2022@eamsecservice.com:LinxeB*j91").decode()
PAGE_SIZE = 2000
UNIVERSES = ["FOFRA$$ALL", "FEEUR$$ALL"]

# Champs candidats à sonder (plusieurs orthographes MS EMEA connues/plausibles).
# Le probe garde ceux qui remontent effectivement une valeur.
CANDIDATE_FIELDS = {
    "taxonomy_alignment_pct": [
        "EUTaxonomyAlignmentPercentageOverall", "EUTaxonomyAlignmentPercent",
        "EUTaxonomyRevenueAlignment", "TaxonomyAlignedPercent",
    ],
    "sustainable_investment_pct": [
        "SustainableInvestmentPercentageOverall", "SustainableInvestmentPercent",
        "MinimumSustainableInvestment", "SustainableInvestmentOverall",
    ],
    "pai_considered": [
        "PrincipalAdverseImpactConsideration", "ConsidersPAI",
        "PAIConsideration", "SFDRPAIStatement",
    ],
}

# Après probe concluant, renseigner ici l'ID retenu par colonne (None = à confirmer).
CONFIRMED_FIELDS: dict[str, str | None] = {
    "taxonomy_alignment_pct": None,
    "sustainable_investment_pct": None,
    "pai_considered": None,
}


def get_token() -> str:
    r = requests.post(OAUTH_URL,
                      headers={"Authorization": f"Basic {_CREDS}", "Accept": "application/json"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json",
            "Referer": "https://www.linxea.com/"}


def _screener_page(token: str, universe: str, datapoints: str, page: int) -> dict:
    params = {
        "languageId": "fr-FR", "currencyId": "EUR", "universeIds": universe,
        "outputType": "json", "securityDataPoints": datapoints,
        "filters": "", "pageSize": PAGE_SIZE, "page": page,
    }
    r = requests.get(SCREENER, params=params, headers=_headers(token), timeout=30)
    r.raise_for_status()
    return r.json()


def load_targets(client, only_isins: set[str] | None = None) -> list[str]:
    """OPCVM/ETF Article 8/9 avec au moins un des 3 champs durabilité manquant."""
    out: list[str] = []
    offset = 0
    while True:
        q = (client.table("investissement_funds")
             .select("isin")
             .in_("product_type", ["opcvm", "etf"])
             .in_("sfdr_article", [8, 9])
             .or_("taxonomy_alignment_pct.is.null,"
                  "sustainable_investment_pct.is.null,"
                  "pai_considered.is.null")
             .range(offset, offset + 999))
        batch = q.execute().data or []
        out.extend(r["isin"] for r in batch)
        if len(batch) < 1000:
            break
        offset += 1000
    if only_isins is not None:
        out = [i for i in out if i in only_isins]
    return out


def probe(sample: int):
    """Teste chaque champ candidat sur un échantillon d'Article 9 et rapporte
    le taux de remplissage — sert à identifier les vrais securityDataPoints."""
    client = get_client()
    rows = (client.table("investissement_funds").select("isin")
            .in_("product_type", ["opcvm", "etf"]).eq("sfdr_article", 9)
            .limit(sample).execute().data or [])
    target = {r["isin"] for r in rows}
    print(f"  Probe sur {len(target)} fonds Article 9\n")
    token = get_token()

    for col, candidates in CANDIDATE_FIELDS.items():
        print(f"── {col} ──")
        for field in candidates:
            hits, examples = 0, []
            for universe in UNIVERSES:
                try:
                    data = _screener_page(token, universe, f"ISIN|{field}", 1)
                except Exception as e:
                    print(f"    {field:45s} : ERREUR {str(e)[:60]}")
                    break
                for row in data.get("rows", []):
                    isin = (row.get("ISIN") or "").strip()
                    val  = row.get(field)
                    if isin in target and val is not None and val != "":
                        hits += 1
                        if len(examples) < 3:
                            examples.append(f"{isin}={val}")
                time.sleep(0.2)
            flag = "  ✅" if hits else ""
            print(f"    {field:45s} : {hits:3d} valeurs{flag}   {', '.join(examples)}")
        print()
    print("→ Renseigner CONFIRMED_FIELDS avec les IDs ✅, puis lancer --apply.")


def _coerce(col: str, val):
    if val is None or val == "":
        return None
    if col == "pai_considered":
        s = str(val).strip().lower()
        if s in ("true", "yes", "oui", "1", "y"):  return True
        if s in ("false", "no", "non", "0", "n"):  return False
        return None
    try:
        f = float(val)
    except (ValueError, TypeError):
        return None
    if f <= 1.0:      # fraction → %
        f *= 100.0
    return round(f, 2) if 0 <= f <= 100 else None


def apply(limit: int | None):
    missing = [c for c, f in CONFIRMED_FIELDS.items() if not f]
    if missing:
        print(f"✗ CONFIRMED_FIELDS incomplet ({', '.join(missing)}). Lancer --probe d'abord.")
        return
    client  = get_client()
    started = datetime.now(timezone.utc)
    targets = set(load_targets(client))
    print(f"  {len(targets)} fonds Article 8/9 à compléter")
    token = get_token()

    dp = "ISIN|" + "|".join(CONFIRMED_FIELDS[c] for c in CONFIRMED_FIELDS)
    fetched: dict[str, dict] = {}
    for universe in UNIVERSES:
        if not targets:
            break
        page, total = 1, None
        while True:
            data = _screener_page(token, universe, dp, page)
            total = data.get("total", 0) if total is None else total
            rows = data.get("rows", [])
            for row in rows:
                isin = (row.get("ISIN") or "").strip()
                if isin in targets:
                    rec = {}
                    for col, field in CONFIRMED_FIELDS.items():
                        v = _coerce(col, row.get(field))
                        if v is not None:
                            rec[col] = v
                    if rec:
                        fetched[isin] = rec
            if len(rows) < PAGE_SIZE or page * PAGE_SIZE >= total:
                break
            page += 1
            time.sleep(0.15)
        print(f"  {universe} : {len(fetched)} fonds avec donnée cumulés")

    items = list(fetched.items())
    if limit:
        items = items[:limit]
    now = datetime.now(timezone.utc).isoformat()
    updated = skipped = 0
    for isin, rec in items:
        rec["sustainability_source"] = "ms-emea"
        rec["sustainability_computed_at"] = now
        rec["updated_at"] = now
        try:
            client.table("investissement_funds").update(rec).eq("isin", isin).execute()
            updated += 1
        except Exception as e:
            if skipped < 3:
                print(f"  ✗ {isin}: {str(e)[:70]}")
            skipped += 1
    print(f"\n  → {updated} fonds enrichis en durabilité MiFID, {skipped} erreurs")
    log_run("ms-emea-sustainability-enricher", "success" if updated else "partial",
            updated, skipped, started_at=started)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="Découvrir les IDs de champs MS")
    ap.add_argument("--sample", type=int, default=25)
    ap.add_argument("--apply", action="store_true", help="Écrire (après probe confirmé)")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    if a.probe:
        probe(a.sample)
    elif a.apply:
        apply(a.limit)
    else:
        print("Préciser --probe (d'abord) ou --apply.")
