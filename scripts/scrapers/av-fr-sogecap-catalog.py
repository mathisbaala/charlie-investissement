#!/usr/bin/env python3
"""
av-fr-sogecap-catalog.py — Référencement Sogécap (Société Générale Assurances)
===============================================================================
Sogécap (SG Assurances, ~100 Md€ d'encours, réseau SG) publie un portail PRIIPS
statique — un seul HTML (~730 Ko) avec l'arbre complet contrat → mode de
gestion → supports :
  https://priips.sogecap.com/priips/sogecap.html
Chaque support : <li … cdproduit="00216" … cdisine="FR0011443233"> ; le nom du
contrat est dans le <div class="prs_tree_label_produit"> qui précède. Régénéré
quotidiennement (Last-Modified), servi sans anti-bot. Le même portail héberge le
jumeau Oradéa Vie (oradea.html — cf. av-fr-oradea-catalog.py, ressuscité 16/07).

11 contrats au repérage 2026-07-16 (~428 ISIN distincts) : Séquoia, Érable
Essentiel, Ébène (+Capi), Sogécapi Patrimoine/PM II, PEP, gamme SG Gestion
Privée, « Société Générale Assurances Vie ». Les fonds euros ont des codes
internes non-ISIN (FRSGK…) écartés par la clé de contrôle.

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-fr-sogecap-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-sogecap-catalog.py --apply
"""

import re
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, extract_isins, fetch_pdf_text, make_session, _valid_isin  # noqa: E402

PORTAL_URL = "https://priips.sogecap.com/priips/sogecap.html"
COMPANY    = "Sogécap"

# Contrats ABSENTS du portail PRIIPS mais dotés d'un « Document des performances »
# loi PACTE annuel (ISIN + frais + rétrocessions). URL re-millésimée chaque année
# → découverte sur la page index, repli sur la dernière édition connue.
PERF_INDEX_URL = ("https://www.assurances.societegenerale.com/en/investor-journalist/about/"
                  "our-entities/our-entities-france/sogecap/performance-and-fee-documents-for-contracts/")
EXTRA_PDF_CONTRACTS = [
    # (nom de contrat, motif du lien sur la page index, URL de repli)
    ("PER Acacia", r'href="([^"]*Doc_Perf_PER_Acacia[^"]*\.pdf)"',
     "https://www.assurances.societegenerale.com/fileadmin/2025/Documents_des_performances_et_frais_de_contrat/Doc_Perf_PER_Acacia_2025.pdf"),
]


def fetch_extra_pdf_contracts(session) -> list[tuple[str, list[str]]]:
    """Contrats hors portail via leur Doc_Perf loi PACTE (PDF → ISIN).

    La page index est derrière Imperva/Incapsula mais laisse passer curl_cffi
    aujourd'hui ; en cas de blocage on retombe sur l'URL de la dernière édition.
    """
    index_html = ""
    try:
        r = session.get(PERF_INDEX_URL, timeout=60)
        if r.status_code == 200:
            index_html = r.text or ""
    except Exception as e:
        print(f"      ⚠ index Doc_Perf : {str(e)[:60]} → replis")
    out = []
    for name, pattern, fallback in EXTRA_PDF_CONTRACTS:
        m = re.search(pattern, index_html)
        url = m.group(1) if m else fallback
        if not url.startswith("http"):
            # TYPO3 sert des liens racine-relatifs SANS slash initial (fileadmin/…)
            url = "https://www.assurances.societegenerale.com/" + url.lstrip("/")
        text = fetch_pdf_text(session, url)
        isins = [x for x in extract_isins(text or "") if _valid_isin(x)]
        out.append((name, isins))
    return out

LABEL_RE = re.compile(r'<div class="prs_tree_label_produit">\s*([^<]*?)\s*\*?\s*</div>')
LI_RE    = re.compile(r'cdproduit="(\w+)"[^>]*?cdisine="([A-Z0-9]+)"')
TIMEOUT  = 60


def parse_portal(html: str) -> list[tuple[str, list[str]]]:
    """[(nom de contrat, [isins])] depuis l'arbre PRIIPS (label → cdproduit).

    Le nom de produit précède la 1re occurrence de son cdproduit ; on associe
    chaque code au dernier label rencontré avant lui, puis on collecte les
    paires (cdproduit, cdisine) des <li> supports.
    """
    labels = [(m.start(), " ".join(m.group(1).split())) for m in LABEL_RE.finditer(html)]
    code_name: dict[str, str] = {}
    code_isins: dict[str, set[str]] = {}
    for m in LI_RE.finditer(html):
        code, isin = m.group(1), m.group(2).upper()
        if code not in code_name:
            prior = [name for pos, name in labels if pos < m.start()]
            code_name[code] = prior[-1] if prior else f"Produit {code}"
        if _valid_isin(isin):
            code_isins.setdefault(code, set()).add(isin)
    return [(code_name[c], sorted(s)) for c, s in sorted(code_isins.items()) if s]


def run(apply: bool, limit: int | None, *, portal_url: str = PORTAL_URL,
        company: str = COMPANY, scraper_name: str = "av-fr-sogecap-catalog",
        with_extra_pdfs: bool = False):
    print("=" * 64)
    print(f"  {company} — portail PRIIPS {portal_url.rsplit('/', 1)[-1]}")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    session = make_session()
    try:
        r = session.get(portal_url, timeout=TIMEOUT)
    except Exception as e:
        print(f"  ✗ fetch : {str(e)[:80]}")
        if apply:
            log_run(scraper_name, "failed", 0, 0, started_at=started)
        return
    if r.status_code != 200:
        print(f"  ✗ HTTP {r.status_code}")
        if apply:
            log_run(scraper_name, "failed", 0, 0, started_at=started)
        return

    contracts = parse_portal(r.text or "")
    if with_extra_pdfs:
        contracts += fetch_extra_pdf_contracts(session)
    if limit:
        contracts = contracts[:limit]
    for i, (name, isins) in enumerate(contracts):
        print(f"  [{i+1}/{len(contracts)}] {name[:46]:46} {len(isins):5} ISIN")
    union = sorted({x for _, isins in contracts for x in isins})
    print(f"\n  Contrats : {len(contracts)} | union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — portail déplacé ou structure changée.")
        if apply:
            log_run(scraper_name, "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for contract_name, isins in contracts:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": company, "contract_name": contract_name,
                "source_url": portal_url, "scraped_at": now,
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
    log_run(scraper_name, "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sogécap — catalogue UC (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, with_extra_pdfs=True)
