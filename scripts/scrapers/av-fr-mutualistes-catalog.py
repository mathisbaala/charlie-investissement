#!/usr/bin/env python3
"""
av-fr-mutualistes-catalog.py — Référencement assureurs mutualistes (AV France)
==============================================================================
Comble le trou laissé par insurer-harvest-overnight.py, dont le crawl HTML
échoue sur ces assureurs (pages en 403 anti-bot / DataDome, ex. macif.fr,
mutavie.fr, macifvie.fr). Astuce qui marche : **les CDN PDF répondent même
quand la page HTML est bloquée**. On télécharge directement l'annexe / notice /
tableau de frais officiel, on extrait les ISIN (pdftotext -layout), et on ne
garde que les ISIN déjà présents dans investissement_funds.

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, jamais de
upsert de fonds (pas de risque d'écraser perfs/frais nettoyés). Idempotent.

⚠️ Après --apply, rafraîchir la matview du screener :
       REFRESH MATERIALIZED VIEW investissement_fund_insurers_mv;
   (les listes RPC get_insurers_list / get_contracts_list lisent l'eligibility
    en direct ; seul le filtre screener passe par la matview.)

Maintenance : ces URLs sont versionnées par année chez certains assureurs
(Afer, La France Mutualiste). Si une source renvoie 0 ISIN, vérifier l'URL sur
le site (souvent un millésime plus récent du même document).

Usage :
    python3 scripts/scrapers/av-fr-mutualistes-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-mutualistes-catalog.py --apply
"""
import sys, re, subprocess, tempfile, os, argparse
from datetime import datetime, timezone
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, refresh_fund_insurers_mv

H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")

# (company_name, contract_name, source_url) — un contrat distinct du company
# pour qu'il apparaisse aussi dans get_contracts_list (qui exclut contract=company).
# Sources vérifiées le 2026-06-11 (PDF directs, CDN non bloqués).
CATALOG: list[tuple[str, str, str]] = [
    ("Macif Vie", "Macif Épargne Vie",
     "https://www.macif.fr/files/live/sites/maciffr/files/conditions_generales_banque/NI-MacifEpargneVie.pdf"),
    ("Afer", "Afer Multisupport",
     "https://www.afer.fr/content/uploads/2023/02/annexe-liste-des-supports-eligibles-au-contrat.pdf"),
    ("Afer", "Afer Génération",
     "https://www.afer.fr/content/uploads/2025/02/annexe-financire-afer-gnration.pdf"),
    ("Agipi", "Agipi CLER",
     "https://infos.agipi.com/wp-content/uploads/2021/09/Notice-de-presentation-des-supports-CLEF-CLER-FAR-PAIR_Mars2021.pdf"),
    ("Maif", "Assurance Vie Responsable et Solidaire",
     "https://www.maif.fr/files/live/sites/maif-fr/files/pdf/particuliers/epargne-financements/publication-informations-durabilite-ars.pdf"),
    ("Carac", "Carac Profiléo",
     "https://www.carac.fr/media/Docs_PDF/RM010_Reglement_Mutualiste_Carac%20Profileo_090424_VF%20(1).pdf"),
    ("Carac", "Carac Épargne Patrimoine",
     "https://www.carac.fr/media/Docs_PDF/RM020_Reglement%20Mutualiste%20CEPAT%20LIV_20122024_VF.pdf"),
    ("La France Mutualiste", "Actépargne2",
     "https://www.la-france-mutualiste.fr/sites/default/files/paragraph/files/2023-09/Tableau%20de%20frais%20ACTEPARGNE%202%20-%20juin%202023.pdf"),
]

# Assureurs sans source ISIN exploitable hors navigateur / portail client
# (annexe en image sans table ISIN, ou liste UC en page JS) : MIF, Matmut,
# Le Conservateur. À traiter via un vrai navigateur si besoin (cf. /browse).


def fetch(url: str) -> tuple[bytes, str]:
    """Télécharge l'URL. Retombe sur curl si requests échoue en SSL/connexion
    (certains hôtes, ex. la-france-mutualiste.fr, n'envoient pas la chaîne
    intermédiaire que certifi exige — curl, lui, la résout). Retourne
    (content, content_type)."""
    try:
        r = requests.get(url, headers=H, timeout=60, allow_redirects=True)
        return r.content, r.headers.get("content-type", "")
    except (requests.exceptions.SSLError, requests.exceptions.ConnectionError):
        out = subprocess.run(["curl", "-sSL", "--max-time", "60", "-A", H["User-Agent"], url],
                             capture_output=True, timeout=70).stdout
        return out, ""


def isins_from_pdf(content: bytes) -> set[str]:
    try:
        f = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        f.write(content); f.close()
        txt = subprocess.run(["pdftotext", "-layout", f.name, "-"],
                             capture_output=True, text=True, timeout=90).stdout
        os.unlink(f.name)
        return set(ISIN_RE.findall(txt))
    except Exception as e:
        print(f"    pdftotext KO : {str(e)[:60]}")
        return set()


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
    print(f"ISIN en base : {len(known)}\n")

    rows: list[tuple[str, str, str]] = []  # (isin, company, contract)
    for company, contract, url in CATALOG:
        try:
            content, ct = fetch(url)
            if "pdf" in ct or url.lower().endswith(".pdf") or content[:4] == b"%PDF":
                found = isins_from_pdf(content)
            else:
                found = set(ISIN_RE.findall(content.decode("utf-8", "ignore")))  # source HTML éventuelle
        except Exception as e:
            print(f"  {company} / {contract[:30]:30} ERR {str(e)[:50]}")
            continue
        kept = sorted(found & known)
        for x in kept:
            rows.append((x, company, contract))
        flag = "" if kept else "  ⚠️ 0 en base — vérifier l'URL/millésime"
        print(f"  {company:22} {contract[:34]:34} {len(found):5} ISIN, {len(kept):5} en base{flag}")

    companies = sorted({c for _, c, _ in rows})
    print(f"\nTotal : {len(rows)} lignes éligibilité | {len(companies)} assureurs : {', '.join(companies)}")

    if not args.apply:
        print("\nDRY-RUN — rien écrit. Relancer avec --apply.")
        return

    now = datetime.now(timezone.utc).isoformat()
    by_url = {f"{c}::{ct}": u for c, ct, u in CATALOG}
    batch, ok = [], 0
    for isin, company, contract in rows:
        batch.append({"isin": isin, "company_name": company, "contract_name": contract,
                      "source_url": by_url.get(f"{company}::{contract}"), "scraped_at": now})
        if len(batch) >= 200:
            client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
            ok += len(batch); batch = []
    if batch:
        client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)
    print(f"\nÉligibilité écrite : {ok} lignes.")
    # Propage le nouveau référencement à la matview lue par le screener.
    if refresh_fund_insurers_mv():
        print("✓ matview investissement_fund_insurers_mv rafraîchie.")


if __name__ == "__main__":
    main()
