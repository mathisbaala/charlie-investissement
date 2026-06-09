#!/usr/bin/env python3
"""
av-fr-spirica-catalog.py — Référencement Spirica (AV France)
=============================================================
Source : annexes financières PDF Spirica/Sylvéa, listées sur
  https://www.spirica.fr/performances-et-frais-associes-des-unites-de-compte/
  → https://www.sylvea.fr/sylvea/produits/{id}/historique/{annee}/annexeFI.pdf

ÉLIGIBILITÉ-ONLY : n'écrit QUE dans investissement_av_lux_eligibility, et
UNIQUEMENT pour les ISIN déjà présents dans investissement_funds. N'insère ni
ne met à jour aucun fonds (zéro risque d'écraser perfs/frais nettoyés).

Usage :
    python3 scripts/scrapers/av-fr-spirica-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-spirica-catalog.py --apply
    python3 scripts/scrapers/av-fr-spirica-catalog.py --open-only --apply
"""
import sys, re, html as ihtml, subprocess, tempfile, os, time, argparse
from datetime import datetime, timezone
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

COMPANY = "Spirica"
PERF_URL = "https://www.spirica.fr/performances-et-frais-associes-des-unites-de-compte/"
H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")


def list_contracts(open_only: bool) -> list[tuple[str, str]]:
    """Retourne [(product_id, contract_name)] depuis la page perfs/frais."""
    t = requests.get(PERF_URL, headers=H, timeout=40).text
    i_closed = t.lower().find("ferm")
    out, seen = [], set()
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        m = re.search(r"produits/(\d+)/historique/\d+/annexeFI", row)
        if not m:
            continue
        pid = m.group(1)
        if pid in seen:
            continue
        if open_only and t.find(row) >= i_closed >= 0:
            continue
        name = None
        for td in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S):
            txt = ihtml.unescape(re.sub(r"<[^>]+>", "", td)).strip()
            if txt and "annexe" not in txt.lower() and len(txt) > 3 and not txt.replace(" ", "").isdigit():
                name = txt
                break
        seen.add(pid)
        out.append((pid, name or f"Contrat Spirica {pid}"))
    return out


def fetch_isins(pid: str) -> tuple[list[str], str]:
    """Télécharge l'annexe (2026 puis 2025) et extrait les ISIN. Retourne (isins, url)."""
    for yr in ("2026", "2025"):
        url = f"https://www.sylvea.fr/sylvea/produits/{pid}/historique/{yr}/annexeFI.pdf"
        try:
            r = requests.get(url, headers=H, timeout=40)
            if r.ok and r.content[:4] == b"%PDF":
                f = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                f.write(r.content); f.close()
                txt = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True).stdout
                os.unlink(f.name)
                return sorted(set(ISIN_RE.findall(txt))), url
        except Exception as e:
            print(f"    {pid}/{yr} err {str(e)[:50]}")
    return [], ""


def existing_isins(client) -> set[str]:
    """Ensemble des ISIN déjà en base (pagination)."""
    s, off = set(), 0
    while True:
        rows = client.table("investissement_funds").select("isin").range(off, off + 999).execute().data
        if not rows:
            break
        s.update(r["isin"] for r in rows)
        off += 1000
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--open-only", action="store_true", help="contrats ouverts à la commercialisation uniquement")
    args = ap.parse_args()

    contracts = list_contracts(args.open_only)
    print(f"Contrats Spirica : {len(contracts)} ({'ouverts' if args.open_only else 'tous'})")

    client = get_client()
    known = existing_isins(client)
    print(f"ISIN en base : {len(known)}")

    rows = []          # (isin, contract_name, url)
    union = set()
    for i, (pid, name) in enumerate(contracts):
        isins, url = fetch_isins(pid)
        kept = [x for x in isins if x in known]
        union.update(kept)
        for x in kept:
            rows.append((x, name, url))
        print(f"  [{i+1}/{len(contracts)}] {name[:40]:40} {len(isins):5} ISIN, {len(kept):5} en base")
        time.sleep(0.3)

    print(f"\nUnion ISIN Spirica (en base) : {len(union)} | lignes éligibilité : {len(rows)}")

    if not args.apply:
        print("DRY-RUN — rien écrit. Relancer avec --apply.")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = 0
    batch = []
    for isin, name, url in rows:
        batch.append({"isin": isin, "company_name": COMPANY, "contract_name": name,
                      "source_url": url, "scraped_at": now})
        if len(batch) >= 200:
            client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
            ok += len(batch); batch = []
    if batch:
        client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)
    print(f"Éligibilité écrite : {ok} lignes ({len(union)} fonds Spirica distincts).")


if __name__ == "__main__":
    main()
