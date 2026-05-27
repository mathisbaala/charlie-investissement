#!/usr/bin/env python3
"""
normalize-management-company.py — Normalisation des sociétés de gestion
=========================================================================
854 variantes brutes (ex: "AMUNDI ASSET MANAGEMENT" vs "Amundi Asset Management"
vs "AMUNDI") → ~300 entités canoniques via :
  1. Casse uniforme (Title Case)
  2. Suppression suffixes redondants (Asset Management, AM, SA, SAS, etc.)
  3. Mapping vers nom canonique (groupe principal)

Écrit dans `management_company_normalized` (préserve la valeur brute).

Usage :
    python3 scripts/migrations/normalize-management-company.py [--apply]
"""

import sys
import re
import argparse
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Mappings canoniques (groupes principaux) ─────────────────────────────────
# Format: (regex_keyword, canonical_name)
# L'ordre compte — premier match gagne.

CANONICAL_MAP = [
    # Tier 1 — Asset managers majeurs
    (r"amundi",            "Amundi"),
    (r"black\s*rock|ishares", "BlackRock"),
    (r"bnp\s*paribas",     "BNP Paribas AM"),
    (r"credit\s*mutuel|cm[\-_ ]?am|cmcic|cm\s+cic", "Crédit Mutuel AM"),
    (r"natixis",           "Natixis IM"),
    (r"oddo\s*bhf",        "ODDO BHF"),
    (r"ofi\s*invest",      "OFI Invest AM"),
    (r"lyxor",             "Lyxor (Amundi)"),
    (r"rothschild",        "Rothschild & Co AM"),
    (r"carmignac",         "Carmignac"),
    (r"comgest",           "Comgest"),
    (r"dnca",              "DNCA"),
    (r"sycomore",          "Sycomore AM"),
    (r"tikehau",           "Tikehau Capital"),
    (r"edmond\s*de\s*rothschild", "Edmond de Rothschild AM"),
    (r"jp\s*morgan|jpmorgan", "J.P. Morgan AM"),
    (r"goldman\s*sachs",   "Goldman Sachs AM"),
    (r"morgan\s*stanley",  "Morgan Stanley IM"),
    (r"pictet",            "Pictet AM"),
    (r"vanguard",          "Vanguard"),
    (r"state\s*street|spdr", "State Street SPDR"),
    (r"invesco",           "Invesco"),
    (r"fidelity",          "Fidelity IM"),
    (r"schroder",          "Schroders"),
    (r"ubs\s+asset|ubs\s+am|ubs\s+investment", "UBS AM"),
    (r"deutsche\s+bank|dws", "DWS (Deutsche Bank)"),
    (r"hsbc",              "HSBC AM"),
    (r"axa",               "AXA IM"),
    (r"allianz",           "Allianz GI"),
    (r"groupama",          "Groupama AM"),
    (r"la\s*banque\s*postale|lbp\s*am", "La Banque Postale AM"),
    (r"societe\s*generale|sg\s+(asset|investment|solutions)|sgss", "Société Générale AM"),
    (r"credit\s*agricole|cacieis|caceis", "Crédit Agricole AM"),
    (r"lazard",            "Lazard Frères Gestion"),
    (r"swisslife|swiss\s*life", "Swiss Life AM"),
    (r"generali",          "Generali Investments"),
    (r"aviva",             "Aviva Investors"),
    (r"abrdn|aberdeen",    "abrdn"),
    (r"janus\s*henderson", "Janus Henderson"),
    (r"franklin\s*templeton", "Franklin Templeton"),
    (r"pimco",             "PIMCO"),
    (r"nordea",            "Nordea AM"),
    (r"robeco",            "Robeco"),
    (r"man\s+group|man\s+investments|man\s+ahl|man\s+glg", "Man Group"),
    (r"wisdom\s*tree",     "WisdomTree"),
    (r"erafp|epargne\s*plus", "ERAFP"),
    (r"cpr\s*asset",       "CPR AM (Amundi)"),
    (r"meschac",           "Meeschaert AM"),
    (r"montpensier",       "Montpensier Finance"),
    (r"varenne",           "Varenne Capital"),
    (r"talence",           "Talence Gestion"),
    (r"financiere\s*de\s*l['']?echiquier|echiquier", "Financière de l'Échiquier"),
    (r"primonial",         "Primonial REIM"),
    (r"perial",            "PERIAL AM"),
    (r"sofidy",            "Sofidy"),
    (r"corum",             "CORUM AM"),
    (r"paref",             "PAREF Gestion"),
    (r"la\s*francaise|lf\s+(am|im)", "La Française AM"),
    (r"tobam",             "TOBAM"),
    (r"flornoy",           "Flornoy & Associés"),
    (r"keren",             "Keren Finance"),
    (r"mandarine",         "Mandarine Gestion"),
    (r"valquant",          "Valquant Expertyse"),
    (r"covea",             "Covéa Finance"),
    (r"federal\s*finance", "Federal Finance Gestion"),
    (r"banque\s*populaire|bpce\s+vie", "BPCE / Banque Populaire AM"),
    (r"caisse\s*d['\s]?epargne", "Caisse d'Épargne (BPCE)"),
    (r"erafp|maif",        "MAIF Avenir"),
]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def normalize_basic(name: str) -> str:
    """Nettoyage de base : accents, casse, espaces."""
    if not name:
        return ""
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"\s+", " ", n).strip().lower()
    return n


def canonicalize(name: str) -> str:
    """Trouve le nom canonique pour une variante donnée."""
    if not name:
        return ""
    norm = normalize_basic(name)
    for pattern, canonical in CANONICAL_MAP:
        if re.search(pattern, norm):
            return canonical
    # Pas de match : retourne une version "title case" propre
    # On enlève les suffixes corporatifs et on capitalise proprement
    cleaned = re.sub(r"\s+(s\.a\.s?|sa\b|sas\b|sarl\b|gmbh|ltd|llc|inc\b|plc\b|n\.v\.|nv\b|bv\b|ag\b|company)", "", norm)
    return cleaned.strip().title() if cleaned else name


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool):
    print("=" * 68)
    print("  Normalize management_company")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    # Charger tous les fonds avec management_company
    out = []
    offset = 0
    while True:
        r = client.table("investissement_funds") \
            .select("isin, management_company, management_company_normalized") \
            .not_.is_("management_company", "null") \
            .range(offset, offset + 999) \
            .execute()
        if not r.data:
            break
        out += r.data
        if len(r.data) < 1000:
            break
        offset += 1000

    print(f"  {len(out)} fonds avec management_company")

    # Calculer les normalisations
    updates = []
    for f in out:
        raw = f["management_company"]
        canonical = canonicalize(raw)
        if canonical and canonical != f.get("management_company_normalized"):
            updates.append({"isin": f["isin"], "management_company_normalized": canonical, "raw": raw})

    print(f"  {len(updates)} mises à jour à appliquer")

    # Stats canoniques
    canonical_counter = Counter(u["management_company_normalized"] for u in updates)
    print(f"  → {len(canonical_counter)} noms canoniques distincts")
    print()
    print("  Top 20 canoniques :")
    for name, n in canonical_counter.most_common(20):
        print(f"    {n:>5}  {name}")

    if not apply:
        print("\n  DRY-RUN — pas d'écriture.")
        return

    print("\n  Application en base...")
    ok = fail = 0
    for i, u in enumerate(updates, 1):
        try:
            client.table("investissement_funds") \
                .update({"management_company_normalized": u["management_company_normalized"]}) \
                .eq("isin", u["isin"]) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 5:
                print(f"    ✗ {u['isin']} : {e}")
        if i % 1000 == 0:
            print(f"    [{i:>5}/{len(updates)}] {100*i/len(updates):.0f}% ok={ok} fail={fail}")

    print(f"\n  ✓ {ok} mis à jour, {fail} échecs")

    log_run(
        scraper="normalize-management-company",
        status="success" if fail == 0 else "partial",
        records_processed=ok,
        records_failed=fail,
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Normalise management_company → management_company_normalized")
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
