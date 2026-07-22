#!/usr/bin/env python3
"""
gvfm-fonds-euros-harvest.py — taux des fonds en euros (multi-année) depuis
Good Value for Money → migration de seed pour investissement_av_fonds_euros_history.
============================================================================
La table d'historique des taux de fonds euros est VIDE : le bloc « Rendement des
fonds euros » (courbe pluriannuelle) des fiches assureur/contrat ne s'affiche donc
jamais. GVfM publie EN ACCÈS LIBRE le taux servi de 200+ contrats par année depuis
2018 — source homogène, déjà citée par le projet (fonds-euros-seed.py).

La page « tableau-de-suivi-du-rendement-des-fonds-en-euros » est du HTML formaté :
  • en-tête de contrat en rouge (#c00000) : « NomContrat (Plateforme x Assureur) »
  • nom du fonds euros en vert (#003300)
  • lignes « Taux servi en AAAA : X,XX % »
On rattache chaque taux au fonds euros courant et à l'ASSUREUR (extrait du « x … »),
on mappe vers les clés `company` de investissement_av_insurer_profiles, on
dédoublonne par (company, fonds_euros_nom, année) au taux de base modal, et on émet
un INSERT ... ON CONFLICT idempotent. confidence='presse', source_url=GVfM.

Usage : python3 scripts/scrapers/gvfm-fonds-euros-harvest.py
        → écrit supabase/migrations/<ts>_seed_av_fonds_euros_history_gvfm.sql
Aucune écriture en base (le projet applique les migrations via son pipeline).
"""

import urllib.request, ssl, re, html as ihtml, sys
from collections import Counter, defaultdict
from pathlib import Path

URL = "https://www.goodvalueformoney.eu/documentation/tableau-de-suivi-du-rendement-des-fonds-en-euros"
MIN_YEAR = 2019  # trajectoire lisible sans gonfler la migration

# Nom d'assureur GVfM (partie après « x ») → clé `company` du projet.
INSURER_MAP = {
    "Suravenir": "Suravenir",
    "Spirica": "Spirica",
    "CNP Assurances": "CNP Assurances",
    "Generali Vie": "Generali Vie",
    "ACM Vie": "ACM Vie",
    "Prédica": "Predica",
    "Groupama Gan Vie": "Groupama Gan Vie",
    "Oradéa Vie": "Oradéa Vie",
    "Apicil Epargne": "APICIL",
    "Apicil Epargne Retraite": "APICIL",
    "La Mondiale Partenaire": "AG2R La Mondiale",
    "Allianz Vie": "Allianz France",
    "Cardif Vie": "BNP Paribas Cardif",
    "BNP Paribas Cardif": "BNP Paribas Cardif",
    "Abeille Vie": "Abeille Vie",
    "SwissLife Assurance et Patrimoine": "SwissLife France",
    "Swiss Life Ass. Et Patrimoine": "SwissLife France",
    "AXA France Vie": "AXA France",
    "Axa France Vie": "AXA France",
    "AXA France": "AXA France",
    "MMA Vie": "MMA Vie",
    "La France Mutualiste": "La France Mutualiste",
    "Carac": "Carac",
    "MAIF Vie": "Maif",
}


def fetch(url):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, context=ctx, timeout=60).read().decode("utf-8", "ignore")


def clean_fund(name):
    # « Fonds Suravenir Rendement (fonds en euros classique) » → « Suravenir Rendement »
    n = re.sub(r"\s+", " ", name or "").strip()
    n = re.sub(r"^Fonds\s+", "", n, flags=re.I)
    n = n.split("(")[0].strip()
    return n[:80]


def parse(raw):
    s = re.sub(r"<span[^>]*color:#c00000[^>]*>", "\n@C@", raw, flags=re.I)
    s = re.sub(r"<span[^>]*color:#003300[^>]*>", "\n@F@", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = ihtml.unescape(s)
    contract = fund = insurer = None
    rows = []
    for l in s.split("\n"):
        l = re.sub(r"\s+", " ", l).strip()
        if l.startswith("@C@"):
            contract = l[3:].strip()
            fund = None
            m = re.search(r"\(([^()]*?)\bx\s+([^()]+)\)", contract)
            insurer = re.sub(r"\s+", " ", m.group(2)).strip() if m else None
        elif l.startswith("@F@"):
            fund = clean_fund(l[3:])
        for m in re.finditer(r"[Tt]aux servi en (20\d{2})\s*:?\s*([0-9]+,[0-9]+)\s*%", l):
            year = int(m.group(1))
            rate = float(m.group(2).replace(",", "."))
            comp = INSURER_MAP.get(insurer or "")
            if comp and fund and year >= MIN_YEAR and 0 < rate < 10:
                rows.append((comp, fund, year, rate))
    return rows


def dedup(rows):
    # (company, fund, year) → taux de base modal (le plus fréquent parmi les contrats).
    buckets = defaultdict(list)
    for comp, fund, year, rate in rows:
        buckets[(comp, fund, year)].append(rate)
    out = {}
    for key, rates in buckets.items():
        out[key] = Counter(rates).most_common(1)[0][0]
    return out


def emit_sql(dedup_rows):
    lines = []
    for (comp, fund, year), rate in sorted(dedup_rows.items()):
        c = comp.replace("'", "''")
        f = fund.replace("'", "''")
        lines.append(
            f"  ('{c}', '{f}', {year}, {rate:.2f}, true, "
            f"'{URL}', 'presse')"
        )
    body = ",\n".join(lines)
    return f"""-- ============================================================================
-- Seed investissement_av_fonds_euros_history — taux des fonds en euros (multi-année)
-- ----------------------------------------------------------------------------
-- Table jusqu'ici VIDE → le bloc « Rendement des fonds euros » (courbe pluriannuelle
-- des fiches assureur/contrat) ne s'affichait pour personne. Rempli depuis Good
-- Value for Money (accès libre, source homogène déjà citée par le projet), généré
-- par scripts/scrapers/gvfm-fonds-euros-harvest.py. Taux servis nets de frais de
-- gestion (net_de_frais=true), bruts de prélèvements sociaux/fiscaux. confidence
-- ='presse'. Dédoublonné par (company, fonds_euros_nom, année) au taux de base modal.
-- Idempotent (ON CONFLICT). Purement additif.
-- ============================================================================

BEGIN;

INSERT INTO public.investissement_av_fonds_euros_history
  (company, fonds_euros_nom, annee, taux_pct, net_de_frais, source_url, confidence)
VALUES
{body}
ON CONFLICT (company, fonds_euros_nom, annee) DO UPDATE SET
  taux_pct     = EXCLUDED.taux_pct,
  net_de_frais = EXCLUDED.net_de_frais,
  source_url   = EXCLUDED.source_url,
  confidence   = EXCLUDED.confidence,
  updated_at   = now();

COMMIT;
"""


def main():
    raw = fetch(URL)
    rows = parse(raw)
    dd = dedup(rows)
    comps = Counter(k[0] for k in dd)
    print(f"taux bruts: {len(rows)}  |  lignes dédoublonnées: {len(dd)}", file=sys.stderr)
    print("par assureur:", dict(comps.most_common()), file=sys.stderr)
    out = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20260721160000_seed_av_fonds_euros_history_gvfm.sql"
    out.write_text(emit_sql(dd))
    print(f"→ écrit {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
