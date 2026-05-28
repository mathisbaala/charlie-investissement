#!/usr/bin/env python3
"""
infer-gestionnaire-from-name.py — Inférer management_company_normalized depuis le début du nom
================================================================================================
14 031 fonds n'ont ni management_company ni management_company_normalized.
Pour beaucoup (OPCVM, ETF, FCPE…), le nom du fonds commence par le nom du gestionnaire.
Ex: "Carmignac Patrimoine A EUR" → "Carmignac"
    "BNP Paribas Sustainable Active Equity C" → "BNP Paribas AM"
    "iShares Core MSCI World" → "BlackRock"

Ce script applique un dictionnaire de préfixes regex → gestionnaire canonique
sur le champ `name` pour tous les fonds sans management_company_normalized,
indépendamment de la présence de management_company.

Usage :
    python3 scripts/migrations/infer-gestionnaire-from-name.py
    python3 scripts/migrations/infer-gestionnaire-from-name.py --apply
"""

import sys
import re
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Dictionnaire de préfixes → gestionnaire canonique ────────────────────────
# Format : (regex_prefix, gestionnaire_canonique)
# L'ordre compte — premier match gagne.
# Les patterns matchent le DÉBUT du nom (case-insensitive).

PREFIXES: list[tuple[str, str]] = [
    # ── Tier 1 — Grands groupes internationaux ──────────────────────────────
    (r"^amundi\b",                                          "Amundi AM"),
    (r"^lyxor\b",                                           "Amundi AM"),          # Lyxor → Amundi depuis 2022
    (r"^cpr\b",                                             "CPR AM"),             # CPR AM = filiale Amundi
    (r"^blackrock\b",                                       "BlackRock"),
    (r"^ishares\b|^i\s*shares\b",                          "BlackRock"),
    (r"^vanguard\b",                                        "Vanguard"),
    (r"^bnp\s*paribas\b",                                   "BNP Paribas AM"),
    (r"^exane\s+bnp\b|^exane\b",                            "Exane BNP Paribas"),
    (r"^axa\b",                                             "AXA Investment Managers"),
    (r"^allianz\b",                                         "Allianz GI"),
    (r"^schroder(s)?\b",                                    "Schroders"),
    (r"^fidelity\b",                                        "Fidelity International"),
    (r"^pimco\b",                                           "PIMCO"),
    (r"^invesco\b",                                         "Invesco"),
    (r"^jpmorgan\b|^j\.p\.\s*morgan\b|^jpm\b",             "JPMorgan AM"),
    (r"^goldman\s+sachs\b",                                 "Goldman Sachs AM"),
    (r"^morgan\s+stanley\b",                                "Morgan Stanley IM"),
    (r"^franklin\s+templeton\b|^franklin\b|^templeton\b",  "Franklin Templeton"),
    (r"^pictet\b",                                          "Pictet AM"),
    (r"^ubs\b",                                             "UBS AM"),
    (r"^credit\s+suisse\b|^cs\s+\(lux\)\b",                "Credit Suisse AM"),
    (r"^hsbc\b",                                            "HSBC AM"),
    (r"^dws\b",                                             "DWS (Deutsche Bank)"),
    (r"^xtrackers\b",                                       "DWS (Deutsche Bank)"),
    (r"^spdr\b",                                            "State Street SPDR"),
    (r"^state\s+street\b",                                  "State Street"),
    (r"^natixis\b",                                         "Natixis IM"),
    (r"^ostrum\b",                                          "Ostrum AM"),
    (r"^robeco\b",                                          "Robeco"),
    (r"^nordea\b",                                          "Nordea AM"),
    (r"^abrdn\b|^aberdeen\b",                               "abrdn"),
    (r"^janus\s+henderson\b",                               "Janus Henderson"),
    (r"^wisdomtree\b",                                      "WisdomTree"),
    (r"^vaneck\b",                                          "VanEck"),
    (r"^m&g\b|^m\s+&\s+g\b",                               "M&G Investments"),
    (r"^msci\b",                                            "MSCI"),
    (r"^neuberger\s+berman\b",                              "Neuberger Berman"),
    (r"^muzinich\b",                                        "Muzinich & Co"),
    (r"^man\s+group\b|^man\s+glg\b|^man\s+ahl\b",          "Man Group"),
    (r"^abn\s+amro\b",                                      "ABN AMRO AM"),
    (r"^generali\b",                                        "Generali Investments"),
    (r"^aviva\b",                                           "Aviva Investors"),
    (r"^swisslife\b|^swiss\s+life\b",                       "SwissLife AM"),

    # ── Tier 2 — Gestionnaires français ─────────────────────────────────────
    (r"^carmignac\b",                                       "Carmignac"),
    (r"^oddo\s+bhf\b|^oddo\b",                             "ODDO BHF AM"),
    (r"^dnca\b",                                            "DNCA Finance"),
    (r"^lazard\b",                                          "Lazard Frères Gestion"),
    (r"^groupama\b",                                        "Groupama AM"),
    (r"^edmond\s+de\s+rothschild\b|^edr\b",                "Edmond de Rothschild AM"),
    (r"^rothschild\b",                                      "Rothschild & Co AM"),
    (r"^comgest\b",                                         "Comgest"),
    (r"^covéa\b|^covea\b",                                  "Covéa Finance"),
    (r"^sycomore\b",                                        "Sycomore AM"),
    (r"^tikehau\b",                                         "Tikehau Capital"),
    (r"^mandarine\b",                                       "Mandarine Gestion"),
    (r"^moneta\b",                                          "Moneta AM"),
    (r"^dorval\b",                                          "Dorval AM"),
    (r"^ecofi\b",                                           "Ecofi"),
    (r"^gay[\-\s]lussac\b",                                 "Gay-Lussac Gestion"),
    (r"^société\s+générale\b|^societe\s+generale\b|^sgam\b", "Société Générale AM"),
    (r"^crédit\s+agricole\b|^credit\s+agricole\b|^ca\s+(fund|assur|indosuez)\b", "Amundi AM"),
    (r"^la\s+française\b|^la\s+francaise\b|^lf\s+(am|im)\b", "La Française AM"),
    (r"^federal\s+finance\b",                               "Federal Finance Gestion"),
    (r"^cholet[\s\-]dupont\b",                              "Cholet-Dupont"),
    (r"^im\s+global\b|^imgp\b",                             "iM Global Partner"),
    (r"^eurazeo\b",                                         "Eurazeo"),
    (r"^ardian\b",                                          "Ardian"),
    (r"^r[\s\-]?co\b|^roco\b",                             "R-co"),
    (r"^tobam\b",                                           "TOBAM"),
    (r"^ossiam\b",                                          "Ossiam"),
    (r"^primonial\b",                                       "Primonial REIM"),
    (r"^perial\b",                                          "PERIAL AM"),
    (r"^sofidy\b",                                          "Sofidy"),
    (r"^corum\b",                                           "CORUM AM"),
    (r"^paref\b",                                           "PAREF Gestion"),
    (r"^de\s+pury\s+pictet\b|^dppm\b",                     "DPPM"),
    (r"^ffp\b|^fcp\s*ffp\b",                               "FFP"),
    (r"^iml\b|^independent\s+minds\b",                      "Independent Minds"),
    (r"^linxea\b|^linzee\b",                                "Linxea"),
    (r"^montpensier\b",                                     "Montpensier Finance"),
    (r"^varenne\b",                                         "Varenne Capital"),
    (r"^talence\b",                                         "Talence Gestion"),
    (r"^échiquier\b|^echiquier\b|^financière\s+de\s+l['\s]échiquier\b", "Financière de l'Échiquier"),
    (r"^flornoy\b",                                         "Flornoy & Associés"),
    (r"^keren\b",                                           "Keren Finance"),
    (r"^valquant\b",                                        "Valquant Expertyse"),
    (r"^meeschaert\b|^meschac\b",                           "Meeschaert AM"),
    (r"^ofi\s+invest\b|^ofi\b",                            "OFI Invest AM"),
    (r"^eleva\b",                                           "Eleva Capital"),
    (r"^claresco\b",                                        "Claresco"),
    (r"^clartan\b",                                         "Clartan Associés"),
    (r"^fundsmith\b",                                       "Fundsmith"),
    (r"^auris\b",                                           "Auris Gestion"),
    (r"^synchrony\b",                                       "Synchrony AM"),
    (r"^fineco\s+am\b|^fineco\b",                           "Fineco AM"),
    (r"^candriam\b",                                        "Candriam"),
    (r"^crelan\b",                                          "Crelan AM"),
    (r"^degroof\b",                                         "Degroof Petercam AM"),

    # ── Tier 3 — Autres gestionnaires repérés dans les données ──────────────
    (r"^onemarkets\b",                                      "OneMar­kets"),
    (r"^defiance\b",                                        "Defiance ETFs"),
    (r"^yas\b",                                             "YAS Invest"),
    (r"^banque\s+populaire\b|^bpce\b",                     "BPCE / Banque Populaire AM"),
    (r"^caisse\s+d['\s]?épargne\b|^caisse\s+d['\s]?epargne\b", "Caisse d'Épargne (BPCE)"),
    (r"^la\s+banque\s+postale\b|^lbp\s+am\b",              "La Banque Postale AM"),
    (r"^credit\s+mutuel\b|^crédit\s+mutuel\b|^cm[\-_]?am\b|^cmcic\b", "Crédit Mutuel AM"),
]

# Pré-compiler pour performance
_COMPILED = [(re.compile(pat, re.IGNORECASE), gestionnaire) for pat, gestionnaire in PREFIXES]


def infer_gestionnaire(name: str | None) -> str | None:
    """Retourne le gestionnaire canonique inféré depuis le début du nom, ou None."""
    if not name:
        return None
    for pat, gestionnaire in _COMPILED:
        if pat.match(name):
            return gestionnaire
    return None


def run(apply: bool) -> None:
    print("=" * 70)
    print("  Inférer management_company_normalized depuis le début du nom")
    print("=" * 70)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # ── Chargement des fonds sans management_company_normalized ───────────────
    all_funds: list[dict] = []
    offset = 0
    print("  Chargement des fonds sans management_company_normalized...", flush=True)
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin,name,product_type")
            .is_("management_company_normalized", "null")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds):,} fonds sans management_company_normalized\n")

    # ── Inférence ─────────────────────────────────────────────────────────────
    to_update: list[dict] = []
    no_match = 0
    gestionnaire_counter: Counter = Counter()

    for f in all_funds:
        name = f.get("name") or ""
        gestionnaire = infer_gestionnaire(name)
        if gestionnaire:
            to_update.append({
                "isin":                         f["isin"],
                "management_company_normalized": gestionnaire,
            })
            gestionnaire_counter[gestionnaire] += 1
        else:
            no_match += 1

    print(f"  {len(to_update):,} fonds avec gestionnaire inféré")
    print(f"  {no_match:,} fonds sans match (aucun préfixe reconnu)\n")
    print(f"  {len(gestionnaire_counter)} gestionnaires distincts inférés\n")

    # ── Distribution par gestionnaire (top 20) ─────────────────────────────
    print("  Top 20 gestionnaires inférés :")
    print(f"  {'Rang':<5} {'Gestionnaire':<40} {'Fonds':>6}")
    print("  " + "-" * 55)
    for rank, (gestionnaire, n) in enumerate(gestionnaire_counter.most_common(20), 1):
        print(f"  {rank:<5} {gestionnaire:<40} {n:>6}")

    if len(gestionnaire_counter) > 20:
        rest = sum(v for _, v in gestionnaire_counter.most_common()[20:])
        print(f"  {'...':<5} {'(autres gestionnaires)':<40} {rest:>6}")

    # ── Exemples de match ─────────────────────────────────────────────────────
    print("\n  Exemples de mapping (max 15) :")
    shown = 0
    for f in all_funds:
        name = f.get("name") or ""
        gestionnaire = infer_gestionnaire(name)
        if gestionnaire and shown < 15:
            print(f"    {name[:60]:<60} → {gestionnaire}")
            shown += 1

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister les changements.")
        return

    # ── Application en base ────────────────────────────────────────────────────
    print(f"\n  Application en base ({len(to_update):,} UPDATE, batches de 400)...", flush=True)
    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    # Grouper par valeur pour minimiser le nombre de requêtes
    by_gestionnaire: dict[str, list[str]] = defaultdict(list)
    for r in to_update:
        by_gestionnaire[r["management_company_normalized"]].append(r["isin"])

    for gestionnaire, isins in sorted(by_gestionnaire.items(), key=lambda x: -len(x[1])):
        batch_ok = 0
        for i in range(0, len(isins), 400):
            sub = isins[i:i + 400]
            try:
                client.table("investissement_funds") \
                    .update({
                        "management_company_normalized": gestionnaire,
                        "updated_at": now_ts,
                    }) \
                    .in_("isin", sub) \
                    .execute()
                ok += len(sub)
                batch_ok += len(sub)
            except Exception as e:
                fail += len(sub)
                print(f"  ✗ [{gestionnaire}] batch {i // 400 + 1} : {e}", flush=True)
        print(f"  {gestionnaire:<45} → {batch_ok:>5} fonds", flush=True)

    print(f"\n  ✓ {ok:,} fonds mis à jour, {fail} erreurs")

    # ── Couverture finale ─────────────────────────────────────────────────────
    try:
        resp = (
            client.table("investissement_funds")
            .select("management_company_normalized", count="exact")
            .not_.is_("management_company_normalized", "null")
            .execute()
        )
        total_resp = client.table("investissement_funds").select("isin", count="exact").execute()
        with_norm = resp.count or 0
        total = total_resp.count or 0
        pct = (with_norm / total * 100) if total else 0
        print(f"\n  Couverture management_company_normalized : {with_norm:,}/{total:,} ({pct:.1f}%)")
    except Exception:
        pass

    log_run(
        scraper="infer-gestionnaire-from-name",
        status="success" if fail == 0 else "partial",
        records_processed=ok,
        records_failed=fail,
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Inférer management_company_normalized depuis le préfixe du nom du fonds"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base (sinon dry-run)")
    args = parser.parse_args()
    run(apply=args.apply)
