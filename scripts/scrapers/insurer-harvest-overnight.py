#!/usr/bin/env python3
"""
insurer-harvest-overnight.py — Récolte autonome du référencement assureur
==========================================================================
Pour chaque assureur candidat : explore ses pages (annexes/supports/PRIIPS),
suit les liens PDF/sous-pages (1 niveau), extrait les ISIN, et écrit en base
UNIQUEMENT le référencement (table investissement_av_lux_eligibility) pour les
ISIN déjà présents dans investissement_funds.

SAFE : aucune écriture/upsert de fonds. Idempotent (on_conflict). Tourne longtemps.

Usage : python3 scripts/scrapers/insurer-harvest-overnight.py [--apply]
"""
import sys, re, subprocess, tempfile, os, time, argparse
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
LOG = Path(__file__).parent.parent / "harvest-overnight.log"

# (company, [seed urls]) — l'explorateur suit les liens annexe/support/financiere/pdf.
CANDIDATES: list[tuple[str, list[str]]] = [
    ("MIF", ["https://www.mif.fr/documents-reglementaires", "https://www.mif.fr/nos-supports"]),
    ("Le Conservateur", ["https://www.conservateur.fr/documentation-reglementaire/", "https://www.conservateur.fr/nos-supports/"]),
    ("Carac", ["https://www.carac.fr/documentation-reglementaire", "https://www.carac.fr/supports-unites-de-compte"]),
    ("Ampli Mutuelle", ["https://www.ampli.fr/documents-reglementaires/"]),
    ("GMF / Covéa", ["https://www.gmf.fr/assurance-vie/supports-unites-de-compte"]),
    ("Maif", ["https://www.maif.fr/epargne-patrimoine/assurance-vie/supports"]),
    ("Macif / Mutavie", ["https://www.macif.fr/assurance/particuliers/epargne/assurance-vie/supports-uc"]),
    ("Matmut", ["https://www.matmut.fr/epargne/assurance-vie/supports"]),
    ("Gaipare", ["https://www.gaipare.com/documentation/", "https://www.gaipare.com/supports/"]),
    ("Asac-Fapes", ["https://www.asac-fapes.fr/documents-reglementaires/"]),
    ("Afer", ["https://afer.fr/documentation-reglementaire/", "https://afer.fr/supports-financiers/"]),
    ("Agipi", ["https://www.agipi.com/documentation-reglementaire/"]),
    ("Mutavie", ["https://www.mutavie.fr/documents-reglementaires"]),
    ("La France Mutualiste", ["https://www.la-france-mutualiste.fr/documents-reglementaires/"]),
    ("Smavie BTP", ["https://www.smabtp.fr/documents-reglementaires"]),
    ("Monceau Assurances", ["https://www.monceauassurances.com/documentation-reglementaire/"]),
    ("Garantie Mutuelle des Fonctionnaires", ["https://www.gmf.fr/documents-reglementaires"]),
    ("Prepar Vie", ["https://www.prepar-vie.fr/documents-reglementaires"]),
    ("Sogecap", ["https://www.assurances.societegenerale.com/fr/documents-reglementaires/"]),
    ("Predica", ["https://www.ca-assurances.com/documentation-reglementaire"]),
]


def log(msg: str):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def isins_from_pdf(content: bytes) -> list[str]:
    try:
        f = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        f.write(content); f.close()
        txt = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True, timeout=60).stdout
        os.unlink(f.name)
        return list(set(ISIN_RE.findall(txt)))
    except Exception:
        return []


def harvest_company(company: str, seeds: list[str], known: set[str]) -> set[str]:
    found: set[str] = set()
    visited: set[str] = set()
    queue = list(seeds)
    pages = 0
    while queue and pages < 40:
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)
        pages += 1
        try:
            r = requests.get(url, headers=H, timeout=25, allow_redirects=True)
        except Exception:
            continue
        ct = r.headers.get("content-type", "")
        if "pdf" in ct or url.lower().endswith(".pdf") or r.content[:4] == b"%PDF":
            found.update(isins_from_pdf(r.content))
            continue
        if not r.ok:
            continue
        body = r.text
        if "just a moment" in body.lower() or "attention required" in body.lower():
            log(f"  {company}: Cloudflare sur {url[:50]} — skip")
            return found
        found.update(ISIN_RE.findall(body))
        # suivre les liens pertinents (annexe/support/financiere/priips/.pdf)
        for href in re.findall(r'href="([^"]+)"', body):
            absu = urljoin(url, href)
            if absu in visited or absu in queue:
                continue
            if re.search(r"\.pdf|annexe|support|financ|priips|unite|reglementaire|documents", absu, re.I) \
               and absu.startswith("http") and len(queue) < 60:
                queue.append(absu)
        time.sleep(0.4)
    return {x for x in found if x in known}


def existing_isins(client) -> set[str]:
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
    args = ap.parse_args()
    client = get_client()
    known = existing_isins(client)
    log(f"=== Harvest start | ISIN base={len(known)} | apply={args.apply} ===")
    now = datetime.now(timezone.utc).isoformat()
    total_new = 0
    for company, seeds in CANDIDATES:
        try:
            isins = harvest_company(company, seeds, known)
        except Exception as e:
            log(f"  {company}: ERR {str(e)[:60]}")
            continue
        if len(isins) < 5:
            log(f"  {company}: {len(isins)} ISIN — ignoré (source vide/bloquée)")
            continue
        log(f"  {company}: {len(isins)} fonds en base ✓")
        if args.apply:
            rows = [{"isin": x, "company_name": company, "contract_name": company,
                     "source_url": seeds[0], "scraped_at": now} for x in isins]
            for i in range(0, len(rows), 200):
                client.table("investissement_av_lux_eligibility").upsert(rows[i:i+200], on_conflict="isin,contract_name").execute()
            total_new += len(isins)
    log(f"=== Harvest done | total fonds écrits={total_new} ===")


if __name__ == "__main__":
    main()
