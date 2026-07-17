#!/usr/bin/env python3
"""
av-fr-conservateur-catalog.py — Référencement Le Conservateur (AV/PER/capi)
=============================================================================
Les Assurances Mutuelles Le Conservateur (distribution conseillers/CGP)
publient par contrat un « Tableau d'information relatif aux supports » (loi
PACTE, PDF avec ISIN + frais UC + taux de rétrocession) sur conservateur.fr :
  M40 → Conservateur Hélios Patrimoine + Hélios Capitalisation (liste commune)
  M41 → Conservateur Épargne Retraite (PER)
  M42 → Conservateur Privilège + Capitalisation Privilège

⚠️ Les URLs changent à chaque millésime (/app/uploads/sites/2/AAAA/MM/…-MMAA.pdf)
→ découverte dynamique via l'API WordPress publique
  /wp-json/wp/v2/media?search=Tableau-d-information (la plus récente par code),
avec repli sur les URLs du repérage 2026-07-16. Tontines exclues (pas d'UC).
~62 ISIN en union (univers largement mutualisé entre contrats).

Pipeline standard _av_pdf_common (curl_cffi + pdftotext + filtre « en base »).

Usage :
    python3 scripts/scrapers/av-fr-conservateur-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-conservateur-catalog.py --apply
"""

import re
import argparse

from _av_pdf_common import make_session, run_eligibility

COMPANY = "Le Conservateur"

WP_MEDIA = ("https://www.conservateur.fr/wp-json/wp/v2/media"
            "?search=Tableau-d-information&per_page=100")

# code interne → (repli URL du repérage 2026-07, [contrats servis par la liste])
CODES = {
    "M40": ("https://www.conservateur.fr/app/uploads/sites/2/2026/03/Tableau-d-information-UC-M40-0326.pdf",
            ["Conservateur Hélios Patrimoine", "Conservateur Hélios Capitalisation"]),
    "M41": ("https://www.conservateur.fr/app/uploads/sites/2/2026/03/Tableau-d-information-UC-M41-0326.pdf",
            ["Conservateur Épargne Retraite"]),
    "M42": ("https://www.conservateur.fr/app/uploads/sites/2/2026/03/Tableau-d-information-sur-les-UC-M42-1125.pdf",
            ["Conservateur Privilège", "Conservateur Capitalisation Privilège"]),
}


def _edition_key(url: str) -> tuple[int, int]:
    """(année, mois) du millésime « -MMAA.pdf » du nom de fichier (0,0 sinon).

    ⚠ Ne PAS se fier à la date d'upload WordPress : l'édition 11/25 de M40 a
    été re-téléversée APRÈS l'édition 03/26 — seul le suffixe fait foi.
    """
    m = re.search(r"-(\d{2})(\d{2})\.pdf", url.split("?")[0], re.IGNORECASE)
    if not m:
        return (0, 0)
    mm, yy = int(m.group(1)), int(m.group(2))
    return (yy, mm) if 1 <= mm <= 12 else (0, 0)


def discover_pdf_urls() -> dict[str, str]:
    """code (M40/M41/M42) → URL du PDF à l'édition la plus récente (API media WP).

    Repli silencieux sur CODES si l'API ne répond pas ou si un code est absent.
    """
    candidates: dict[str, list[str]] = {}
    session = make_session()
    try:
        r = session.get(WP_MEDIA, timeout=45)
        if r.status_code == 200:
            for item in r.json():
                url = str((item.get("source_url") or ""))
                # les URLs media portent un cache-buster « ?ver=… » → tester le chemin nu
                if not url.split("?")[0].lower().endswith(".pdf"):
                    continue
                m = re.search(r"\b(M4[012])\b", url)
                if m:
                    candidates.setdefault(m.group(1), []).append(url)
        else:
            print(f"  ⚠ découverte media : HTTP {r.status_code} → replis")
    except Exception as e:
        print(f"  ⚠ découverte media : {str(e)[:60]} → replis")
    return {code: max(urls, key=_edition_key) for code, urls in candidates.items()}


def main():
    ap = argparse.ArgumentParser(description="Le Conservateur — catalogue UC (éligibilité-only)")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    discovered = discover_pdf_urls()
    contracts = []
    for code, (fallback, names) in CODES.items():
        url = discovered.get(code, fallback)
        tag = "découverte" if code in discovered else "repli"
        print(f"  {code} ({tag}) : {url.rsplit('/', 1)[-1]}")
        for name in names:
            contracts.append({"contract": name, "pdf_url": url,
                              "source_url": "https://www.conservateur.fr/nos-produits/documentation-sur-nos-produits/"})
    run_eligibility(COMPANY, contracts, scraper_name="av-fr-conservateur-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
