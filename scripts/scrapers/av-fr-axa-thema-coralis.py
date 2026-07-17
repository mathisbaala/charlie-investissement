#!/usr/bin/env python3
"""
av-fr-axa-thema-coralis.py — Gamme Coralis (AXA Théma, assureur AXA France Vie)
================================================================================
AXA Théma (plateforme CGP d'AXA) publie une « liste unique des supports en
unités de compte » commune aux contrats Coralis Sélection (assurance vie) et
Coralis Capitalisation (capitalisation), avec pour CHAQUE support 4 colonnes
OUI/NON : GL, GSMC, GSMP et — décisif ici — l'ÉLIGIBILITÉ PEA (« la mention
d'éligibilité PEA vaut exclusivement dans le cadre d'un contrat Coralis
Capitalisation […] investi dans le cadre fiscal du PEA »).

C'est, avec Suravenir/Cardif/AG2R/SwissLife, l'un des rares PEA assurance du
marché français ; cette annexe est LA source publique de sa liste de supports.

Contrats écrits (company = "AXA France", convention existante en base) :
  • Coralis Sélection            → tous les supports listés (AV)
  • Coralis Capitalisation       → tous les supports listés (capi)
  • Coralis Capitalisation PEA   → supports avec colonne PEA = OUI
    (le nom contient « PEA » → typé pea par get_contracts_list)

Le PDF inclut aussi les titres vifs (actions en direct, largement PEA OUI) :
l'ÉLIGIBILITÉ-ONLY les garde s'ils existent au catalogue (univers PEA récolté
en juillet 2026), sans jamais rien insérer.

Parse : pdfplumber, lignes « NOM ISIN FORME OUI/NON ×4 [annexes] », ISIN
validés clé ISO 6166.

Usage :
    python3 scripts/scrapers/av-fr-axa-thema-coralis.py           # dry-run
    python3 scripts/scrapers/av-fr-axa-thema-coralis.py --apply
"""

import io
import re
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from _av_pdf_common import make_session, existing_isins, _upsert, _valid_isin  # noqa: E402
from db import get_client, log_run  # noqa: E402

COMPANY = "AXA France"

# URL stable de l'annexe (réf. 705929) ; miroir partenariats en secours.
PDF_URLS = [
    "https://www.axathema.fr/content/dam/axa-thema/support-commercial/"
    "espace-documentaire-partenaire/contrats-epargne-coralis-s%C3%A9lection-et-capitalisation-/"
    "705929_d_adm_coralis_annexe_liste_supports.pdf",
    "https://partenariats.axa.fr/extranet/documents/thema/coralis/d_adm_coralis_annexe_liste_supports.pdf",
]
SOURCE_URL = "https://www.axathema.fr/nos-solutions-patrimoniales/la-contrat-de-capitalisation.html"

CONTRACT_AV = "Coralis Sélection"
CONTRACT_CAPI = "Coralis Capitalisation"
CONTRACT_PEA = "Coralis Capitalisation PEA"

# « NOM  ISIN  FORME  GL GSMC GSMP PEA … » : lignes de la liste UC.
LINE_RE = re.compile(
    r"^(?P<name>.+?)\s+(?P<isin>[A-Z]{2}[A-Z0-9]{9}\d)\b"
    r"(?:\s+(?!OUI\b|NON\b)\S+)?"
    r"\s+(?P<gl>OUI|NON)\s+(?P<gsmc>OUI|NON)\s+(?P<gsmp>OUI|NON)\s+(?P<pea>OUI|NON)\b"
)
# « NOM  ISIN  ACTION|OBLIGATION  … » : titres vifs, accessibles uniquement en
# gestion sous mandat personnalisée (aucune colonne PEA publiée → jamais dans le
# contrat PEA ; comptés dans Sélection/Capitalisation).
EQUITY_RE = re.compile(
    r"^(?P<name>.+?)\s+(?P<isin>[A-Z]{2}[A-Z0-9]{9}\d)\s+(ACTION|OBLIGATION)\b"
)


def download_pdf(session) -> tuple[bytes | None, str]:
    for url in PDF_URLS:
        try:
            r = session.get(url, timeout=60, allow_redirects=True)
        except Exception as e:
            print(f"  ⚠ fetch {url[:70]} : {str(e)[:60]}")
            continue
        if r.status_code == 200 and r.content[:4] == b"%PDF":
            print(f"  Annexe téléchargée ({len(r.content) // 1024} Ko) : {url[:78]}")
            return r.content, url
        print(f"  ⚠ HTTP {r.status_code} / non-PDF sur {url[:70]}")
    return None, ""


def parse_supports(content: bytes) -> tuple[list[str], list[str]]:
    """(tous les ISIN listés, ISIN éligibles PEA) — validés ISO 6166, dédupliqués."""
    all_isins: dict[str, None] = {}
    pea_isins: dict[str, None] = {}
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").split("\n"):
                stripped = line.strip()
                m = LINE_RE.match(stripped)
                if m:
                    isin = m.group("isin")
                    if not _valid_isin(isin):
                        continue
                    all_isins.setdefault(isin, None)
                    if m.group("pea") == "OUI":
                        pea_isins.setdefault(isin, None)
                    continue
                e = EQUITY_RE.match(stripped)
                if e and _valid_isin(e.group("isin")):
                    all_isins.setdefault(e.group("isin"), None)
    return list(all_isins), list(pea_isins)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    started = datetime.now(timezone.utc)

    print("=" * 64)
    print(f"  {COMPANY} — gamme Coralis (AXA Théma), annexe liste des supports")
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    session = make_session()
    content, pdf_url = download_pdf(session)
    if not content:
        print("  ✗ annexe introuvable — abandon.")
        if args.apply:
            log_run("av-fr-axa-thema-coralis", "error", 0, 1, started_at=started)
        sys.exit(1)

    all_isins, pea_isins = parse_supports(content)
    print(f"  Supports extraits : {len(all_isins)} ISIN valides, dont {len(pea_isins)} éligibles PEA")
    if len(all_isins) < 100 or not pea_isins:
        print("  ✗ extraction anormalement pauvre (layout changé ?) — abandon.")
        if args.apply:
            log_run("av-fr-axa-thema-coralis", "error", 0, 1, started_at=started)
        sys.exit(1)

    plan = [
        (CONTRACT_AV, all_isins),
        (CONTRACT_CAPI, all_isins),
        (CONTRACT_PEA, pea_isins),
    ]

    if not args.apply:
        for name, isins in plan:
            print(f"  · {name:32} {len(isins):4} ISIN cités")
        print("  DRY-RUN — rien écrit. Relancer avec --apply.")
        return

    client = get_client()
    known = existing_isins(client)
    print(f"  ISIN en base : {len(known)}")
    now = datetime.now(timezone.utc).isoformat()

    ok = 0
    for name, isins in plan:
        kept = [x for x in isins if x in known]
        batch = [{
            "isin": x, "company_name": COMPANY, "contract_name": name,
            "source_url": pdf_url or SOURCE_URL, "scraped_at": now,
        } for x in kept]
        for i in range(0, len(batch), 200):
            _upsert(client, batch[i:i + 200])
        ok += len(batch)
        print(f"  · {name:32} {len(isins):4} cités → {len(kept):4} en base, écrits")

    print(f"  Éligibilité écrite : {ok} lignes.")
    log_run("av-fr-axa-thema-coralis", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    main()
