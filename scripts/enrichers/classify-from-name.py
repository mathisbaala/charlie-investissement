#!/usr/bin/env python3
"""
classify-from-name.py — Enrichit asset_class_broad / region / sector / style / labels
========================================================================================
Heuristique gratuite basée sur le nom du fonds + product_type + asset_class existant.
Couvre l'angle CGP français : classification claire pour recommandation client.

Output :
  - asset_class_broad : action / obligation / monetaire / diversifie / immobilier / alternatif / matieres_premieres
  - region_normalized : france / europe / usa / world / emerging / asia / japan / china / specifique
  - sector            : technologie / sante / finance / energie / immo / esg / consommation / industrie / telecom / utilities / multiseteur
  - management_style  : passif / actif / index / smart_beta / actif_concentre
  - labels            : array JSONB ["ISR", "Greenfin", "Finansol", "Article9", ...]
  - ucits_compliant   : True si UCITS dans le nom OU type=etf/opcvm avec ISIN LU/IE/FR
  - per_eligible      : heuristique (TODO: validation manuelle)

Usage :
    python3 scripts/enrichers/classify-from-name.py [--apply] [--limit N]
"""

import sys
import re
import argparse
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run


def _norm(s: str) -> str:
    if not s: return ""
    n = unicodedata.normalize("NFKD", s)
    n = "".join(c for c in n if not unicodedata.combining(c))
    return n.lower()


# ─── Classification asset_class broad ─────────────────────────────────────────
ASSET_CLASS_RULES = [
    # (regex sur nom normalisé, asset_class_broad, [product_types eligibles ou None])
    (r"\b(monet(aire|ary)|cash|tresorerie|treso|money\s*market|mmkt)\b", "monetaire", None),
    (r"\b(obligation|bond|fixed\s*income|treasury|gilt|credit|high\s*yield|inflation\s*linked|govt|sovereign)\b", "obligation", None),
    (r"\b(immobilier|real\s*estate|reit|scpi|opci|sci|pierre|hotel|residen|comerc)\b", "immobilier", None),
    (r"\b(commodit(y|ies)|gold|or\b|silver|argent|petrole|matieres?\s*premieres?|oil|gas|metals|mining)\b", "matieres_premieres", None),
    (r"\b(alternat|absolute\s*return|long\s*short|market\s*neutral|hedge\s*fund|managed\s*future|cta)\b", "alternatif", None),
    (r"\b(diversif|multi[\s\-]?asset|allocation|patrimoine|prudent|equilibr|dynamique|defensif|offensif|mixed|balanced)\b", "diversifie", None),
    (r"\b(action|equit(y|ies)|stock|shares?|growth|value|small\s*cap|mid\s*cap|large\s*cap|dividend|world\s*equity)\b", "action", None),
    (r"\b(etf|index|tracker)\b", "action", ["etf"]),  # défaut ETF = action sauf si bond ETF
]


# ─── Region normalisée ────────────────────────────────────────────────────────
REGION_RULES = [
    (r"\bfrance\b|cac\s*40|french\s*equity|francaise?", "france"),
    (r"\beuro(zone|pe)?\b|stoxx|msci\s*europe|europe\s*equity|euroland", "europe"),
    (r"\b(usa|us\s+equity|america|s&?p\s*500|sp500|us\s+treasury|us\s+bond|north\s*america|nasdaq|dow\s*jones)\b", "usa"),
    (r"\b(world|monde|global|international|worldwide|msci\s*world)\b", "world"),
    (r"\b(emerging|pays\s*emergent|em\s+|markets|bric|frontier)\b", "emerging"),
    (r"\bchina\b|chine|hsi\b", "china"),
    (r"\bjapan\b|japon|nikkei|topix", "japan"),
    (r"\b(asia|asie|pacific|apac|asean)\b", "asia"),
    (r"\b(uk|united\s*kingdom|royaume\s*uni|ftse|britain)\b", "uk"),
    (r"\b(germany|allemagne|dax\b)\b", "germany"),
    (r"\b(swiss|suisse|smi\b)\b", "switzerland"),
    (r"\b(india|inde)\b", "india"),
    (r"\b(brazil|bresil|bovespa)\b", "brazil"),
]


# ─── Sector ────────────────────────────────────────────────────────────────────
SECTOR_RULES = [
    (r"\b(tech(no|nology)?|tech\b|software|semi(conductor)?|digital|ia\b|ai\b|metaverse|cyber|cloud|big\s*data|crypto|blockchain)\b", "technologie"),
    (r"\b(sante|health(care)?|pharma|biotech|medical|medtech|life\s*science|aging|wellness)\b", "sante"),
    (r"\b(finance|banque|bank|insurance|fintech|financ(ial|ier|iere))\b", "finance"),
    (r"\b(energie?|energy|petrole|oil|gas|renewable|solar|wind|nuclear|clean\s*energy|hydrogen)\b", "energie"),
    (r"\b(immobil|real\s*estate|reit|scpi|opci|pierre|habitation)\b", "immobilier"),
    (r"\b(consommation|consumer|retail|luxury|luxe)\b", "consommation"),
    (r"\b(industri(e|al)|aerospace|defense|defence|industrials)\b", "industrie"),
    (r"\b(telecom|telecommunication|5g|media\b)\b", "telecom"),
    (r"\b(utilities|services\s*publics?)\b", "utilities"),
    (r"\b(materiaux|materials|chimie|chemicals|mining)\b", "materiaux"),
    (r"\b(infrastructur|transport|logistic|shipping)\b", "infrastructure"),
    (r"\b(water|eau|aqua|biodiversity|biodiversit)\b", "environnement"),
    (r"\b(climate|climat|carbon|decarbon|transition|impact)\b", "climat"),
]


# ─── Style de gestion ──────────────────────────────────────────────────────────
STYLE_RULES = [
    (r"\b(smart\s*beta|factor|quality|momentum|low\s*vol(atility)?|equal\s*weight|enhanced)\b", "smart_beta"),
    (r"\b(etf|tracker|index|ucits\s*etf|swap)\b", "passif"),  # ETF = passif par défaut
    (r"\b(active|actively|gestion\s*active)\b", "actif"),
    (r"\b(absolute\s*return|long\s*short|market\s*neutral|alternative)\b", "alternatif"),
]


# ─── Labels ESG / Finansol / Greenfin / SFDR / Article9 ───────────────────────
LABEL_RULES = [
    (r"\b(isr|investissement\s*socialement\s*responsable)\b", "ISR"),
    (r"\b(esg|environn?ementa?l\s*social\s*gouvernance|sustaina|durable|responsable)\b", "ESG"),
    (r"\b(greenfin)\b", "Greenfin"),
    (r"\b(finansol)\b", "Finansol"),
    (r"\b(article\s*9|art\.?\s*9|sfdr\s*9)\b", "Article9"),
    (r"\b(article\s*8|art\.?\s*8|sfdr\s*8)\b", "Article8"),
    (r"\b(impact|impact\s*investing)\b", "Impact"),
    (r"\b(climate|low\s*carbon|paris\s*aligned|pa[bw]\b|net\s*zero)\b", "Climate"),
    (r"\b(charity|solidaire|microfinance)\b", "Solidaire"),
]


def classify(name: str, product_type: str | None, asset_class: str | None,
             category: str | None) -> dict:
    """Retourne dict {asset_class_broad, region_normalized, sector, management_style, labels, ucits_compliant}."""
    out = {}
    nm = _norm(name) + " " + _norm(category or "") + " " + _norm(asset_class or "")

    # asset_class_broad
    if product_type == "scpi" or "scpi" in nm or "opci" in nm:
        out["asset_class_broad"] = "immobilier"
    elif product_type == "crypto":
        out["asset_class_broad"] = "crypto"
    elif product_type == "action" and "etf" not in nm:
        # Action individuelle
        out["asset_class_broad"] = "action_individuelle"
    elif product_type in ("fonds_euros", "livret"):
        out["asset_class_broad"] = "fonds_euros" if product_type == "fonds_euros" else "livret"
    elif product_type == "obligation":
        out["asset_class_broad"] = "obligation"
    else:
        for pattern, broad, allowed_types in ASSET_CLASS_RULES:
            if allowed_types and product_type and product_type not in allowed_types:
                continue
            if re.search(pattern, nm, re.IGNORECASE):
                out["asset_class_broad"] = broad
                break

    # region
    for pattern, region in REGION_RULES:
        if re.search(pattern, nm, re.IGNORECASE):
            out["region_normalized"] = region
            break

    # sector
    for pattern, sector in SECTOR_RULES:
        if re.search(pattern, nm, re.IGNORECASE):
            out["sector"] = sector
            break

    # style
    for pattern, style in STYLE_RULES:
        if re.search(pattern, nm, re.IGNORECASE):
            out["management_style"] = style
            break
    # Override : si product_type='etf', par défaut "passif" sauf "active"
    if product_type == "etf" and "management_style" not in out:
        out["management_style"] = "passif"

    # labels
    labels = []
    seen = set()
    for pattern, label in LABEL_RULES:
        if re.search(pattern, nm, re.IGNORECASE) and label not in seen:
            labels.append(label)
            seen.add(label)
    if labels:
        out["labels"] = labels

    # UCITS compliant
    if "ucits" in nm or product_type == "etf":
        out["ucits_compliant"] = True
    elif product_type in ("opcvm", "sicav") and any(p in (name or "")[:2] for p in ("LU", "IE", "FR")):
        out["ucits_compliant"] = True

    return out


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 70)
    print("  Classify Funds from Name — CGP-relevant enrichment")
    print("=" * 70)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    # Charger tous les fonds
    out = []
    offset = 0
    while True:
        r = client.table("investissement_funds") \
            .select("isin, name, product_type, asset_class, category, asset_class_broad, region_normalized, sector, labels, management_style, ucits_compliant, per_eligible") \
            .range(offset, offset + 999) \
            .execute()
        if not r.data:
            break
        out += r.data
        if len(r.data) < 1000:
            break
        offset += 1000
        if limit and len(out) >= limit:
            out = out[:limit]
            break

    print(f"  {len(out)} fonds chargés")
    print()

    # Classifier
    updates = []
    skipped = 0
    for f in out:
        result = classify(f.get("name") or "", f.get("product_type"),
                          f.get("asset_class"), f.get("category"))
        if not result:
            skipped += 1
            continue
        # Ne mettre à jour que les champs vides en base
        payload = {}
        for k, v in result.items():
            if v and not f.get(k):
                payload[k] = v
        if payload:
            updates.append({"isin": f["isin"], **payload})

    print(f"  {len(updates)} fonds à enrichir, {skipped} skippés (déjà complets ou non-classifiables)")
    print()

    # Stats
    from collections import Counter
    fields_filled = Counter()
    for u in updates:
        for k in u:
            if k != "isin":
                fields_filled[k] += 1
    print("  Champs remplis :")
    for k, n in fields_filled.most_common():
        print(f"    {k:25} : {n}")
    print()

    # Distribution top
    classifs = {}
    for k in ("asset_class_broad", "region_normalized", "sector", "management_style"):
        classifs[k] = Counter(u.get(k) for u in updates if u.get(k))

    for k, c in classifs.items():
        print(f"  Top {k} :")
        for v, n in c.most_common(8):
            print(f"    {n:>5}  {v}")
        print()

    if not apply:
        print("  DRY-RUN — pas d'écriture.")
        return

    print("  Application en base...")
    ok = fail = 0
    for i, u in enumerate(updates, 1):
        try:
            payload = {k: v for k, v in u.items() if k != "isin"}
            client.table("investissement_funds") \
                .update(payload) \
                .eq("isin", u["isin"]) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"    ✗ {u['isin']} : {e}")
        if i % 2000 == 0:
            print(f"    [{i:>5}/{len(updates)}] {100*i/len(updates):.0f}% ok={ok} fail={fail}")

    print(f"\n  ✓ {ok} mis à jour, {fail} échecs")

    log_run(
        scraper="classify-from-name",
        status="success" if fail == 0 else "partial",
        records_processed=ok,
        records_failed=fail,
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
