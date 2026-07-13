#!/usr/bin/env python3
"""
fix-asset-class.py — Normalise asset_class selon product_type
=============================================================
Pour les types dont la classe d'actifs est déterministe, force asset_class à la
valeur canonique quand la valeur en base est incohérente (ex. SCPI avec
asset_class = 'diversifie' → 'immobilier').

N'agit QUE sur les types déterministes. Ne touche jamais opcvm/etf/action
(classe réellement variable). Idempotent.

Usage :
    python3 scripts/migrations/fix-asset-class.py          # dry-run
    python3 scripts/migrations/fix-asset-class.py --apply
"""
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH = 500

# product_type -> (valeurs acceptées, valeur canonique à écrire si incohérent)
RULES = {
    "scpi":       ({"immobilier"}, "immobilier"),
    "opci":       ({"immobilier"}, "immobilier"),
    "crypto":     ({"crypto"}, "crypto"),
    "obligation": ({"obligations"}, "obligations"),
    "livret":     ({"monetaire"}, "monetaire"),
}


def fetch_type(client, ptype: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        batch = (
            client.table("investissement_funds").select("isin,asset_class")
            .eq("product_type", ptype)
            .not_.is_("asset_class", "null")
            .range(offset, offset + 999).execute().data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def run(apply: bool) -> None:
    print("=" * 60)
    print("  fix-asset-class — normalisation par product_type")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    updates: list[tuple[str, str, str]] = []
    for ptype, (allowed, default) in RULES.items():
        rows = fetch_type(client, ptype)
        bad = [r for r in rows if r.get("asset_class") not in allowed]
        print(f"  {ptype:12} : {len(bad)} incohérents → {default}")
        for r in bad:
            updates.append((r["isin"], default, r.get("asset_class")))

    print(f"  Total : {len(updates)}")

    if not apply:
        for isin, dflt, old in updates[:8]:
            print(f"    {isin}: {old!r} → {dflt!r}")
        return

    ok = fail = 0
    for i in range(0, len(updates), BATCH):
        for isin, default, _ in updates[i:i + BATCH]:
            try:
                client.table("investissement_funds").update(
                    {"asset_class": default, "updated_at": datetime.now(timezone.utc).isoformat()}
                ).eq("isin", isin).execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 5:
                    print(f"  ✗ {isin} : {e}")
        print(f"  [{min(i + BATCH, len(updates)):5d}/{len(updates)}]  ✓{ok} ✗{fail}")

    print(f"\n  → {ok} corrigés, {fail} erreurs")
    log_run("fix-asset-class", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Normalise asset_class pour les types déterministes")
    p.add_argument("--apply", action="store_true", help="Écrire les corrections")
    run(apply=p.parse_args().apply)
