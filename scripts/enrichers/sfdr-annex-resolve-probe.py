#!/usr/bin/env python3
"""
sfdr-annex-resolve-probe.py — Étendre la couverture de l'annexe SFDR
=====================================================================
Diagnostic (aucune écriture). L'enricher sfdr-annex-enricher.py ne sait dériver
l'URL de l'annexe (documenttype=398) que depuis un kid_url Morningstar
documenttype=299 existant → il n'atteint que ~817 des 7 484 fonds Art 8/9 (11%).

Ce probe teste le levier de couverture : pour des fonds Art 8/9 SANS kid_url MS,
résoudre l'investmentid Morningstar (0P…) depuis l'ISIN via le screener ecint
(même accès que ms-emea-sri-enricher), CONSTRUIRE l'URL LatestDoc documenttype=398,
et tenter téléchargement + parsing (socle réutilisé de sfdr-annex-enricher).

Rapporte, sur l'échantillon : combien d'ISIN résolus en investmentid, combien
donnent une annexe PDF téléchargeable, combien parsent ≥1 champ. Si le rendement
est bon → on intègre la résolution ISIN→investmentid dans sfdr-annex-enricher et
la couverture passe de 817 à ~plusieurs milliers.

Usage :
    python3 scripts/enrichers/sfdr-annex-resolve-probe.py [--sample 40]
"""

import sys, time, base64, argparse, importlib.util
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

# ── Réutilise le socle annexe (download + extract + parse template RTS) ──────
_spec = importlib.util.spec_from_file_location(
    "sfdr_annex_enricher", Path(__file__).parent / "sfdr-annex-enricher.py")
annex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(annex)

# ── Accès Morningstar ecint (résolution ISIN → ids) — cf. ms-emea-sri ────────
OAUTH_URL = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER  = "https://www.emea-api.morningstar.com/ecint/v1/screener"
_CREDS    = base64.b64encode(b"ec-Linxe-2022@eamsecservice.com:LinxeB*j91").decode()
PAGE_SIZE = 2000
UNIVERSES = ["FOFRA$$ALL", "FEEUR$$ALL"]

# Gabarit LatestDoc (clientid/key du portail doc Swiss Life, servent l'univers MS).
LATESTDOC = ("https://doc.morningstar.com/LatestDoc.aspx?clientid=swisslifefr"
             "&key=98659dbf88758b35&language=454&investmentid={iid}"
             "&documenttype=398&market=1443&investmenttype=130&format=PDF&frame=0")


def get_token() -> str:
    r = requests.post(OAUTH_URL,
                      headers={"Authorization": f"Basic {_CREDS}", "Accept": "application/json"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def resolve_ids(token: str, target: set[str]) -> dict[str, dict]:
    """{isin: {'perf': PerformanceId, 'sec': SecId}} pour les ISIN de target."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json",
               "Referer": "https://www.linxea.com/"}
    out: dict[str, dict] = {}
    remaining = set(target)
    for universe in UNIVERSES:
        if not remaining:
            break
        params = {"languageId": "fr-FR", "currencyId": "EUR", "universeIds": universe,
                  "outputType": "json", "securityDataPoints": "ISIN|SecId|PerformanceId",
                  "filters": "", "pageSize": PAGE_SIZE, "page": 1}
        page, total = 1, None
        while True:
            params["page"] = page
            r = requests.get(SCREENER, params=params, headers=headers, timeout=30)
            r.raise_for_status()
            data = r.json()
            total = data.get("total", 0) if total is None else total
            rows = data.get("rows", [])
            for row in rows:
                isin = (row.get("ISIN") or "").strip()
                if isin in remaining:
                    out[isin] = {"perf": row.get("PerformanceId"), "sec": row.get("SecId")}
            remaining -= set(out.keys())
            if not remaining or len(rows) < PAGE_SIZE or page * PAGE_SIZE >= total:
                break
            page += 1
            time.sleep(0.15)
    return out


def run(sample: int):
    print("=" * 70)
    print("  SFDR-ANNEX RESOLVE PROBE — couverture via résolution ISIN→investmentid")
    print("=" * 70)
    client = get_client()
    rows = (client.table("investissement_funds")
            .select("isin, kid_url, sfdr_article, aum_eur")
            .in_("sfdr_article", [8, 9])
            .order("aum_eur", desc=True, nullsfirst=False)
            .limit(sample * 4).execute().data or [])
    # SANS kid_url MS documenttype=299 (inclut kid_url NULL) — les fonds hors portée actuelle.
    picked = [r for r in rows if "documenttype=299" not in (r.get("kid_url") or "")][:sample]
    target = {r["isin"] for r in picked}
    print(f"  {len(target)} fonds Art 8/9 SANS kid_url MS (échantillon, gros encours)\n")

    print("  Résolution des ids Morningstar (ecint)…", flush=True)
    ids = resolve_ids(get_token(), target)
    print(f"  → {len(ids)}/{len(target)} ISIN résolus en id Morningstar\n")

    dl = parsed_ok = 0
    for i, (isin, d) in enumerate(ids.items(), 1):
        iid = d.get("perf") or d.get("sec")
        if not iid:
            continue
        url = LATESTDOC.format(iid=iid)
        pdf = annex.download_pdf(url)
        time.sleep(annex.SLEEP_BETWEEN)
        if not pdf:
            if i <= 12:
                print(f"  [{isin}] id={iid}  annexe 398 absente/non-PDF")
            continue
        dl += 1
        text = annex.extract_text(pdf)
        p = annex._sane(annex.parse_annex(text)) if text else {}
        if p:
            parsed_ok += 1
        print(f"  [{isin}] id={iid}  PDF✓  "
              f"SI={p.get('sustainable_investment_pct')!s:>6} "
              f"TAXO={p.get('taxonomy_alignment_pct')!s:>6} "
              f"PAI={p.get('pai_considered')!s:>5}  ({len(p)}/3)")

    n = len(ids)
    print(f"\n  ── BILAN PROBE ──")
    print(f"  ISIN résolus en id      : {len(ids)}/{len(target)}")
    print(f"  Annexes 398 téléchargées: {dl}/{n if n else 1}")
    print(f"  Annexes parsées (≥1)    : {parsed_ok}/{n if n else 1}")
    if n:
        print(f"  → Rendement construction-URL : {100*dl//n}% PDF, {100*parsed_ok//n}% exploitables")
    print("  Si bon rendement → intégrer resolve_ids dans sfdr-annex-enricher "
          "(couverture 817 → milliers).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=40)
    a = ap.parse_args()
    run(a.sample)
