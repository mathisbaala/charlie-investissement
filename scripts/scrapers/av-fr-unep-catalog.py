#!/usr/bin/env python3
"""
av-fr-unep-catalog.py — Catalogue UC des contrats UNEP (assureur Oradéa Vie)
=============================================================================
L'UNEP (Union Nationale d'Épargne et de Prévoyance, courtier grossiste,
site unep-partenaires.fr — unep.fr est le Programme des Nations Unies !)
publie des ANNEXES FINANCIÈRES MENSUELLES par gamme :

    uploads/<AAAA>/<MM>/annexe-fi-ms-<mois>-<annee>.pdf       (Multisélection)
    uploads/<AAAA>/<MM>/annexe-fi-capi-<mois>-<annee>.pdf     (Capitalisation)
    uploads/<AAAA>/<MM>/per-li-annexe-fi-<mois>-<annee>.pdf   (PER Lignage)

Le scraper découvre automatiquement l'annexe la plus récente (essai du mois
courant puis recul jusqu'à 14 mois). Assureur porteur : Oradéa Vie (groupe
Société Générale) → company_name = "Oradéa Vie", cohérent avec la convention
« un nom = un assureur » (précédent : contrats UNEP EVOLUTION sous Prépar Vie).

Contrats couverts :
  • UNEP Multisélection Plus            (annexe MS)
  • UNEP Multisélection Plus Intégrale  (offre du contrat MS Plus : même
    annexe publique ; sa liste « intégrale » additionnelle n'est pas publiée)
  • UNEP Multisélection Privilège       (documentation publique = celle de la
    gamme MS ; annexe dédiée inexistante, vérifié 2026-07)
  • UNEP Capitalisation                 (annexe capi)
  • UNEP PER Lignage                    (annexe per-li)

NON couvert : UNEP PERP Lignage — fermé à la commercialisation depuis le
01/10/2020, aucune annexe publique (vérifié 2026-07).

Extraction pdfplumber, ISIN validés clé ISO 6166, ÉLIGIBILITÉ-ONLY.

Usage :
    python3 scripts/scrapers/av-fr-unep-catalog.py           # dry-run
    python3 scripts/scrapers/av-fr-unep-catalog.py --apply
"""

import io
import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from _av_pdf_common import make_session, existing_isins, _upsert, _valid_isin  # noqa: E402
from db import get_client, log_run  # noqa: E402

COMPANY = "Oradéa Vie"
BASE = "https://unep-partenaires.fr/wp-content/uploads/{yyyy}/{mm:02d}/{slug}-{mois}-{yyyy}.pdf"
MONTHS_FR = ["janvier", "fevrier", "mars", "avril", "mai", "juin",
             "juillet", "aout", "septembre", "octobre", "novembre", "decembre"]
LOOKBACK_MONTHS = 14

# slug d'annexe → contrats qui partagent cette liste publique
GAMMES = [
    ("annexe-fi-ms",   ["UNEP Multisélection Plus",
                        "UNEP Multisélection Plus Intégrale",
                        "UNEP Multisélection Privilège"]),
    ("annexe-fi-capi", ["UNEP Capitalisation"]),
    ("per-li-annexe-fi", ["UNEP PER Lignage"]),
]

ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b")


def find_latest_pdf(session, slug: str) -> tuple[str, bytes] | None:
    """Essaie le mois courant puis recule ; retourne (url, contenu PDF)."""
    now = datetime.now(timezone.utc)
    y, m = now.year, now.month
    for _ in range(LOOKBACK_MONTHS):
        url = BASE.format(yyyy=y, mm=m, slug=slug, mois=MONTHS_FR[m - 1])
        try:
            r = session.get(url, timeout=45, allow_redirects=True)
            if r.status_code == 200 and r.content[:4] == b"%PDF":
                return url, r.content
        except Exception:
            pass
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        time.sleep(0.3)
    return None


def pdf_isins(content: bytes) -> list[str]:
    isins, seen = [], set()
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for mt in ISIN_RE.finditer(text):
                v = mt.group(1)
                if v not in seen and _valid_isin(v):
                    seen.add(v)
                    isins.append(v)
    return isins


def run(apply: bool) -> None:
    started = datetime.now(timezone.utc)
    print("=" * 64)
    print(f"  UNEP ({COMPANY}) — catalogue UC (annexes financières mensuelles)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)

    session = make_session()
    per_contract: list[tuple[str, str, list[str]]] = []
    for slug, contracts in GAMMES:
        found = find_latest_pdf(session, slug)
        if not found:
            print(f"  ✗ {slug} : aucune annexe trouvée sur {LOOKBACK_MONTHS} mois")
            continue
        url, content = found
        isins = pdf_isins(content)
        print(f"  {slug:18} → {url.rsplit('/', 1)[-1]} : {len(isins)} ISIN")
        for contract in contracts:
            per_contract.append((contract, url, isins))
            print(f"    · {contract}")

    if not apply:
        print("  DRY-RUN — rien écrit. Relancer avec --apply.")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()
    rows, union = [], set()
    for contract, src, isins in per_contract:
        kept = [x for x in isins if x in known]
        union.update(kept)
        rows.extend({
            "isin": x, "company_name": COMPANY, "contract_name": contract,
            "source_url": src, "scraped_at": now,
        } for x in kept)
        print(f"  {contract[:44]:44} {len(kept):5} en base / {len(isins)}")

    ok = 0
    for i in range(0, len(rows), 200):
        _upsert(client, rows[i:i + 200])
        ok += len(rows[i:i + 200])
    print(f"\n  Éligibilité écrite : {ok} lignes ({len(union)} fonds distincts).")
    log_run("av-fr-unep-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Catalogue UC UNEP/Oradéa Vie (annexes mensuelles)")
    parser.add_argument("--apply", action="store_true", help="écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
