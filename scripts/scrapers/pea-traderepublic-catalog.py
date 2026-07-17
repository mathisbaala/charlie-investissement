#!/usr/bin/env python3
"""
pea-traderepublic-catalog.py — Univers PEA de Trade Republic (PDF ∩ flags)
===========================================================================
Trade Republic publie son univers d'investissement France en PDF public
(~13 500 ISIN, format « ISIN  Nom », sections Actions puis ETF) :
  https://assets.traderepublic.com/assets/files/FR/Instrument_Universe_FR_fr.pdf
mais SANS flag PEA (le sous-ensemble PEA n'est pas publié ; l'app est derrière
AWS WAF). Le sous-ensemble se DÉDUIT donc par croisement : univers TR ∩ fonds
flagués pea_eligible dans investissement_funds (flag autoritaire JustETF pour
les ETF, cf. justetf-pea-fill ; actions UE/EEE via pea-eligibility-fix).

⚠ Comme partout dans le référencement, les ACTIONS sont exclues des comptages
UI (filtre product_type des RPC) : le contrat expose de facto les ETF/fonds
PEA négociables chez TR. Nécessite un accès DB même en dry-run (croisement).

ÉLIGIBILITÉ-ONLY via _pea_common (contrat « PEA Trade Republic »).

Usage :
    python3 scripts/scrapers/pea-traderepublic-catalog.py            # dry-run (DB requise)
    python3 scripts/scrapers/pea-traderepublic-catalog.py --apply
"""

import re
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _av_pdf_common import fetch_pdf_text, make_session, _valid_isin  # noqa: E402
from _pea_common import write_pea_contracts  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client  # noqa: E402

PDF_URL    = "https://assets.traderepublic.com/assets/files/FR/Instrument_Universe_FR_fr.pdf"
SOURCE_URL = "https://traderepublic.com/fr-fr/pea"

COMPANY  = "Trade Republic"
CONTRACT = "PEA Trade Republic"
ISIN_RE  = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
MIN_UNIVERSE = 5000  # ~13 500 attendus ; en dessous = PDF tronqué/déplacé.


def pea_flagged_isins(client) -> set[str]:
    """ISIN flagués pea_eligible en base (toutes classes), paginé."""
    out: set[str] = set()
    off = 0
    while True:
        rows = client.table("investissement_funds").select("isin") \
            .eq("pea_eligible", True).range(off, off + 999).execute().data
        if not rows:
            break
        out.update(r["isin"] for r in rows)
        if len(rows) < 1000:
            break
        off += 1000
    return out


def main():
    ap = argparse.ArgumentParser(description="Trade Republic — PEA (univers PDF ∩ flags)")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = ap.parse_args()
    started = datetime.now(timezone.utc)

    print("=" * 64)
    print(f"  {COMPANY} — {CONTRACT} (PDF univers ∩ pea_eligible)")
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    session = make_session()
    text = fetch_pdf_text(session, PDF_URL)
    universe = sorted({x for x in ISIN_RE.findall(text or "") if _valid_isin(x)})
    print(f"  Univers TR (PDF) : {len(universe)} ISIN")
    if len(universe) < MIN_UNIVERSE:
        print(f"  ✗ sous le seuil ({MIN_UNIVERSE}) — PDF tronqué/déplacé, abandon.")
        return

    client = get_client()
    flagged = pea_flagged_isins(client)
    pea = [x for x in universe if x in flagged]
    print(f"  ∩ pea_eligible en base : {len(pea)}")

    write_pea_contracts(COMPANY, [(CONTRACT, pea, SOURCE_URL)],
                        scraper_name="pea-traderepublic-catalog",
                        apply=args.apply, started=started)


if __name__ == "__main__":
    main()
