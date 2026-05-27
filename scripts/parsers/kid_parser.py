#!/usr/bin/env python3
"""
kid-parser.py  —  T1-3 Charlie Data V2

Module d'extraction de données depuis les PDFs KID/DICI (Key Information Document).
Utilisé par kid-downloader.py — ne pas appeler directement en production.

Stratégie d'extraction (par ordre de priorité) :
  1. Regex robustes sur le texte brut du PDF (pdfplumber)
  2. Fallback LLM (Claude Haiku) si le regex ne trouve pas les champs critiques

Champs extraits :
  - sri       : Indicateur synthétique de risque (1-7)
  - srri      : alias sri (si KIID pré-2023)
  - ongoing_charges : frais courants (float, ex: 0.0089 pour 0.89%)
  - sfdr_article    : 6, 8 ou 9 (si mentionné)
  - objective       : résumé objectif d'investissement (premier paragraphe)
  - kid_date        : date de publication du KID (YYYY-MM-DD)

Usage comme module :
    from parsers.kid_parser import parse_kid_pdf
    result = parse_kid_pdf(pdf_bytes)
    # → {"sri": 3, "ongoing_charges": 0.0089, "sfdr_article": 8, ...}

Usage CLI (debug) :
    python3 scripts/parsers/kid-parser.py /path/to/kid.pdf
"""

import re
import sys
import json
from pathlib import Path
from datetime import datetime
from typing import Any


# ─── Patterns regex ───────────────────────────────────────────────────────────

# SRI / SRRI — Indicateur synthétique de risque (1 à 7)
# KID PRIIPs (2023+) : "Indicateur synthétique de risque" / "Summary Risk Indicator"
# KIID UCITS (avant 2023) : "Profil de risque et de rendement" SRRI
#
# ATTENTION : ne pas utiliser DOTALL sur les patterns SRI — les tables "1 2 3 4 5 6 7"
# font partie du texte et le moteur greedy matcherait "1" au lieu de la valeur réelle.
_SRI_PATTERNS = [
    # FR strict : "Indicateur synthétique de risque : 4 sur"  (même ligne)
    re.compile(
        r"indicateur\s+synth[eé]tique\s+de\s+risque\s*:\s*([1-7])\s+sur",
        re.IGNORECASE,
    ),
    # FR : "risque : 4 sur une échelle"  (pour les formats sans le titre complet)
    re.compile(
        r"\brisque\s*:\s*([1-7])\s+sur",
        re.IGNORECASE,
    ),
    # EN strict : "Summary Risk Indicator: 5 out of 7"
    re.compile(
        r"summary\s+risk\s+indicator\s*:\s*([1-7])\s+out",
        re.IGNORECASE,
    ),
    # EN : "Risk Indicator: 3 out of"
    re.compile(
        r"risk\s+indicator\s*:\s*([1-7])\s+out",
        re.IGNORECASE,
    ),
    # EN : "Risk Indicator: 3" (sans "out of", mais avec deux-points)
    re.compile(
        r"risk\s+indicator\s*:\s*([1-7])\b",
        re.IGNORECASE,
    ),
    # FR KIID UCITS : "La catégorie de risque 3 est basée"
    re.compile(
        r"cat[eé]gorie\s+de\s+risque\s+([1-7])\s+est\s+bas[eé]e",
        re.IGNORECASE,
    ),
]

# Frais courants / Ongoing charges
_CHARGES_PATTERNS = [
    # FR : "Frais courants 0,89 %" (virgule décimale française)
    re.compile(
        r"frais\s+courants\s*[:\-]?\s*(\d+)[,.](\d+)\s*%",
        re.DOTALL | re.IGNORECASE,
    ),
    # FR : "Coûts ponctuels ... Coûts récurrents ... 0,89%"
    re.compile(
        r"co[uû]ts?\s+r[eé]currents?\s*[:\-]?\s*(\d+)[,.](\d+)\s*%",
        re.DOTALL | re.IGNORECASE,
    ),
    # EN : "Ongoing charges 0.89%"
    re.compile(
        r"ongoing\s+charges?\s*[:\-]?\s*(\d+)[,.](\d+)\s*%",
        re.DOTALL | re.IGNORECASE,
    ),
    # EN : "Ongoing costs ... 0.89%"
    re.compile(
        r"ongoing\s+costs?\s*[:\-]?\s*(\d+)[,.](\d+)\s*%",
        re.DOTALL | re.IGNORECASE,
    ),
    # EN : "Total ongoing charges ... 0.89%"
    re.compile(
        r"total\s+ongoing\s+charges?\s*[:\-]?\s*(\d+)[,.](\d+)\s*%",
        re.DOTALL | re.IGNORECASE,
    ),
]

# SFDR — classification article
_SFDR_PATTERNS = [
    re.compile(r"article\s+(6|8|9)\s+(?:du\s+r[eè]glement|of\s+the\s+regulation|SFDR|DPEF)", re.DOTALL | re.IGNORECASE),
    re.compile(r"r[eè]glement\s+(?:SFDR|2019/2088)[^\n]{0,80}article\s+(6|8|9)\b", re.DOTALL | re.IGNORECASE),
    re.compile(r"\bsfdr\b[^\n]{0,60}article\s+(6|8|9)\b", re.DOTALL | re.IGNORECASE),
    re.compile(r"article\s+(6|8|9)\s+fund\b", re.DOTALL | re.IGNORECASE),
]

# Date de publication — ancré sur "20xx" pour éviter les ambiguïtés
# Ordre : ISO > DD/MM/YYYY > DD.MM.YYYY
_DATE_PATTERNS = [
    # ISO : 2024-01-15
    re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b"),
    # FR : 15/01/2024
    re.compile(r"\b(\d{1,2})/(\d{1,2})/(20\d{2})\b"),
    # FR : 15.01.2024
    re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b"),
]


# ─── Extraction PDF ────────────────────────────────────────────────────────────

def _extract_text(pdf_bytes: bytes) -> str:
    """Extrait le texte brut d'un PDF avec pdfplumber."""
    try:
        import pdfplumber
        import io
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = []
            for page in pdf.pages:
                text = page.extract_text(x_tolerance=2, y_tolerance=2)
                if text:
                    pages.append(text)
            return "\n".join(pages)
    except ImportError:
        raise ImportError("pdfplumber non installé — run: pip install pdfplumber")
    except Exception as e:
        raise ValueError(f"Impossible de lire le PDF : {e}")


# ─── Extraction par regex ──────────────────────────────────────────────────────

def _extract_sri(text: str) -> int | None:
    for pattern in _SRI_PATTERNS:
        m = pattern.search(text)
        if m:
            val = int(m.group(1))
            if 1 <= val <= 7:
                return val
    return None


def _extract_charges(text: str) -> float | None:
    for pattern in _CHARGES_PATTERNS:
        m = pattern.search(text)
        if m:
            int_part = m.group(1)
            dec_part = m.group(2)
            pct = float(f"{int_part}.{dec_part}")
            # Sanity check : frais courants entre 0.01% et 10%
            if 0.01 <= pct <= 10.0:
                return round(pct / 100, 6)  # stocker en décimal (0.0089)
    return None


def _extract_sfdr(text: str) -> int | None:
    for pattern in _SFDR_PATTERNS:
        m = pattern.search(text)
        if m:
            val = int(m.group(1))
            if val in (6, 8, 9):
                return val
    return None


def _extract_date(text: str) -> str | None:
    for i, pattern in enumerate(_DATE_PATTERNS):
        m = pattern.search(text)
        if m:
            try:
                a, b, c = m.group(1), m.group(2), m.group(3)
                if i == 0:
                    # ISO : a=YYYY, b=MM, c=DD
                    return f"{a}-{b.zfill(2)}-{c.zfill(2)}"
                else:
                    # FR : a=DD, b=MM, c=YYYY
                    return f"{c}-{b.zfill(2)}-{a.zfill(2)}"
            except Exception:
                continue
    return None


def _extract_objective(text: str) -> str | None:
    """Extrait le premier paragraphe de l'objectif d'investissement."""
    patterns = [
        re.compile(r"(?:objectif(?:s)?\s+(?:d'investissement|de\s+gestion)|objectifs?\s+et\s+politique\s+d'investissement)[:\s]*\n(.{50,500}?)(?:\n\n|\Z)", re.DOTALL | re.IGNORECASE),
        re.compile(r"(?:investment\s+objective|objective\s+and\s+investment\s+policy)[:\s]*\n(.{50,500}?)(?:\n\n|\Z)", re.DOTALL | re.IGNORECASE),
    ]
    for p in patterns:
        m = p.search(text)
        if m:
            obj = m.group(1).strip().replace("\n", " ")
            if len(obj) >= 50:
                return obj[:500]
    return None


# ─── Fallback LLM ─────────────────────────────────────────────────────────────

def _llm_extract(text: str, missing_fields: list[str]) -> dict:
    """
    Fallback Claude Haiku pour les champs manquants après regex.
    Ne fait qu'un seul appel API pour tous les champs manquants.
    """
    try:
        import anthropic
    except ImportError:
        return {}

    api_key_path = Path(__file__).parent.parent.parent / ".env"
    if api_key_path.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(api_key_path)
        except ImportError:
            pass

    import os
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {}

    # Limiter le texte envoyé au LLM (coût)
    truncated = text[:4000]

    fields_desc = {
        "sri": "Indicateur synthétique de risque (entier 1-7) — chercher 'Indicateur synthétique de risque', 'Summary Risk Indicator', ou 'SRRI'",
        "ongoing_charges": "Frais courants en pourcentage (float, ex: 0.89 pour 0.89%) — chercher 'Frais courants', 'Ongoing charges'",
        "sfdr_article": "Classification SFDR (6, 8 ou 9 uniquement) — chercher 'Article 6/8/9' lié à SFDR/DPEF",
    }

    asked = {k: v for k, v in fields_desc.items() if k in missing_fields}
    if not asked:
        return {}

    prompt = f"""Extrait les informations suivantes depuis ce document KID/DICI de fonds d'investissement.
Réponds UNIQUEMENT avec un JSON valide, sans markdown.
Mets null si l'information est absente ou incertaine.

Champs à extraire :
{json.dumps(asked, ensure_ascii=False, indent=2)}

Texte du document (tronqué) :
---
{truncated}
---

JSON attendu (exemple) :
{{"sri": 3, "ongoing_charges": 0.89, "sfdr_article": 8}}
"""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        # Nettoyer si le LLM met des backticks malgré la consigne
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        result = json.loads(raw)

        # Validation et normalisation
        out = {}
        if "sri" in result and result["sri"] is not None:
            val = int(result["sri"])
            if 1 <= val <= 7:
                out["sri"] = val
        if "ongoing_charges" in result and result["ongoing_charges"] is not None:
            val = float(result["ongoing_charges"])
            # Le LLM peut renvoyer 0.89 (%) ou 0.0089 (décimal)
            if val > 0.1:
                val = round(val / 100, 6)
            if 0.0001 <= val <= 0.10:
                out["ongoing_charges"] = val
        if "sfdr_article" in result and result["sfdr_article"] is not None:
            val = int(result["sfdr_article"])
            if val in (6, 8, 9):
                out["sfdr_article"] = val
        return out
    except Exception:
        return {}


# ─── Point d'entrée public ────────────────────────────────────────────────────

def parse_kid_pdf(pdf_bytes: bytes, use_llm: bool = True) -> dict[str, Any]:
    """
    Extrait les méta-données clés d'un KID/DICI PDF.

    Args:
        pdf_bytes : contenu binaire du PDF (jamais écrit sur disque)
        use_llm   : activer le fallback LLM si regex incomplet (défaut : True)

    Returns:
        dict avec les clés disponibles parmi :
          sri, srri, ongoing_charges, sfdr_article, objective, kid_date
        Les clés absentes du document sont omises (pas de None).
    """
    text = _extract_text(pdf_bytes)

    result: dict[str, Any] = {}

    sri = _extract_sri(text)
    if sri is not None:
        result["sri"] = sri
        result["srri"] = sri  # alias rétrocompat

    charges = _extract_charges(text)
    if charges is not None:
        result["ongoing_charges"] = charges

    sfdr = _extract_sfdr(text)
    if sfdr is not None:
        result["sfdr_article"] = sfdr

    objective = _extract_objective(text)
    if objective:
        result["objective"] = objective

    kid_date = _extract_date(text)
    if kid_date:
        result["kid_date"] = kid_date

    # Fallback LLM pour les champs critiques manquants
    if use_llm:
        missing = [f for f in ("sri", "ongoing_charges") if f not in result]
        if missing:
            llm_result = _llm_extract(text, missing)
            for k, v in llm_result.items():
                if k not in result:
                    result[k] = v
                    if k == "sri":
                        result["srri"] = v  # alias

    return result


# ─── CLI debug ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 kid-parser.py <path_to_kid.pdf>")
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(f"Fichier introuvable : {pdf_path}")
        sys.exit(1)

    pdf_bytes = pdf_path.read_bytes()
    print(f"Analyse de {pdf_path.name} ({len(pdf_bytes):,} octets)...\n")

    result = parse_kid_pdf(pdf_bytes, use_llm=("--no-llm" not in sys.argv))

    print("Résultat :")
    for k, v in result.items():
        print(f"  {k:<20} = {v}")

    if not result:
        print("  (aucun champ extrait)")
