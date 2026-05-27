#!/usr/bin/env python3
"""
quantalys-spider.py — Enrichissement OPCVM via Quantalys (Scrapling Spider)
=============================================================================
Version améliorée de quantalys-direct-enricher.py utilisant le framework Spider
de Scrapling pour :
  - Pause/resume via crawldir (checkpoint automatique)
  - Multi-session : FetcherSession (catalogue JSON) + DynamicSession (pages SPA)
  - CSS selectors natifs sur le Response object Scrapling
  - Stats temps réel et logging uniforme

Sources :
  - GET /Recherche/Produits  → catalogue JSON (62 000 fonds, pas besoin JS)
  - GET /Fonds/{ID_Produit}  → page SPA rendue JS (DynamicSession)

Champs collectés :
  - performance_1y, performance_3y, performance_5y
  - ter / ongoing_charges (Frais courants PRIIPS)
  - sri / srri (jauge indic-srri-selected, 1-7)
  - sfdr_article (Article 6/8/9)
  - sharpe_3y, volatility_3y

Usage :
    python3 scripts/scrapers/quantalys-spider.py [--apply] [--limit N]
    python3 scripts/scrapers/quantalys-spider.py --apply
    python3 scripts/scrapers/quantalys-spider.py --apply --ter-only
    python3 scripts/scrapers/quantalys-spider.py --apply --resume
    python3 scripts/scrapers/quantalys-spider.py --apply --crawldir /tmp/q_crawl
"""

import re
import sys
import json
import argparse
import asyncio
from datetime import datetime, timezone
from pathlib import Path

from scrapling.spiders import Spider, Request, Response
from scrapling.fetchers import FetcherSession, AsyncDynamicSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS        = 2            # Quantalys tolère 2 workers sans ban notable
RATE_LIMIT_SEC = 1.5          # secondes entre chaque requête par worker
TIMEOUT_SEC    = 25
HOME_URL       = "https://www.quantalys.com/"
CATALOG_URL    = "https://www.quantalys.com/Recherche/Produits"
FUND_URL       = "https://www.quantalys.com/Fonds/{fund_id}"

SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ", "fcp dédié", "fcpr ", "fpci ")


# ─── Parseurs (copiés depuis quantalys-direct-enricher.py) ───────────────────

def _pct(s: str | None) -> float | None:
    """Convertit une chaîne pourcentage en float arrondi à 4 décimales."""
    if not s:
        return None
    s = str(s).replace("\xa0", "").replace(" ", "").replace(",", ".").replace("%", "").strip()
    try:
        v = float(s)
        if -1000 < v < 10000:
            return round(v, 4)
    except ValueError:
        pass
    return None


def parse_quantalys_page(html: str) -> dict:
    """
    Extrait depuis une page /Fonds/{id} via regex (fallback robuste) :
      - performance_1y, performance_3y, performance_5y
      - ter / ongoing_charges (Frais courants PRIIPS)
      - sri (1-7)
      - sfdr_article (6/8/9)
      - sharpe_3y, volatility_3y
    """
    result: dict = {}

    # ── Performances 1/3/5 ans ────────────────────────────────────────────────
    for n, key in ((1, "performance_1y"), (3, "performance_3y"), (5, "performance_5y")):
        pat = rf"Perf\.\s*{n}\s*ans?</td>\s*<td[^>]*>\s*([+-]?\d+[.,]\d+)\s*%"
        m = re.search(pat, html, re.DOTALL)
        if m:
            val = _pct(m.group(1))
            if val is not None:
                result[key] = val

    # ── TER (Frais courants PRIIPS, ignorer "-") ──────────────────────────────
    ter_patterns = [
        r"Frais\s+courants\s+PRIIPS.*?</td>\s*<td[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*%",
        r"Frais\s+courants.*?</td>\s*<td[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*%",
    ]
    for pat in ter_patterns:
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m and m.group(1) != "-":
            ter_pct = _pct(m.group(1))
            if ter_pct is not None and 0 < ter_pct < 20:
                result["ter"] = round(ter_pct / 100, 6)
                result["ongoing_charges"] = result["ter"]
                break

    # ── SRI (jauge 1-7) ───────────────────────────────────────────────────────
    sri_m = re.search(r'indic-srri-selected">\s*(\d)\s*</div>', html)
    if sri_m:
        v = int(sri_m.group(1))
        if 1 <= v <= 7:
            result["sri"] = v
            result["srri"] = v

    # ── SFDR Article ──────────────────────────────────────────────────────────
    sfdr_m = re.search(r"[Aa]rticle\s*([689])\s*(?:SFDR|du\s+r[eè]glement|PRIIPs)?", html)
    if sfdr_m:
        result["sfdr_article"] = int(sfdr_m.group(1))

    # ── Sharpe 3 ans ──────────────────────────────────────────────────────────
    sharpe_m = re.search(
        r"Ratio\s+de\s+Sharpe.*?</td>\s*<td[^>]*>\s*([+-]?\d+[.,]\d+)", html, re.DOTALL
    )
    if sharpe_m:
        v = _pct(sharpe_m.group(1))
        if v is not None:
            result["sharpe_3y"] = v

    # ── Volatilité 3 ans ──────────────────────────────────────────────────────
    vol_m = re.search(
        r"Volatilit[eé].*?</td>\s*<td[^>]*>\s*([0-9]+[.,][0-9]+)\s*%",
        html,
        re.DOTALL | re.IGNORECASE,
    )
    if vol_m:
        v = _pct(vol_m.group(1))
        if v is not None and 0 < v < 200:
            result["volatility_3y"] = v

    return result


# ─── Catalogue ISIN → ID_Produit (copié depuis quantalys-direct-enricher.py) ─

def fetch_catalog(sess: FetcherSession) -> dict[str, int]:
    """
    Télécharge le catalogue complet Quantalys (~62 000 fonds, ~5.5 Mo JSON).
    Retourne un dict ISIN → ID_Produit.
    Gère le challenge JS/cookie de Quantalys (redirect intermédiaire).
    """
    def _get_catalog(s: FetcherSession) -> bytes:
        page = s.get(
            CATALOG_URL,
            headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"},
            timeout=60,
        )
        if page.status != 200 or not page.body:
            raise RuntimeError(f"Catalogue Quantalys : HTTP {page.status}")
        return page.body

    # Pré-chauffe la session avec la page d'accueil (résout les cookies)
    try:
        home = sess.get(HOME_URL, stealthy_headers=True, timeout=TIMEOUT_SEC)
        home_text = home.body.decode("utf-8") if home.body else ""
        m_home = re.search(r"location\.href='(/[^']+)'", home_text)
        if m_home:
            sess.get(
                f"https://www.quantalys.com{m_home.group(1)}",
                stealthy_headers=True,
                timeout=TIMEOUT_SEC,
            )
    except Exception:
        pass  # L'accueil est un bonus — le catalogue peut réussir sans

    body = _get_catalog(sess)
    raw = body.decode("utf-8")

    # Quantalys peut retourner un challenge JS à résoudre (redirect cookie)
    if raw.strip().startswith("<"):
        m = re.search(r"location\.href='(/[^']+)'", raw)
        if m:
            sess.get(
                f"https://www.quantalys.com{m.group(1)}",
                stealthy_headers=True,
                timeout=15,
            )
            body = _get_catalog(sess)
            raw = body.decode("utf-8")

    funds = json.loads(raw)
    return {f["sCodeISIN"]: f["ID_Produit"] for f in funds if f.get("sCodeISIN")}


# ─── Requêtes cibles (copié depuis quantalys-direct-enricher.py) ──────────────

def fetch_target_funds(client, ter_only: bool, limit: int | None) -> list[dict]:
    """Retourne les OPCVM/ETF sans perf_1y ou sans TER (triés par AUM desc)."""
    funds: list[dict] = []
    seen: set[str] = set()
    page_size = 1000

    def _fetch(null_field: str, with_aum: bool) -> None:
        offset = 0
        while True:
            q = (
                client.table("investissement_funds")
                .select("isin, name, product_type")
                .in_("product_type", ["opcvm", "etf"])
                .is_(null_field, "null")
            )
            if with_aum:
                q = q.not_.is_("aum_eur", "null").order("aum_eur", desc=True)
            else:
                q = q.is_("aum_eur", "null")
            batch = q.range(offset, offset + page_size - 1).execute().data or []
            for row in batch:
                if row["isin"] not in seen:
                    name_lower = (row.get("name") or "").lower()
                    if not any(p in name_lower for p in SKIP_PATTERNS):
                        seen.add(row["isin"])
                        funds.append(row)
            if len(batch) < page_size:
                break
            offset += page_size

    if not ter_only:
        _fetch("performance_1y", True)
        _fetch("performance_1y", False)

    _fetch("ter", True)
    _fetch("ter", False)

    if limit:
        funds = funds[:limit]
    return funds


# ─── CSS selector helpers ──────────────────────────────────────────────────────

def _parse_fund_css(response: Response) -> dict:
    """
    Extrait les métriques depuis une page /Fonds/{id} via CSS selectors Scrapling.
    Retourne un dict partiel (les clés absentes ne sont pas incluses).
    """
    result: dict = {}

    # ── SRI (jauge 1-7 : div.indic-srri-selected) ────────────────────────────
    try:
        sri_els = response.css(".indic-srri-selected")
        if sri_els:
            txt = sri_els[0].text.strip()
            if txt.isdigit():
                v = int(txt)
                if 1 <= v <= 7:
                    result["sri"] = v
                    result["srri"] = v
    except Exception:
        pass

    # ── Données tabulaires : find_by_text + sibling ───────────────────────────
    # Chaque helper tente find_by_text pour localiser le label <td>,
    # puis lit le texte du <td> suivant pour la valeur.

    def _table_value(label: str) -> str | None:
        """Retourne le texte du <td> suivant la cellule dont le texte contient label."""
        try:
            cells = response.find_by_text(label, tag="td")
            if cells:
                sib = cells[0].next_sibling
                if sib:
                    return sib.text.strip()
        except Exception:
            pass
        return None

    # TER (Frais courants PRIIPS)
    ter_raw = _table_value("Frais courants PRIIPS") or _table_value("Frais courants")
    if ter_raw and ter_raw != "-":
        ter_pct = _pct(ter_raw)
        if ter_pct is not None and 0 < ter_pct < 20:
            result["ter"] = round(ter_pct / 100, 6)
            result["ongoing_charges"] = result["ter"]

    # Performances N ans
    for n, key in ((1, "performance_1y"), (3, "performance_3y"), (5, "performance_5y")):
        raw = _table_value(f"Perf. {n} ans") or _table_value(f"Perf. {n} an")
        if raw:
            val = _pct(raw)
            if val is not None:
                result[key] = val

    # Sharpe
    sharpe_raw = _table_value("Ratio de Sharpe")
    if sharpe_raw:
        v = _pct(sharpe_raw)
        if v is not None:
            result["sharpe_3y"] = v

    # Volatilité
    vol_raw = _table_value("Volatilité")
    if vol_raw:
        v = _pct(vol_raw)
        if v is not None and 0 < v < 200:
            result["volatility_3y"] = v

    return result


# ─── Spider ───────────────────────────────────────────────────────────────────

class QuantalysSpider(Spider):
    """
    Spider Scrapling pour enrichir les fonds OPCVM/ETF depuis Quantalys.

    Reçoit la liste funds_with_id = [(fund_dict, fund_id), ...] pré-calculée
    (catalogue déjà téléchargé avant le démarrage du Spider).
    """

    name               = "quantalys-spider"
    concurrent_requests = WORKERS
    download_delay      = RATE_LIMIT_SEC

    def __init__(
        self,
        funds_with_id: list[tuple[dict, int]],
        apply: bool,
        client,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._funds_with_id = funds_with_id
        self._apply         = apply
        self._client        = client
        self._total         = len(funds_with_id)
        self._found         = 0
        self._no_data       = 0
        self._counter       = 0

    # ── Session setup ──────────────────────────────────────────────────────────

    def configure_sessions(self, manager):
        # fast : FetcherSession TLS Chrome (pas besoin de JS pour le catalogue)
        manager.add("fast", FetcherSession(impersonate="chrome"))
        # browser : DynamicSession pour rendre le SPA Quantalys côté client
        manager.add(
            "browser",
            AsyncDynamicSession(headless=True, network_idle=True),
        )

    # ── Requests initiaux ──────────────────────────────────────────────────────

    async def start_requests(self):
        """Génère une Request par fonds cible directement vers /Fonds/{id}."""
        for fund, fund_id in self._funds_with_id:
            url = FUND_URL.format(fund_id=fund_id)
            yield Request(
                url,
                callback=self.parse,
                sid="browser",
                meta={
                    "isin":    fund["isin"],
                    "name":    (fund.get("name") or "")[:40],
                    "fund_id": fund_id,
                },
            )

    # ── Parseur page fonds ─────────────────────────────────────────────────────

    async def parse(self, response: Response):
        """
        Extrait les métriques d'une page /Fonds/{id}.
        Stratégie 1 : CSS selectors natifs Scrapling.
        Stratégie 2 : regex fallback sur le HTML brut (parse_quantalys_page).
        """
        isin    = response.meta.get("isin", "")
        name    = response.meta.get("name", "")
        fund_id = response.meta.get("fund_id", "")

        self._counter += 1
        idx = self._counter

        # Vérification réponse valide
        if response.status != 200 or not response.body:
            self._no_data += 1
            if idx <= 10 or idx % 200 == 0:
                print(f"  x [{idx:5d}/{self._total}] {isin} (ID={fund_id}) | HTTP {response.status} | {name}")
            return

        html = response.body.decode("utf-8") if isinstance(response.body, bytes) else str(response.body)

        # Sanity check : la page contient-elle des données Quantalys ?
        if len(html) < 5000 or ("indic-srri" not in html and "Perf." not in html):
            self._no_data += 1
            if idx <= 10 or idx % 200 == 0:
                print(f"  x [{idx:5d}/{self._total}] {isin} (ID={fund_id}) | page vide/SPA non rendu | {name}")
            return

        # Stratégie 1 : CSS selectors Scrapling
        data = _parse_fund_css(response)

        # Stratégie 2 : regex fallback si CSS selectors n'ont rien trouvé
        if not data:
            data = parse_quantalys_page(html)

        # Merge des deux stratégies si partiel (CSS peut avoir une partie, regex l'autre)
        if data and len(data) < 3:
            regex_data = parse_quantalys_page(html)
            for k, v in regex_data.items():
                if k not in data:
                    data[k] = v

        if data:
            self._found += 1
            if self._apply:
                try:
                    upsert_fund({"isin": isin, **data})
                except Exception as e:
                    print(f"  ! [{idx:5d}] {isin} | upsert error: {e}")

            if idx <= 30 or idx % 100 == 0:
                p1  = f"{data['performance_1y']:+.1f}%"  if "performance_1y" in data else "N/A"
                ter = f"{data['ter'] * 100:.2f}%"        if "ter" in data      else "N/A"
                sri = data.get("sri", "?")
                print(
                    f"  + [{idx:5d}/{self._total}] {isin} | perf:{p1:8} | TER:{ter:6} | SRI:{sri} | {name}"
                )

            yield {
                "isin":    isin,
                "fund_id": fund_id,
                **data,
            }
        else:
            self._no_data += 1
            if idx <= 10 or idx % 200 == 0:
                print(f"  x [{idx:5d}/{self._total}] {isin} (ID={fund_id}) | no data | {name}")


# ─── Orchestration principale ──────────────────────────────────────────────────

def run(apply: bool, limit: int | None, ter_only: bool, crawldir: str | None) -> None:
    print("=" * 60)
    print("  Quantalys Spider — TER + Perf + SRI (Scrapling Spider)")
    print("=" * 60)
    print(f"  Mode          : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  TER seulement : {ter_only}")
    if limit:
        print(f"  Limite        : {limit}")
    effective_crawldir = crawldir or "./crawl_data/quantalys"
    print(f"  Crawldir      : {effective_crawldir}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # ── 1. Catalogue (synchrone, avant le Spider) ─────────────────────────────
    print("  Téléchargement catalogue ISIN → ID_Produit…", end=" ", flush=True)
    with FetcherSession(impersonate="chrome") as sess:
        isin_to_id = fetch_catalog(sess)
    print(f"{len(isin_to_id):,} entrées")
    print()

    # ── 2. Fonds cibles depuis DB ─────────────────────────────────────────────
    print("  Récupération fonds cibles depuis Supabase…", end=" ", flush=True)
    funds = fetch_target_funds(client, ter_only, limit)
    funds_with_id = [
        (f, isin_to_id[f["isin"]])
        for f in funds
        if f["isin"] in isin_to_id
    ]
    print(
        f"{len(funds)} fonds cibles, "
        f"{len(funds_with_id)} présents dans Quantalys "
        f"({len(funds) - len(funds_with_id)} non trouvés)"
    )
    print()

    if not funds_with_id:
        print("  Rien à faire — arrêt.")
        log_run("quantalys-spider", "success", 0, 0, started_at=started)
        return

    # ── 3. Création du répertoire crawldir ────────────────────────────────────
    Path(effective_crawldir).mkdir(parents=True, exist_ok=True)

    # ── 4. Lancer le Spider ───────────────────────────────────────────────────
    print(f"  Démarrage Spider ({WORKERS} workers, {RATE_LIMIT_SEC}s délai)…")
    print()

    spider = QuantalysSpider(
        funds_with_id=funds_with_id,
        apply=apply,
        client=client,
        crawldir=effective_crawldir,
    )
    result = spider.start()

    # ── 5. Stats finales ──────────────────────────────────────────────────────
    found   = spider._found
    no_data = spider._no_data
    total   = len(funds_with_id)

    if result and hasattr(result, "items"):
        # result.items peut différer légèrement si le Spider a filtré des doublons
        found = max(found, len(result.items))

    print()
    print("=" * 60)
    print(f"  + {found} fonds enrichis sur {total} ({found / total * 100:.1f}%)")
    print(f"  x {no_data} sans données")
    print(f"  Durée : {(datetime.now(timezone.utc) - started).seconds}s")
    print("=" * 60)

    if apply:
        log_run("quantalys-spider", "success", found, no_data, started_at=started)


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Quantalys Spider — Enrichissement OPCVM/ETF avec Scrapling Spider"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Écrire les résultats dans Supabase (défaut: dry-run)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limiter à N fonds (utile pour tests)",
    )
    parser.add_argument(
        "--ter-only",
        action="store_true",
        help="Cibler uniquement les fonds sans TER (ignorer perf manquante)",
    )
    parser.add_argument(
        "--crawldir",
        type=str,
        default=None,
        help="Répertoire pour le checkpoint pause/resume (défaut: ./crawl_data/quantalys)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Reprendre depuis le dernier checkpoint dans crawldir",
    )
    args = parser.parse_args()

    run(
        apply=args.apply,
        limit=args.limit,
        ter_only=args.ter_only,
        crawldir=args.crawldir,
    )
