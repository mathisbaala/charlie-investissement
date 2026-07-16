#!/usr/bin/env python3
"""
av-lux-sogelife-catalog.py — Catalogue UC Sogelife S.A. (LPS France)
=====================================================================
Sogelife S.A. (Société Générale Assurances, Luxembourg) publie sur
sogelife.com/en/our-solutions/priips/france/ un ZIP PRIIPS par contrat :
  https://doc.sogelife.com/priips/<code>.zip
Chaque ZIP contient 1 KID produit + 1 DIS par support nommé
  S_<ISIN>_<FR|EN>_<date>.pdf
→ la liste complète des UC se déduit des seuls NOMS DE FICHIERS, sans parser
les PDF (FR01SGVIE : ~765 ISIN ; les fonds internes FID/FIC/FAS ont des codes
non-ISIN, ignorés).

⚠️ Les ZIP pèsent jusqu'à ~230 Mo : le serveur supporte les requêtes Range
(HTTP 206 vérifié au repérage 2026-07-16) → on ne lit que le répertoire central
du ZIP (fin de fichier, ~100 Ko) et on y regexe les noms S_<ISIN>_. Repli :
téléchargement complet si le Range n'est plus honoré. Piège : HEAD renvoie une
page HTML trompeuse — toujours GET.

BoursoVie Lux (aussi assuré par Sogelife) : pas de liste de supports publique
(univers ~4 000 lignes du courtier en ligne) — non référencé ici.

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-lux-sogelife-catalog.py            # dry-run
    python3 scripts/scrapers/av-lux-sogelife-catalog.py --apply
"""

import re
import sys
import time
import struct
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session, _valid_isin  # noqa: E402

SOURCE_PAGE = "https://www.sogelife.com/en/our-solutions/priips/france/"
ZIP_BASE    = "https://doc.sogelife.com/priips"

COMPANY = "Sogelife"

# (nom de contrat, code ZIP) — cf. page PRIIPS France de sogelife.com.
CONTRACTS = [
    ("Sogelife Personal Multisupports",                "FR01SGVIE"),
    ("Sogelife Personal Multisupports Capitalisation", "FR01SGCAP"),
    ("Sogelife Private Selection",                     "L021TP3-VIE"),
    ("Sogelife Target FR Vie",                         "L021TP4-VIE"),
    ("Sogelife Target FR Capi",                        "L021TP4-CAP"),
]

# Nom de fichier DIS dans le ZIP : S_<ISIN>_<lang>_<date>.pdf
DIS_ISIN_RE = re.compile(rb"S_([A-Z]{2}[A-Z0-9]{9}\d)_")
EOCD_SIG    = b"PK\x05\x06"   # End Of Central Directory (ZIP)
TIMEOUT     = 120
RATE        = 1.0
TAIL_BYTES  = 65536           # fenêtre de recherche de l'EOCD en fin de fichier


def _get_range(session, url: str, rng: str) -> bytes | None:
    """GET avec en-tête Range ; None si le serveur ne renvoie pas 206."""
    try:
        r = session.get(url, headers={"Range": f"bytes={rng}"}, timeout=TIMEOUT)
    except Exception as e:
        print(f"      ⚠ Range {rng} : {str(e)[:60]}")
        return None
    if r.status_code != 206:
        return None
    return r.content


def _central_directory(session, url: str) -> bytes | None:
    """Répertoire central du ZIP via 2 requêtes Range (EOCD → cd_offset/size)."""
    tail = _get_range(session, url, f"-{TAIL_BYTES}")
    if not tail:
        return None
    pos = tail.rfind(EOCD_SIG)
    if pos < 0 or len(tail) - pos < 22:
        print("      ⚠ EOCD introuvable dans les derniers octets")
        return None
    # EOCD : sig(4) disk(2) cd_disk(2) n_disk(2) n_total(2) cd_size(4) cd_offset(4)
    cd_size, cd_offset = struct.unpack("<II", tail[pos + 12: pos + 20])
    if cd_size == 0xFFFFFFFF or cd_offset == 0xFFFFFFFF:
        print("      ⚠ ZIP64 non géré → repli téléchargement complet")
        return None
    return _get_range(session, url, f"{cd_offset}-{cd_offset + cd_size - 1}")


def fetch_contract_isins(session, zip_code: str) -> list[str]:
    """ISIN distincts d'un ZIP PRIIPS via les noms de fichiers DIS.

    Priorité au répertoire central (Range) ; repli : GET complet (lourd mais
    fonctionnel), en régexant directement le flux (les noms de fichiers sont
    aussi dans les en-têtes locaux, non compressés).
    """
    url = f"{ZIP_BASE}/{zip_code}.zip"
    blob = _central_directory(session, url)
    if blob is None:
        print(f"      ↻ Range indisponible → téléchargement complet {zip_code}.zip")
        try:
            r = session.get(url, timeout=600)
            blob = r.content if r.status_code == 200 else b""
        except Exception as e:
            print(f"      ⚠ GET {zip_code}.zip : {str(e)[:60]}")
            blob = b""
    raw = {m.decode("ascii") for m in DIS_ISIN_RE.findall(blob or b"")}
    return sorted(x for x in raw if _valid_isin(x))


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print(f"  {COMPANY} — ZIP PRIIPS doc.sogelife.com (catalogue UC par contrat)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    contracts = CONTRACTS[:limit] if limit else CONTRACTS
    session = make_session()

    per_contract: list[tuple[str, list[str]]] = []
    for i, (name, code) in enumerate(contracts):
        isins = fetch_contract_isins(session, code)
        print(f"  [{i+1}/{len(contracts)}] {name[:46]:46} {len(isins):5} ISIN")
        per_contract.append((name, isins))
        time.sleep(RATE)

    union = sorted({x for _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — ZIP déplacés ou nommage DIS changé.")
        if apply:
            log_run("av-lux-sogelife-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  Aperçu (10 premiers ISIN) :", ", ".join(union[:10]))
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for contract_name, isins in per_contract:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": COMPANY, "contract_name": contract_name,
                "source_url": SOURCE_PAGE, "scraped_at": now,
            })
            if len(batch) >= 200:
                client.table("investissement_av_lux_eligibility") \
                    .upsert(batch, on_conflict="isin,contract_name").execute()
                ok += len(batch)
                batch = []
    if batch:
        client.table("investissement_av_lux_eligibility") \
            .upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} ISIN bruts avant filtre).")
    log_run("av-lux-sogelife-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sogelife — catalogue UC (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
