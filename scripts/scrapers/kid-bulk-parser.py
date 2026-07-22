#!/usr/bin/env python3
"""
kid-bulk-parser.py — Parsing KID/DICI en masse
===============================================
Pour chaque fonds dans investissement_funds ayant un kid_url,
télécharge le PDF et en extrait :
  - SRI (indicateur de risque 1-7)
  - TER / frais courants (%)
  - Frais d'entrée max (%)
  - Période de détention recommandée (années)
  - Performances scénario modéré (1/3/5 ans)
  - Benchmark / indice de référence

Stratégie :
  1. Regex structurées sur le texte extrait (pdfplumber)
  2. Si score de confiance < 60% → fallback LLM (Claude claude-haiku-4-5)
  3. Si kid_url manquant → cherche l'URL dans les sources connues (Amundi, Carmignac…)

Usage :
    python3 scripts/scrapers/kid-bulk-parser.py [--apply] [--limit N] [--workers W]
    python3 scripts/scrapers/kid-bulk-parser.py --apply --min-aum 50000000  # fonds >50M€

--workers W  : parallélisme (défaut: 10)
--min-aum N  : ne traiter que les fonds avec AUM >= N euros
--force      : re-parser même si kid_parsed_at est déjà renseigné
--llm        : activer le fallback Claude (nécessite ANTHROPIC_API_KEY)
"""

import re
import sys
import time
import json
import hashlib
import argparse
import io
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

import requests as _requests

# Fetcher : scrapling en local/dev (furtivité navigateur), curl_cffi en CI.
# scrapling est VOLONTAIREMENT absent de scripts/requirements.txt (navigateur +
# IP datacenter bloquée) ; on retombe alors sur un shim curl_cffi (impersonation
# TLS, sans navigateur) — suffisant pour des endpoints PDF directs type
# amfinesoft/GECO qui composent l'essentiel des kid_url.
try:
    from scrapling.fetchers import FetcherSession
except ModuleNotFoundError:
    from curl_cffi import requests as _ccreq

    class _CcResp:
        """Réponse minimale compatible scrapling (.status / .headers / .body)."""
        __slots__ = ("status", "headers", "body")

        def __init__(self, r):
            self.status = r.status_code
            self.headers = r.headers
            self.body = r.content

    class FetcherSession:
        """Shim curl_cffi drop-in pour scrapling.FetcherSession (usage CI)."""

        def __init__(self, impersonate="chrome", verify=True, retries=1, **_):
            self._kw = dict(impersonate=impersonate, verify=verify)
            self._s = None

        def __enter__(self):
            self._s = _ccreq.Session(**self._kw)
            return self

        def __exit__(self, *_):
            if self._s is not None:
                self._s.close()
                self._s = None

        def _sess(self):
            if self._s is None:
                self._s = _ccreq.Session(**self._kw)
            return self._s

        def get(self, url, stealthy_headers=True, timeout=30, **_):
            return _CcResp(self._sess().get(url, timeout=timeout))

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

try:
    import pdfplumber
except ImportError:
    print("ERREUR : pdfplumber manquant — pip install pdfplumber")
    sys.exit(1)

try:
    import docx as python_docx
    from docx.oxml.ns import qn as docx_qn
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False

# ─── Config ────────────────────────────────────────────────────────────────────

MAX_PDF_SIZE_MB = 10
RATE_LIMIT_SEC  = 0.3
PAGE_FETCH_TIMEOUT = 20
MIN_FIELDS_FOR_SUCCESS = 2   # on accepte un parsing si on extrait ≥ 2 champs

# Colonnes effectivement présentes dans investissement_funds
DB_COLUMNS = frozenset({
    "isin", "name", "sri", "srri", "ter", "ongoing_charges",
    "kid_url", "kid_parsed_at", "kid_hash", "sfdr_article",
    "performance_1y", "performance_3y", "performance_5y",
    "aum_eur", "volatility_1y", "volatility_3y",
    "sharpe_1y", "sharpe_3y", "max_drawdown_1y", "max_drawdown_3y",
    "morningstar_rating", "track_record_years", "risk_level",
    "data_completeness", "updated_at",
    # Frais détaillés (migration 20260529000004)
    "entry_fee_max", "exit_fee_max", "performance_fee",
    "retrocession_cgp", "holding_period_years",
})

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Charlie-Investissement/1.0; data@charlie.fr)",
    "Accept":     "application/pdf,application/octet-stream,*/*",
}

# ─── Regex KID (format PRIIPs standardisé) ────────────────────────────────────
# On applique re.DOTALL | re.IGNORECASE. Les PDFs contiennent souvent des
# retours à la ligne inattendus dans les mots — les patterns tolèrent \s+.

FLAGS = re.DOTALL | re.IGNORECASE

KID_PATTERNS_FR = {
    "sri": [
        # Phrasing standardisé PRIIPS (texte espacé)
        r"class[eé](?:\w+)?\s+ce\s+produit\s+dans\s+la\s+classe\s+de\s+risque\s+(\d)\s+sur\s+7",
        r"classe\s+de\s+risque\s+(\d)\s+sur\s+7",
        # Phrasing PDFs concatenés (sans espaces) — \s* = 0 ou plusieurs espaces
        r"risque\s*(\d)\s*sur\s*7",
        r"indicateur\s+synth[eé]tique\s+de\s+risque[^\d]*(\d)\s*/\s*7",
        r"SRI[^\d]*(\d)\s*/\s*7",
        r"risque.*?(?:class[eé]|niveau)[^\d]*(\d)\s*/\s*7",
        # Fallback moins précis — à n'utiliser qu'en dernier recours
        r"(?:class[eé]|niveau)\s+de\s+risque[^\d]*?(\d)(?=\D)",
    ],
    "sfdr_article": [
        r"article\s+(9)\s+du\s+r[eè]glement\s+SFDR",
        r"article\s+(8)\s+du\s+r[eè]glement\s+SFDR",
        r"SFDR\s+article\s+(8|9)",
        r"conform[eé]ment?\s+[àa]\s+l.article\s+(8|9)",
        r"class[eé]\s+article\s+(8|9)",
        r"promotion\s+de\s+caract[eé]ristiques\s+(?:environnementales|sociales)",
        r"investissement\s+(?:durable|responsable)\s+comme\s+objectif",
    ],
    "ter": [
        # PRIORITÉ 1 : ligne PRIIPs "Frais de gestion et autres frais ... X%" = frais courants (TER).
        # C'est LA ligne ongoing-charges (≈ TER). NE PAS confondre avec "Incidence sur le rendement
        # annuel" (coût-drag à 1 an, qui inclut les coûts d'entrée amortis → surestime fortement).
        # NB structurés : la valeur suit souvent le libellé sur la ligne suivante et vaut
        # fréquemment "0%" (entier, pas de décimale) car les frais sont intégrés au prix d'émission.
        # → accepter entier OU décimale, et tolérer un saut de ligne (jusqu'à 60 chars).
        r"frais\s+de\s+gestion\s+et\s+autres\s+frais[^\d%]{0,60}(\d+(?:[.,]\d+)?)\s*%\s*de\s+votre\s+investissement\s+par\s+an",
        r"frais\s+de\s+gestion\s+et\s+autres\s+frais[^\d%]{0,60}(\d+(?:[.,]\d+)?)\s*%",
        r"frais\s+courants[^\d]*(\d+[.,]\d+)\s*%",
        r"charges\s+courantes[^\d]*(\d+[.,]\d+)\s*%",
        # PRIORITÉ 2 : Tableau "Coûts récurrents" ligne totale (pas les sous-lignes individuelles)
        r"co[uû]ts\s+r[eé]currents\s*\|[^|]*\|\s*(\d+[.,]\d+)\s*%",
        r"ratio\s+des\s+frais[^\d]*(\d+[.,]\d+)\s*%",
        # PDFs concatenés : "1,87%delavaleurdevotreinvestissement"
        r"co[uû]ts\s*r[eé]currents[^€\n]{0,200}?(\d+[.,]\d+)\s*%\s*de\s*la\s*valeur",
        r"(\d+[.,]\d{2})\s*%\s*de\s*la\s*valeur\s*de\s*votre\s*investissement\s*par\s*an",
        # PRIORITÉ 3 : ligne "Coûts récurrents" générique (dernier recours)
        r"co[uû]ts\s+r[eé]currents[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "entry_fee_max": [
        # PRIORITÉ structurés : "X% du montant que vous payez au moment de l'entrée" (valeur AVANT
        # le libellé "Coûts d'entrée"). Précis → à tester en premier, sinon les patterns .*? plus bas
        # traversent le doc (DOTALL) et attrapent un mauvais % (ex. coût de sortie "jusqu'à …").
        r"(\d+(?:[.,]\d+)?)\s*%\s*du\s+montant\s+que\s+vous\s+payez\s+au\s+moment\s+de\s+l.entr[eé]e",
        r"co[uû]ts\s+d.entr[eé]e.*?jusqu.[aà].*?(\d+[.,]\d+)\s*%",
        r"frais\s+d.entr[eé]e.*?(\d+[.,]\d+)\s*%",
        r"commission\s+de\s+souscription.*?(\d+[.,]\d+)\s*%",
    ],
    "exit_fee_max": [
        r"co[uû]ts\s+de\s+sortie.*?jusqu.[aà].*?(\d+[.,]\d+)\s*%",
        r"frais\s+de\s+sortie.*?(\d+[.,]\d+)\s*%",
        r"co[uû]ts\s+de\s+sortie[^\d]*(\d+[.,]\d+)\s*%",
        r"commission\s+de\s+rachat.*?(\d+[.,]\d+)\s*%",
    ],
    "performance_fee": [
        r"commission\s+de\s+surperformance[^\d]*(\d+[.,]\d+)\s*%",
        r"frais\s+de\s+performance[^\d]*(\d+[.,]\d+)\s*%",
        r"co[uû]ts\s+ponctuels[^\d]*surperformance[^\d]*(\d+[.,]\d+)\s*%",
        r"performance\s+fee[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "holding_period": [
        r"p[eé]riode\s*(?:minimale\s*de\s*)?d[eé]tention\s*recommand[eé]e\s*:?\s*(\d+)\s*ans?",
        r"p[eé]riode\s+(?:minimale\s+de\s+d[eé]tention|de\s+d[eé]tention\s+recommand[eé]e)[^\d]*(\d+)\s*an",
        r"dur[eé]e\s+recommand[eé]e.*?(\d+)\s*an",
        r"horizon\s+de\s+placement[^\d]*(\d+)\s*an",
    ],
    "perf_moderate_5y": [
        r"sc[eé]nario\s+(?:interm[eé]diaire|mod[eé]r[eé]).*?5\s*ans[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
        r"5\s*ans.*?sc[eé]nario\s+(?:interm[eé]diaire|mod[eé]r[eé])[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
    ],
    "perf_moderate_1y": [
        r"sc[eé]nario\s+(?:interm[eé]diaire|mod[eé]r[eé]).*?1\s*an[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
    ],
}

KID_PATTERNS_EN = {
    "sri": [
        r"summary\s+risk\s+indicator[^\d]*(\d)\s*/\s*7",
        r"risk\s+(?:class|indicator|level)[^\d]*(\d)\s*/\s*7",
        r"(?:class|level)\s+(\d)\s+out\s+of\s+7",
        r"classified\s+(?:this\s+)?product\s+(?:in\s+)?(?:risk\s+)?class\s+(\d)",
    ],
    "ter": [
        # PRIORITÉ 1 : "Management fees and other administrative/operating costs X%" = ongoing charges.
        # NE PAS prendre "annual cost impact / impact on return" (coût-drag à 1 an, surestime).
        r"management\s+fees\s+and\s+other[^\d%]{0,90}(\d+[.,]\d+)\s*%",
        r"ongoing\s+(?:charges?|costs?)[^\d]*(\d+[.,]\d+)\s*%",
        r"recurring\s+costs\s*\|[^|]*\|\s*(\d+[.,]\d+)\s*%",
        r"recurring\s+costs[^\d]*(\d+[.,]\d+)\s*%",
        r"annual\s+(?:management\s+)?(?:charge|fee)[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "entry_fee_max": [
        r"entry\s+costs?.*?up\s+to\s+(\d+[.,]\d+)\s*%",
        r"entry\s+(?:charge|fee).*?(\d+[.,]\d+)\s*%",
    ],
    "exit_fee_max": [
        r"exit\s+costs?.*?up\s+to\s+(\d+[.,]\d+)\s*%",
        r"exit\s+(?:charge|fee).*?(\d+[.,]\d+)\s*%",
        r"redemption\s+(?:charge|fee).*?(\d+[.,]\d+)\s*%",
    ],
    "performance_fee": [
        r"performance\s+fee[^\d]*(\d+[.,]\d+)\s*%",
        r"performance[\s\-]+related\s+(?:fee|cost)[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "holding_period": [
        r"recommended\s+holding\s+period[^\d]*(\d+)\s*year",
        r"recommended\s+investment\s+horizon[^\d]*(\d+)\s*year",
    ],
    "perf_moderate_5y": [
        r"(?:moderate|intermediate)\s+scenario.*?5\s*year[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
    ],
    "perf_moderate_1y": [
        r"(?:moderate|intermediate)\s+scenario.*?1\s*year[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
    ],
}


def extract_number(s: str) -> float | None:
    try:
        return float(s.replace(",", ".").strip())
    except (ValueError, AttributeError):
        return None

def try_patterns(text: str, patterns: list[str]) -> str | None:
    for pat in patterns:
        m = re.search(pat, text, FLAGS)
        if m:
            return m.group(1).strip()
    return None

def parse_kid_text(text: str) -> dict:
    """Extrait les données structurées d'un texte KID (FR ou EN)."""
    result = {}
    confidence = 0

    # Détecter la langue — uniquement mots avec accents obligatoires ou lexique FR exclusif
    # (éviter "scénario"→"scenario" et "coûts"→ fausse détection sur textes EN)
    is_french = bool(re.search(
        r"co[uû]ts|scénarios?|souscription|indicateur\s+synth[eé]tique|frais\s+courants"
        r"|montant\s+investi|pertes\s+et\s+profits|remboursement",
        text, re.IGNORECASE,
    ))

    def _parse_with_patterns(pats: dict) -> tuple[dict, int]:
        r: dict = {}
        conf = 0
        # SRI
        raw = try_patterns(text, pats["sri"])
        if raw and raw.isdigit() and 1 <= int(raw) <= 7:
            r["sri"] = int(raw)
            conf += 25
        # SFDR
        sfdr_pats = pats.get("sfdr_article", [])
        if sfdr_pats:
            for pat in sfdr_pats:
                m = re.search(pat, text, FLAGS)
                if m:
                    g = m.group(1) if m.lastindex and m.group(1).isdigit() else None
                    if g in ("8", "9"):
                        r["sfdr_article"] = int(g)
                    elif "objectif" in pat or "investissement durable" in pat.lower():
                        r["sfdr_article"] = 9
                    elif "caract" in pat:
                        r["sfdr_article"] = 8
                    break
        # TER — convention DB v3 = FRACTION (0.0033 = 0.33%), cf. data-standards-v3 §11.1
        # + contrainte CHECK chk_ter_fraction (ter ∈ [0, 0.5]). Le KID donne un % → ÷100.
        raw = try_patterns(text, pats["ter"])
        val = extract_number(raw) if raw else None
        # TER=0 est LÉGITIME pour les structurés (frais intégrés au prix d'émission).
        if val is not None and 0 <= val < 10:
            r["ter"] = round(val / 100, 6)
            r["ongoing_charges"] = round(val / 100, 6)
            conf += 25
        # Entry fee
        raw = try_patterns(text, pats["entry_fee_max"])
        val = extract_number(raw) if raw else None
        if val is not None and 0 <= val <= 10:
            r["entry_fee_max"] = round(val / 100, 6)
            conf += 10
        # Exit fee
        raw = try_patterns(text, pats.get("exit_fee_max", []))
        val = extract_number(raw) if raw else None
        if val is not None and 0 <= val <= 10:
            r["exit_fee_max"] = round(val / 100, 6)
        # Performance fee
        raw = try_patterns(text, pats.get("performance_fee", []))
        val = extract_number(raw) if raw else None
        if val is not None and 0 <= val <= 60:
            r["performance_fee"] = round(val / 100, 6)
        # Holding period
        raw = try_patterns(text, pats["holding_period"])
        val = extract_number(raw) if raw else None
        if val is not None and 1 <= val <= 30:
            r["holding_period_years"] = int(val)
            conf += 15
        # Perf scenarios
        raw = try_patterns(text, pats["perf_moderate_5y"])
        val = extract_number(raw) if raw else None
        if val is not None and -50 < val < 100:
            r["perf_scenario_moderate_5y"] = round(val / 100, 6)
            conf += 15
        raw = try_patterns(text, pats["perf_moderate_1y"])
        val = extract_number(raw) if raw else None
        if val is not None and -50 < val < 100:
            r["perf_scenario_moderate_1y"] = round(val / 100, 6)
            conf += 10
        return r, conf

    # Essayer la langue détectée en premier, fallback sur l'autre
    primary_pats   = KID_PATTERNS_FR if is_french else KID_PATTERNS_EN
    secondary_pats = KID_PATTERNS_EN if is_french else KID_PATTERNS_FR

    result, confidence = _parse_with_patterns(primary_pats)
    if confidence < 25:
        result2, conf2 = _parse_with_patterns(secondary_pats)
        if conf2 > confidence:
            result, confidence = result2, conf2
            is_french = not is_french  # langue corrigée

    result["_confidence"] = confidence
    result["_lang"] = "fr" if is_french else "en"
    return result


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extrait le texte d'un PDF via pdfplumber."""
    text_parts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages[:6]:  # KID = 3 pages max, on prend 6 pour tolérance
            t = page.extract_text(x_tolerance=3, y_tolerance=3)
            if t:
                text_parts.append(t)
    return "\n".join(text_parts)


def extract_docx_text(docx_bytes: bytes) -> str:
    """Extrait le texte d'un DOCX (Word) en préservant l'ordre paragraphes/tables."""
    if not DOCX_AVAILABLE:
        return ""
    doc = python_docx.Document(io.BytesIO(docx_bytes))
    text_parts = []

    def _iter_blocks(parent):
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        body = parent.element.body
        for child in body.iterchildren():
            if child.tag == docx_qn("w:p"):
                yield Paragraph(child, parent)
            elif child.tag == docx_qn("w:tbl"):
                yield Table(child, parent)

    for block in _iter_blocks(doc):
        if hasattr(block, "text"):
            t = block.text.strip()
            if t:
                text_parts.append(t)
        else:
            for row in block.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    text_parts.append(" | ".join(cells))

    return "\n".join(text_parts)


def llm_parse_kid(text: str, isin: str) -> dict:
    """Fallback LLM (Claude Haiku) pour les PDFs difficiles."""
    import os
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {}

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        prompt = f"""Extrait les données suivantes du texte de ce KID (Key Information Document) pour le fonds {isin}.
Réponds UNIQUEMENT en JSON valide, sans texte autour.

Champs à extraire (null si absent) :
- sri: entier 1-7 (Summary Risk Indicator / Indicateur de risque)
- ter: nombre décimal en fraction (ex: 0.0085 pour 0.85%)
- entry_fee_max: nombre décimal en fraction (ex: 0.03 pour 3%)
- recommended_holding_years: entier (période de détention recommandée en années)
- perf_scenario_moderate_5y: nombre décimal en fraction (scénario modéré 5 ans)

Texte KID :
{text[:18000]}

JSON:"""

        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_json = msg.content[0].text.strip()
        # Nettoyer les balises markdown éventuelles
        raw_json = re.sub(r"```(?:json)?\s*|\s*```", "", raw_json)
        parsed = json.loads(raw_json)
        parsed["_confidence"] = 70
        parsed["_source"]     = "llm"
        return parsed
    except Exception as e:
        print(f"      LLM fallback échoué ({e})")
        return {}


def download_document(session: FetcherSession, url: str) -> tuple[bytes, str] | tuple[None, None]:
    """Télécharge un document KID. Retourne (bytes, format) avec format='pdf' ou 'docx'."""
    def _parse_page(page) -> tuple[bytes, str] | tuple[None, None]:
        if page.status != 200:
            return None, None
        content_len = int(page.headers.get("Content-Length", 0)) if hasattr(page, "headers") else 0
        if content_len > MAX_PDF_SIZE_MB * 1_000_000:
            return None, None
        data = page.body
        if data.startswith(b"%PDF"):
            return data, "pdf"
        if data[:2] == b"PK":
            cd = page.headers.get("Content-Disposition", "") if hasattr(page, "headers") else ""
            if ".docx" in cd.lower() or b"[Content_Types]" in data[:200]:
                return data, "docx"
        return None, None

    try:
        page = session.get(url, stealthy_headers=True, timeout=PAGE_FETCH_TIMEOUT)
        result = _parse_page(page)
        if result[0] is not None:
            return result
        # Scrapling returned HTML (e.g. Morningstar viewer) — fallback to raw requests
        try:
            r = _requests.get(
                url,
                headers={"User-Agent": "Mozilla/5.0", "Accept": "application/pdf,*/*"},
                timeout=PAGE_FETCH_TIMEOUT,
                verify=True,
            )
            if r.status_code == 200:
                data = r.content
                if data[:4] == b"%PDF" and len(data) < MAX_PDF_SIZE_MB * 1_000_000:
                    return data, "pdf"
        except Exception:
            pass
        return None, None
    except Exception as e:
        # Retry sans vérification SSL (certificat expiré chez certains hébergeurs SGP)
        err = str(e).lower()
        if "certificate" in err or "ssl" in err or "curl: (60)" in str(e):
            try:
                nossl = FetcherSession(impersonate="chrome", verify=False, retries=1)
                with nossl as ns:
                    page = ns.get(url, stealthy_headers=True, timeout=PAGE_FETCH_TIMEOUT)
                    return _parse_page(page)
            except Exception:
                return None, None
        return None, None


def download_pdf(session: FetcherSession, url: str) -> bytes | None:
    data, fmt = download_document(session, url)
    return data if fmt == "pdf" else None


# Champs que le KID fait AUTORITÉ — on override + on trace dans field_sources.
# (Le KID/DICI PRIIPs est la source légale pour SRI, SFDR, frais courants, frais d'entrée/sortie.)
KID_AUTHORITATIVE = frozenset({
    "sri", "sfdr_article", "ter", "ongoing_charges",
    "entry_fee_max", "exit_fee_max", "performance_fee", "holding_period_years",
})


def kid_write(isin: str, fields: dict, pdf_hash: str, fill_only: bool = False) -> bool:
    """
    Écrit les champs parsés du KID en mergeant field_sources (tag 'kid_pdf').
    Le KID est autoritaire → override des champs ci-dessus. NE recalcule PAS
    data_completeness (laissé au recompute v2 SQL post-run, cf. README).

    fill_only=True : ne remplit QUE les champs actuellement NULL en base (aucune
    réécriture de valeur existante — sûr en environnement multi-agents / PROD).
    """
    client = get_client()
    try:
        sel_cols = "field_sources" + (
            "," + ",".join(sorted(fields)) if fill_only and fields else ""
        )
        existing = client.table("investissement_funds") \
            .select(sel_cols).eq("isin", isin).limit(1).execute().data
        row = existing[0] if existing else {}
        if fill_only:
            fields = {k: v for k, v in fields.items() if row.get(k) is None}
            if not fields:
                return True  # rien à remplir (tout déjà présent) — pas d'écriture
        fs = dict((row.get("field_sources") if row else None) or {})
        for k in fields:
            if k in KID_AUTHORITATIVE:
                fs[k] = "kid_pdf"
        payload = {
            **fields,
            "kid_hash": pdf_hash,
            "kid_parsed_at": datetime.now(timezone.utc).isoformat(),
            "field_sources": fs,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        for attempt in range(3):
            try:
                client.table("investissement_funds").update(payload).eq("isin", isin).execute()
                return True
            except Exception as e:
                if "chk_ter" in str(e) or "23514" in str(e):
                    # Garde-fou : un TER hors [0,0.5] = parse douteux → on retire les frais et on retente
                    payload.pop("ter", None); payload.pop("ongoing_charges", None)
                    fs.pop("ter", None); fs.pop("ongoing_charges", None)
                    payload["field_sources"] = fs
                    continue
                if attempt == 2:
                    return False
        return False
    except Exception:
        return False


def process_fund(fund: dict, session: FetcherSession, apply: bool, use_llm: bool,
                 fill_only: bool = False) -> dict:
    isin    = fund["isin"]
    kid_url = fund.get("kid_url", "")

    result = {"isin": isin, "status": "skip", "fields": 0}

    if not kid_url:
        result["status"] = "no_url"
        return result

    time.sleep(RATE_LIMIT_SEC)
    doc_bytes, doc_fmt = download_document(session, kid_url)
    if not doc_bytes:
        result["status"] = "download_failed"
        return result

    # Hash pour détecter si le KID a changé
    pdf_hash = hashlib.sha256(doc_bytes).hexdigest()

    # Extraction texte + parsing
    try:
        if doc_fmt == "docx":
            text = extract_docx_text(doc_bytes)
        else:
            text = extract_pdf_text(doc_bytes)
    except Exception as e:
        result["status"] = f"pdf_error:{e}"
        return result

    extracted = parse_kid_text(text)
    confidence = extracted.pop("_confidence", 0)
    extracted.pop("_lang", None)

    # Fallback LLM si confiance insuffisante
    if use_llm and confidence < 50:
        llm_data = llm_parse_kid(text, isin)
        llm_data.pop("_confidence", None)
        llm_data.pop("_source", None)
        extracted.update({k: v for k, v in llm_data.items() if v is not None})

    n_fields = len([k for k, v in extracted.items() if v is not None and not k.startswith("_")])
    result["fields"] = n_fields

    if n_fields < MIN_FIELDS_FOR_SUCCESS:
        result["status"] = "low_confidence"
        return result

    # Mise à jour Supabase
    if apply:
        fields = {k: v for k, v in extracted.items()
                  if not k.startswith("_") and k in DB_COLUMNS and v is not None}
        success = kid_write(isin, fields, pdf_hash, fill_only=fill_only)
        result["status"] = "ok" if success else "upsert_failed"
    else:
        result["status"] = "ok_dryrun"
        result["preview"] = extracted

    return result


def fetch_funds_with_kid_url(client, min_aum: int | None, force: bool, limit: int | None,
                             geco_only: bool = False, ter_null: bool = False,
                             amfinesoft_only: bool = False,
                             product_type: str | None = None) -> list[dict]:
    """Récupère les fonds avec kid_url depuis Supabase (pagination complète)."""
    PAGE = 1000
    all_funds: list[dict] = []
    offset = 0

    while True:
        q = client.table("investissement_funds") \
            .select("isin, name, kid_url, kid_parsed_at, aum_eur") \
            .not_.is_("kid_url", "null") \
            .neq("kid_url", "")

        if not force and not ter_null:
            q = q.is_("kid_parsed_at", "null")
        if ter_null:
            q = q.is_("ter", "null")
        if geco_only:
            q = q.like("kid_url", "https://geco.amf-france.org/%")
        if amfinesoft_only:
            # Exclut les kid-security (actions/obligations), garde les vrai KIDs fonds
            q = q.like("kid_url", "%amfinesoft.com%/kid/%").not_.like("kid_url", "%-security%")
        if product_type:
            q = q.eq("product_type", product_type)
        if min_aum:
            q = q.gte("aum_eur", min_aum)

        q = q.order("aum_eur", desc=True).range(offset, offset + PAGE - 1)
        batch = q.execute().data or []
        all_funds.extend(batch)

        if len(batch) < PAGE:
            break
        if limit and len(all_funds) >= limit:
            break
        offset += PAGE

    if limit:
        all_funds = all_funds[:limit]
    return all_funds


def run(apply: bool, limit: int | None, workers: int, min_aum: int | None, force: bool,
        use_llm: bool, geco_only: bool = False, ter_null: bool = False,
        amfinesoft_only: bool = False, product_type: str | None = None,
        fill_only: bool = False):
    print("=" * 60)
    print("  KID Bulk Parser — Extraction TER + SRI depuis PDFs")
    print("=" * 60)
    print(f"  Mode      : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Workers   : {workers}")
    print(f"  Min AUM   : {min_aum:,}€" if min_aum else "  Min AUM   : tous")
    print(f"  Force     : {force}")
    print(f"  LLM       : {'OUI (Claude Haiku)' if use_llm else 'NON'}")
    if geco_only:
        print("  Filtre    : GECO uniquement (geco.amf-france.org)")
    if amfinesoft_only:
        print("  Filtre    : Amfinesoft /kid/ uniquement (OPCVM FR)")
    if ter_null:
        print("  Filtre    : TER null uniquement")
    if limit:
        print(f"  Limite    : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    if product_type:
        print(f"  Product   : {product_type}")
    funds = fetch_funds_with_kid_url(client, min_aum, force, limit, geco_only=geco_only,
                                     ter_null=ter_null, amfinesoft_only=amfinesoft_only,
                                     product_type=product_type)
    print(f"  {len(funds)} fonds avec kid_url à traiter")
    print()

    session = FetcherSession(impersonate="chrome").__enter__()
    counters = {"ok": 0, "skip": 0, "no_url": 0, "download_failed": 0,
                "low_confidence": 0, "pdf_error": 0, "upsert_failed": 0}

    def _process(fund):
        return process_fund(fund, session, apply, use_llm, fill_only=fill_only)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_process, f): f for f in funds}
        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                r = future.result()
            except Exception as e:
                r = {"status": f"exception:{e}", "fields": 0}

            st = r["status"]
            if st.startswith("ok"):
                counters["ok"] += 1
            elif st in counters:
                counters[st] += 1
            else:
                counters["pdf_error"] += 1

            if i % 50 == 0 or i == len(funds):
                print(f"  [{i:5d}/{len(funds)}] "
                      f"OK:{counters['ok']} skip:{counters['skip']} "
                      f"no_url:{counters['no_url']} fail:{counters['download_failed']} "
                      f"low:{counters['low_confidence']}")

    print()
    print(f"  ✓ Terminé — {counters['ok']} fonds enrichis")
    if not apply:
        # Afficher les aperçus
        session2 = FetcherSession(impersonate="chrome").__enter__()
        for f in funds[:3]:
            r = process_fund(f, session2, False, use_llm)
            print(f"  {f['isin']} → {r.get('preview', {})}")

    if apply:
        log_run(
            scraper="kid-bulk-parser",
            status="success" if counters["ok"] > 0 else "partial",
            records_processed=counters["ok"],
            records_failed=counters["download_failed"] + counters["low_confidence"],
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KID Bulk Parser — extraction TER/SRI")
    parser.add_argument("--apply",   action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",   type=int,            help="Limiter à N fonds")
    parser.add_argument("--workers", type=int, default=10, help="Parallélisme (défaut: 10)")
    parser.add_argument("--min-aum", type=int, default=50_000_000,
                        help="AUM minimum en € (défaut: 50M)")
    parser.add_argument("--force",     action="store_true", help="Re-parser même si déjà fait")
    parser.add_argument("--llm",       action="store_true", help="Activer fallback Claude Haiku")
    parser.add_argument("--geco-only", action="store_true",
                        help="Traiter uniquement les URLs GECO (geco.amf-france.org)")
    parser.add_argument("--amfinesoft-only", action="store_true",
                        help="Traiter uniquement les KIDs OPCVM amfinesoft (/kid/ sans -security)")
    parser.add_argument("--ter-null", action="store_true",
                        help="Traiter uniquement les fonds sans TER (ter IS NULL)")
    parser.add_argument("--product-type", type=str, default=None,
                        help="Filtrer par product_type (ex: structuré)")
    parser.add_argument("--fill-only", action="store_true",
                        help="Ne remplir que les champs NULL en base (aucune réécriture)")
    args = parser.parse_args()
    run(
        apply=args.apply,
        limit=args.limit,
        workers=args.workers,
        min_aum=args.min_aum,
        force=args.force,
        use_llm=args.llm,
        geco_only=args.geco_only,
        ter_null=args.ter_null,
        amfinesoft_only=args.amfinesoft_only,
        product_type=args.product_type,
        fill_only=args.fill_only,
    )
