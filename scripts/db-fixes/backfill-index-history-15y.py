"""
backfill-index-history-15y.py — Rallonge l'historique des indices à ~16 ans.

Contexte : investissement_index_prices ne remontait qu'à juin 2020 (fenêtre de
6 ans du td-enricher). Le back-test portefeuille propose désormais des périodes
de 10 et 15 ans : sans historique d'indice profond, la courbe de l'indice
démarrerait en plein milieu du graphe. Ce script récupère (gratuitement) les
séries depuis 2010 via les MÊMES sources que td-enricher :
  - yahoo (yfinance, auto_adjust=True → total return via cours ajusté) ;
  - MSCI (endpoint public getLevelDataForGraph), par tranches de 4 ans ;
puis reconstruit les composites (mix_25_75/50_50/75_25) via le RPC
inv_rebuild_composite_indices, qui s'étend automatiquement à tout l'historique
des composantes.

Usage :
    python3 scripts/db-fixes/backfill-index-history-15y.py            # dry-run
    python3 scripts/db-fixes/backfill-index-history-15y.py --apply

Limite assumée : certains tickers proxys (ETF UCITS) n'existent que depuis
2011-2014 — on prend ce qui existe, la profondeur réelle est affichée en fin.
"""

import json
import ssl
import sys
import urllib.request

import certifi

# Python.org sur macOS n'a pas les certificats système : contexte certifi explicite.
SSL_CTX = ssl.create_default_context(cafile=certifi.where())
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client  # noqa: E402

START = date(2010, 1, 1)
TODAY = date.today()

MSCI_ENDPOINT = ("https://app2.msci.com/products/service/index/indexmaster/"
                 "getLevelDataForGraph")
MSCI_VARIANT = {"net": "NETR", "gross": "GRTR", "price": "STRD"}


def yahoo_rows(code: str, ticker: str) -> list[dict]:
    import yfinance as yf
    df = yf.download(ticker, start=START.isoformat(), interval="1d",
                     progress=False, auto_adjust=True)
    if df is None or df.empty:
        return []
    if getattr(df.columns, "nlevels", 1) > 1:
        df.columns = df.columns.get_level_values(0)
    if "Close" not in df.columns:
        return []
    return [
        {"index_code": code, "price_date": ts.date().isoformat(),
         "value": float(val), "source": f"yahoo:{ticker}"}
        for ts, val in df["Close"].dropna().items()
    ]


def msci_rows(code: str, meta: dict) -> list[dict]:
    variant = MSCI_VARIANT[meta["variant"]]
    src = f"msci:{meta['msci_code']}:{variant}"
    rows: list[dict] = []
    seg_start = START
    while seg_start < TODAY:
        seg_end = min(seg_start + timedelta(days=365 * 4), TODAY)
        url = (f"{MSCI_ENDPOINT}?currency_symbol={meta['ccy']}"
               f"&index_variant={variant}"
               f"&start_date={seg_start.isoformat().replace('-', '')}"
               f"&end_date={seg_end.isoformat().replace('-', '')}"
               f"&data_frequency=DAILY&index_codes={meta['msci_code']}")
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0", "Accept": "application/json",
            "Referer": "https://www.msci.com/"})
        raw = urllib.request.urlopen(req, timeout=30, context=SSL_CTX).read().decode()
        for lv in json.loads(raw)["indexes"]["INDEX_LEVELS"]:
            v = lv.get("level_eod")
            if v is None:
                continue
            cd = str(lv["calc_date"])
            rows.append({"index_code": code,
                         "price_date": f"{cd[0:4]}-{cd[4:6]}-{cd[6:8]}",
                         "value": float(v), "source": src})
        seg_start = seg_end + timedelta(days=1)
    # Les tranches peuvent se chevaucher d'un jour : dédup par date (dernier gagne).
    return list({r["price_date"]: r for r in rows}.values())


def main() -> None:
    apply = "--apply" in sys.argv
    client = get_client()
    catalog = client.table("investissement_index_catalog") \
        .select("index_code, label, currency, variant, source, ticker, msci_code") \
        .eq("active", True).execute().data or []

    print(f"Backfill indices depuis {START} — mode {'APPLY' if apply else 'DRY-RUN'}\n")
    for row in catalog:
        code, source = row["index_code"], row["source"]
        if source == "composite":
            continue
        try:
            if source == "msci":
                rows = msci_rows(code, {"ccy": row["currency"].upper(),
                                        "variant": row["variant"],
                                        "msci_code": row["msci_code"]})
            else:
                rows = yahoo_rows(code, row["ticker"])
        except Exception as e:
            print(f"  ✗ {code:14} échec : {str(e)[:70]}")
            continue
        first = min((r["price_date"] for r in rows), default="?")
        print(f"  · {code:14} {len(rows):5} points, depuis {first}", end="")
        if apply and rows:
            ok = 0
            for i in range(0, len(rows), 500):
                batch = rows[i:i + 500]
                for attempt in range(3):
                    try:
                        client.table("investissement_index_prices") \
                            .upsert(batch, on_conflict="index_code,price_date").execute()
                        ok += len(batch)
                        break
                    except Exception:
                        if attempt == 2:
                            print(f"  ✗ upsert batch {i}", end="")
            print(f" → {ok} écrits")
        else:
            print(" (dry-run)")

    if apply:
        try:
            res = client.rpc("inv_rebuild_composite_indices").execute()
            print(f"\n  · composites reconstruits ({res.data} points)")
        except Exception as e:
            print(f"\n  ✗ composites : {str(e)[:70]}")
        print("\nProfondeur finale par indice :")
        for row in catalog:
            r2 = client.table("investissement_index_prices") \
                .select("price_date").eq("index_code", row["index_code"]) \
                .order("price_date").limit(1).execute().data
            print(f"  · {row['index_code']:14} depuis {r2[0]['price_date'] if r2 else 'aucune donnée'}")
    else:
        print("\nDry-run terminé. Relancer avec --apply pour écrire.")


if __name__ == "__main__":
    main()
