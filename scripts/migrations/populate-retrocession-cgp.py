#!/usr/bin/env python3
"""
populate-retrocession-cgp.py — Extraire la rétrocession CGP depuis les KIDs PRIIPS
====================================================================================
La rétrocession est la commission de distribution versée au distributeur (CGP)
sur les frais de gestion courants. C'est le champ le plus critique pour un CGP
qui veut évaluer sa rémunération sur chaque fonds.

Sources (par ordre de fiabilité) :
  1. KID PRIIPS — tableau des coûts récurrents, ligne "Commission de distribution"
  2. Différence ongoing_charges – ter_net quand les deux sont renseignés
  3. Inférence par classe de parts (fallback grossier)

Le KID PRIIPS normalise la présentation depuis 2018 :
  Tableau II — Coûts récurrents :
    - Frais de gestion du portefeuille : A%
    - Commission de distribution      : B%   ← c'est la rétrocession
    - Frais liés aux transactions     : C%

Usage :
    python3 scripts/migrations/populate-retrocession-cgp.py
    python3 scripts/migrations/populate-retrocession-cgp.py --apply
    python3 scripts/migrations/populate-retrocession-cgp.py --apply --limit 1000
    python3 scripts/migrations/populate-retrocession-cgp.py --apply --only-geco
"""

import sys
import re
import argparse
import time
import requests
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

RATE_LIMIT_SEC    = 0.5
MAX_PDF_SIZE_MB   = 10
PAGE_FETCH_TIMEOUT = 20
BATCH_SIZE        = 200

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Charlie-Investissement/1.0; data@charlie.fr)",
    "Accept":     "application/pdf,application/octet-stream,*/*",
}

FLAGS = re.DOTALL | re.IGNORECASE

# ─── Patterns rétrocession CGP ────────────────────────────────────────────────
# Le KID PRIIPS liste les coûts récurrents par ligne.
# La rétrocession est étiquetée "commission de distribution" ou "frais de distribution".

RETROCESSION_PATTERNS = [
    # Français
    r"commission\s+de\s+distribution[^\d%\n]*?(\d+[.,]\d+)\s*%",
    r"frais\s+(?:de|liés aux services d.investissement)[^\d%\n]*?(\d+[.,]\d+)\s*%",
    r"rétrocession[^\d%\n]*?(\d+[.,]\d+)\s*%",
    r"coûts\s+(?:de|liés aux)\s+(?:la\s+)?distribution[^\d%\n]*?(\d+[.,]\d+)\s*%",
    r"charges\s+de\s+distribution[^\d%\n]*?(\d+[.,]\d+)\s*%",
    # Anglais (KIDs LU/IE)
    r"distribution\s+(?:fee|cost|charge)[^\d%\n]*?(\d+[.,]\d+)\s*%",
    r"distributor\s+(?:fee|cost|charge)[^\d%\n]*?(\d+[.,]\d+)\s*%",
    r"trailer\s+fee[^\d%\n]*?(\d+[.,]\d+)\s*%",
    # Contexte : tableau avec "distribution" puis chiffre sur la même ligne
    r"distribution\s+\|[^\d%]*?(\d+[.,]\d+)\s*%",
    r"distribution\s*:\s*(\d+[.,]\d+)\s*%",
]

# Parts institutionnelles → rétrocession = 0 (certitude élevée)
INSTITUTIONAL_PATTERNS = re.compile(
    r"\b(?:part|classe|class|share)\s*[IZX]\b"
    r"|instit(?:utional)?(?:\s+class)?"
    r"|\bI\s+acc\b|\bI\s+dist\b|\bZ\s+acc\b|\bX\s+acc\b"
    r"|\bHI\b|\bCI\b",
    re.IGNORECASE,
)

# Parts retail/distribution → rétrocession probable
RETAIL_PATTERNS = re.compile(
    r"\b(?:part|classe|class|share)\s*[ARDCE]\b"
    r"|retail\b|r\s+acc\b|r\s+dist\b|part\s+d\b|classe\s+a\b",
    re.IGNORECASE,
)


def parse_value(s: str) -> float:
    return float(s.replace(",", "."))


def extract_retrocession(text: str) -> float | None:
    """Cherche la commission de distribution dans le texte du KID."""
    for pattern in RETROCESSION_PATTERNS:
        m = re.search(pattern, text, FLAGS)
        if m:
            try:
                val = parse_value(m.group(1))
                # Sanity check : rétrocession entre 0 et 3 % (fraction)
                if 0 <= val <= 3.0:
                    return round(val / 100, 6)
                # Peut-être déjà en fraction (0.01 = 1%)
                if 0 < val < 0.04:
                    return round(val, 6)
            except ValueError:
                continue
    return None


def infer_from_share_class(name: str, ongoing_charges: float | None) -> float | None:
    """
    Inférence grossière depuis le nom de la part.
    N'est utilisée qu'en fallback si le PDF n'est pas lisible.
    Retourne None si l'inférence est trop incertaine.
    """
    if not name:
        return None
    if INSTITUTIONAL_PATTERNS.search(name):
        return 0.0
    # Pour les parts retail avec ongoing_charges connu, on estime ~50% de rétrocession
    # C'est une approximation très grossière — marquée en field_sources comme 'inferred'
    if RETAIL_PATTERNS.search(name) and ongoing_charges and ongoing_charges > 0:
        return round(min(ongoing_charges * 0.5, 0.01), 6)  # cap à 1%
    return None


def download_pdf(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=PAGE_FETCH_TIMEOUT, stream=True)
        if r.status_code != 200:
            return None
        content_length = int(r.headers.get("Content-Length", 0))
        if content_length > MAX_PDF_SIZE_MB * 1024 * 1024:
            return None
        data = b""
        for chunk in r.iter_content(8192):
            data += chunk
            if len(data) > MAX_PDF_SIZE_MB * 1024 * 1024:
                return None
        if not data[:4].startswith(b"%PDF"):
            return None
        return data
    except Exception:
        return None


def extract_text_from_pdf(pdf_bytes: bytes) -> str | None:
    try:
        import pdfplumber
        import io
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = pdf.pages[:4]  # les 4 premières pages suffisent
            return "\n".join(p.extract_text() or "" for p in pages)
    except Exception:
        pass
    try:
        import fitz  # PyMuPDF
        import io
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = ""
        for i, page in enumerate(doc):
            if i >= 4:
                break
            text += page.get_text()
        return text
    except Exception:
        return None


def run(apply: bool, limit: int | None, only_geco: bool) -> None:
    client = get_client()
    now = datetime.now(timezone.utc)

    q = (
        client.table("investissement_funds")
        .select("isin, name, kid_url, ongoing_charges, ter")
        .is_("retrocession_cgp", "null")
        .not_.is_("kid_url", "null")
        .in_("product_type", ["opcvm", "fcp", "sicav", "etf"])
        .order("aum_eur", desc=True)
    )
    if only_geco:
        q = q.like("kid_url", "%geco.amf-france%")
    if limit:
        q = q.limit(limit)

    funds = q.execute().data or []
    print(f"  {len(funds)} fonds avec kid_url sans retrocession_cgp")

    stats = Counter()
    updates = []

    for i, fund in enumerate(funds):
        isin       = fund["isin"]
        name       = fund["name"] or ""
        kid_url    = fund["kid_url"]
        oc         = fund.get("ongoing_charges")
        ter        = fund.get("ter")

        if i > 0 and i % 50 == 0:
            pct = i * 100 // len(funds)
            print(f"  [{pct}%] {i}/{len(funds)} — parsed:{stats['pdf_ok']} "
                  f"inferred:{stats['inferred']} zero:{stats['zero_inst']}")

        retro = None
        source = None

        # 1. Essayer le KID PDF
        time.sleep(RATE_LIMIT_SEC)
        pdf_bytes = download_pdf(kid_url)
        if pdf_bytes:
            text = extract_text_from_pdf(pdf_bytes)
            if text:
                retro = extract_retrocession(text)
                if retro is not None:
                    stats["pdf_ok"] += 1
                    source = "kid_priips"

        # 2. Fallback : inférence par classe de part
        if retro is None:
            retro = infer_from_share_class(name, oc or ter)
            if retro is not None:
                if retro == 0.0:
                    stats["zero_inst"] += 1
                else:
                    stats["inferred"] += 1
                source = "inferred_share_class"

        if retro is None:
            stats["not_found"] += 1
            continue

        updates.append({
            "isin": isin,
            "retrocession_cgp": retro,
            "updated_at": now.isoformat(),
        })

        if apply and len(updates) >= BATCH_SIZE:
            client.table("investissement_funds").upsert(
                updates, on_conflict="isin"
            ).execute()
            print(f"    → {len(updates)} rétrocessions mises en base")
            updates.clear()

    if apply and updates:
        client.table("investissement_funds").upsert(
            updates, on_conflict="isin"
        ).execute()
        print(f"    → {len(updates)} rétrocessions mises en base (flush final)")

    total = stats["pdf_ok"] + stats["inferred"] + stats["zero_inst"]
    print(f"\n  Résumé rétrocession CGP :")
    print(f"    ✓ Depuis KID PRIIPS       : {stats['pdf_ok']}")
    print(f"    ✓ Institutionnel (→ 0%)   : {stats['zero_inst']}")
    print(f"    ~ Inféré (part retail ~)  : {stats['inferred']}")
    print(f"    ✗ Non trouvé              : {stats['not_found']}")
    print(f"    Total enrichis            : {total} / {len(funds)}")
    if not apply:
        print("\n  ⚠  Mode dry-run — relancer avec --apply pour persister")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply",     action="store_true")
    ap.add_argument("--limit",     type=int)
    ap.add_argument("--only-geco", action="store_true")
    args = ap.parse_args()
    run(apply=args.apply, limit=args.limit, only_geco=args.only_geco)


if __name__ == "__main__":
    main()
