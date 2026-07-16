#!/usr/bin/env python3
"""
fix-html-entities.py — Décode les entités HTML résiduelles
==========================================================
name et management_company doivent être en texte décodé (« S&P », pas
« S&amp;P »). Ce script applique html.unescape() sur les deux champs.
Idempotent : n'écrit que si la valeur change réellement.

Usage :
    python3 scripts/migrations/fix-html-entities.py          # dry-run
    python3 scripts/migrations/fix-html-entities.py --apply
"""
import sys
import html
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH = 500
NEEDLES = ("&amp;", "&lt;", "&gt;", "&quot;", "&#39;", "&nbsp;", "&#")


def fetch_all(client) -> list[dict]:
    rows, offset = [], 0
    while True:
        batch = (
            client.table("investissement_funds").select("isin,name,management_company")
            .range(offset, offset + 999).execute().data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def run(apply: bool) -> None:
    print("=" * 60)
    print("  fix-html-entities — html.unescape(name, management_company)")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()
    rows = fetch_all(client)
    print(f"  {len(rows)} fonds chargés")

    updates: list[tuple[str, dict, dict]] = []
    for r in rows:
        fields: dict = {}
        for f in ("name", "management_company"):
            v = r.get(f)
            if isinstance(v, str) and any(n in v for n in NEEDLES):
                dec = html.unescape(v)
                if dec != v:
                    fields[f] = dec
        if fields:
            updates.append((r["isin"], fields, r))

    print(f"  {len(updates)} fonds avec entités à décoder")

    if not apply:
        for isin, fields, r in updates[:8]:
            for f, dec in fields.items():
                print(f"    {isin} {f}: {r.get(f)!r} → {dec!r}")
        return

    ok = fail = 0
    for i in range(0, len(updates), BATCH):
        for isin, fields, _ in updates[i:i + BATCH]:
            payload = dict(fields)
            payload["updated_at"] = datetime.now(timezone.utc).isoformat()
            try:
                client.table("investissement_funds").update(payload).eq("isin", isin).execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 5:
                    print(f"  ✗ {isin} : {e}")
        print(f"  [{min(i + BATCH, len(updates)):5d}/{len(updates)}]  ✓{ok} ✗{fail}")

    print(f"\n  → {ok} corrigés, {fail} erreurs")
    log_run("fix-html-entities", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Décode les entités HTML dans name/management_company")
    p.add_argument("--apply", action="store_true", help="Écrire les corrections")
    run(apply=p.parse_args().apply)
