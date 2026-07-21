#!/usr/bin/env python3
"""
sfdr-annex-resolve-probe.py — Trouver une source ANNEXE SFDR par ISIN (sans entitlement)
=========================================================================================
Diagnostic (aucune écriture). Constat des probes précédents :
  - le screener ecint n'expose PAS les % SFDR quantitatifs ;
  - la voie Morningstar doctype=398 marche mais est PLAFONNÉE à ~817 fonds
    (l'URL LatestDoc est scopée par distributeur : une clé ne sert que SES fonds ;
    résolution ISIN→investmentid OK à 88% mais 0 annexe via une clé unique).

Ce probe teste les dépôts documentaires PAR ISIN, SANS entitlement (mêmes que
epr-kid-enrich.py pour le KID) : EPR/amfinesoft et FundInfo. Objectif : trouver le
segment qui sert l'ANNEXE précontractuelle SFDR (les % SI/taxo/PAI) par ISIN, ce qui
débloquerait la couverture des ~6 600 Art 8/9 hors portée Morningstar.

KID EPR générique = TÉMOIN (doit renvoyer un PDF → prouve l'accès).

Usage :
    python3 scripts/enrichers/sfdr-annex-resolve-probe.py [--sample 30]
"""

import sys, time, argparse, importlib.util
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client
from scrapling.fetchers import FetcherSession

# Réutilise le socle de parsing annexe (template RTS).
_spec = importlib.util.spec_from_file_location(
    "sfdr_annex_enricher", Path(__file__).parent / "sfdr-annex-enricher.py")
annex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(annex)

EPR = "https://epr.amfinesoft.com/api/v1/download"
GKEY = "xJdkzl5Bq4GWwvPKrtPRSK4a9QfrXe"  # clé générique publique (cf. epr-kid-enrich)

# Sources candidates de l'ANNEXE SFDR par ISIN. Le KID sert de témoin d'accès.
# On teste plusieurs segments plausibles (parallèles à 'kid') car le nom exact du
# document annexe/précontractuel EPR n'est pas connu.
CANDIDATES = [
    ("TÉMOIN kid",        EPR + "/underlying/kid/{isin}/lang/fr?key=" + GKEY),
    ("epr sfdr",          EPR + "/underlying/sfdr/{isin}/lang/fr?key=" + GKEY),
    ("epr annex",         EPR + "/underlying/annex/{isin}/lang/fr?key=" + GKEY),
    ("epr precontractual",EPR + "/underlying/precontractual/{isin}/lang/fr?key=" + GKEY),
    ("epr kid-annex",     EPR + "/underlying/kid-annex/{isin}/lang/fr?key=" + GKEY),
    ("epr eet",           EPR + "/underlying/eet/{isin}/lang/fr?key=" + GKEY),
    ("epr disclosure",    EPR + "/underlying/disclosure/{isin}/lang/fr?key=" + GKEY),
    ("fundinfo kid",      "https://doc.fundinfo.com/doc/{isin}/kid_{isin}_fr.pdf"),
    ("fundinfo sfdr",     "https://doc.fundinfo.com/doc/{isin}/sfdr_{isin}_fr.pdf"),
    ("fundinfo annex",    "https://doc.fundinfo.com/doc/{isin}/annex_{isin}_fr.pdf"),
]


def run(sample: int):
    print("=" * 72)
    print("  PROBE source annexe SFDR par ISIN (EPR / FundInfo, sans entitlement)")
    print("=" * 72)
    client = get_client()
    rows = (client.table("investissement_funds")
            .select("isin, sfdr_article, aum_eur")
            .in_("sfdr_article", [8, 9])
            .order("aum_eur", desc=True, nullsfirst=False)
            .limit(sample).execute().data or [])
    isins = [r["isin"] for r in rows]
    print(f"  {len(isins)} fonds Art 8/9 (gros encours)\n")

    # stats par source : pdf trouvés / annexes parsées ≥1 champ
    stat = {name: {"pdf": 0, "parsed": 0} for name, _ in CANDIDATES}

    with FetcherSession() as session:
        for isin in isins:
            for name, tpl in CANDIDATES:
                url = tpl.format(isin=isin)
                try:
                    r = session.get(url, stealthy_headers=True, timeout=20)
                    time.sleep(0.15)
                except Exception:
                    continue
                body = getattr(r, "body", None) or b""
                if getattr(r, "status", 0) == 200 and body[:4] == b"%PDF":
                    stat[name]["pdf"] += 1
                    if name.startswith("TÉMOIN") or "kid" in name:
                        continue  # le KID n'est pas l'annexe → pas de parsing champs
                    txt = annex.extract_text(bytes(body))
                    if txt and annex._sane(annex.parse_annex(txt)):
                        stat[name]["parsed"] += 1

    n = len(isins)
    print("  ── BILAN PAR SOURCE (sur", n, "fonds) ──")
    for name, _ in CANDIDATES:
        s = stat[name]
        flag = "  ✅ ANNEXE EXPLOITABLE" if s["parsed"] else ("  (pdf ok)" if s["pdf"] else "")
        print(f"    {name:22s} : PDF {s['pdf']:2d}/{n}   annexe parsée {s['parsed']:2d}/{n}{flag}")
    print("\n  → Une source avec 'annexe parsée' > 0 = la voie de déblocage (couvre par ISIN).")
    print("    Si seul le KID/témoin renvoie des PDF → EPR ne sert pas l'annexe → autre piste.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=30)
    a = ap.parse_args()
    run(a.sample)
