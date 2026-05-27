# Pipeline Mail Tier 3 — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire un pipeline complet qui surveille la boîte Gmail d'un CGP, détecte les PDFs de reporting (lettres PE, bulletins SCPI, relevés assureurs), extrait les données structurées via LLM, et les upserte dans Supabase.

**Architecture:** Trois scripts cron indépendants (`mail-watcher` → `pdf-classifier` → `pdf-extractor`) reliés par une table de tracking `mail_pipeline_log`. Chaque étape est relançable séparément. Les parsers LLM sont des modules réutilisables dans `scripts/parsers/`.

**Tech Stack:** Python 3.11+, `google-api-python-client` (Gmail OAuth2), `pdfplumber` (extraction texte PDF), `anthropic` SDK (`claude-haiku-4-5-20251001` pour classification, `claude-sonnet-4-6` pour extraction), `supabase` (DB), `pytest` (tests).

**Pré-requis :**
```bash
pip install google-auth google-auth-oauthlib google-api-python-client pytest
# pdfplumber et anthropic déjà installés dans le projet
```

---

## Structure des fichiers

```
migrations/
  create-mail-pipeline-tables.sql   # mail_pipeline_log
  create-pe-tables.sql              # investissement_pe_funds + investissement_pe_quarterly_reports

scripts/parsers/
  pe_parser.py                      # LLM extraction lettres PE + guardrails
  scpi_pdf_parser.py                # LLM extraction bulletins SCPI + guardrails

scripts/importers/
  mail-watcher.py                   # Gmail OAuth2 + polling → mail_pipeline_log
  pdf-classifier.py                 # received → classified (heuristique + LLM Haiku)
  pdf-extractor.py                  # classified → done (route vers pe/scpi/insurer)
  mail-pipeline-status.py           # tableau de bord observabilité

tests/
  conftest.py
  test_pe_parser.py
  test_scpi_pdf_parser.py
  test_pdf_classifier.py
  test_mail_watcher.py
```

---

## Task 1 : Migrations DB

**Files:**
- Create: `migrations/create-mail-pipeline-tables.sql`
- Create: `migrations/create-pe-tables.sql`

- [ ] **Écrire `migrations/create-mail-pipeline-tables.sql`**

```sql
-- Table de tracking du pipeline mail
CREATE TABLE IF NOT EXISTS mail_pipeline_log (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cgp_id              uuid NOT NULL,
    gmail_message_id    text UNIQUE NOT NULL,
    filename            text NOT NULL,
    received_at         timestamptz NOT NULL,
    doc_type            text CHECK (doc_type IN ('pe_letter', 'scpi_bulletin', 'insurer_statement', 'unknown')),
    status              text NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received', 'classified', 'done', 'failed', 'abandoned')),
    retry_count         int NOT NULL DEFAULT 0,
    error_msg           text,
    raw_pdf_path        text,
    extracted_json      jsonb,
    processed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_pipeline_log_status_idx ON mail_pipeline_log (status);
CREATE INDEX IF NOT EXISTS mail_pipeline_log_cgp_idx ON mail_pipeline_log (cgp_id);
```

- [ ] **Écrire `migrations/create-pe-tables.sql`**

```sql
-- Fonds PE connus (un par fonds)
CREATE TABLE IF NOT EXISTS investissement_pe_funds (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text UNIQUE NOT NULL,
    manager       text,
    vintage_year  int,
    strategy      text CHECK (strategy IN ('buyout', 'growth', 'venture', 'infrastructure', 'other')),
    currency      text NOT NULL DEFAULT 'EUR',
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Rapports trimestriels PE (un par fonds par trimestre)
CREATE TABLE IF NOT EXISTS investissement_pe_quarterly_reports (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id                   uuid NOT NULL REFERENCES investissement_pe_funds(id),
    report_date               date NOT NULL,
    nav_per_share             numeric,
    tri_since_inception       numeric,
    capital_called_pct        numeric,
    capital_distributed_pct   numeric,
    total_aum_eur             numeric,
    source_log_id             uuid REFERENCES mail_pipeline_log(id),
    created_at                timestamptz NOT NULL DEFAULT now(),
    UNIQUE (fund_id, report_date)
);

CREATE INDEX IF NOT EXISTS pe_reports_fund_idx ON investissement_pe_quarterly_reports (fund_id);
```

- [ ] **Appliquer les migrations dans Supabase**

Copier-coller chaque fichier dans l'éditeur SQL de Supabase (Dashboard → SQL Editor), ou via la CLI :
```bash
# Via psql si vous avez l'URL de connexion directe
psql "$DATABASE_URL" -f migrations/create-mail-pipeline-tables.sql
psql "$DATABASE_URL" -f migrations/create-pe-tables.sql
```
Vérifier : les tables `mail_pipeline_log`, `investissement_pe_funds`, `investissement_pe_quarterly_reports` existent.

- [ ] **Commit**

```bash
git add migrations/
git commit -m "feat: add mail pipeline and PE tables migrations"
```

---

## Task 2 : `pe_parser.py` — Extraction LLM lettres PE

**Files:**
- Create: `scripts/parsers/pe_parser.py`
- Create: `tests/test_pe_parser.py`

- [ ] **Écrire le test qui échoue**

```python
# tests/test_pe_parser.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from parsers.pe_parser import apply_guardrails, parse_llm_response


def test_guardrails_rejects_tri_over_100():
    data = {"tri_since_inception": 150.0, "nav_per_share": 100.0}
    result = apply_guardrails(data)
    assert result["tri_since_inception"] is None
    assert result["nav_per_share"] == 100.0  # inchangé

def test_guardrails_rejects_negative_tri():
    data = {"tri_since_inception": -60.0}
    result = apply_guardrails(data)
    assert result["tri_since_inception"] is None

def test_guardrails_accepts_valid_data():
    data = {
        "tri_since_inception": 18.5,
        "capital_called_pct": 67.0,
        "capital_distributed_pct": 12.0,
        "nav_per_share": 102.4,
        "total_aum_eur": 850_000_000,
    }
    result = apply_guardrails(data)
    assert result == data

def test_parse_llm_response_valid_json():
    raw = '{"fund_name": "Altaroc Odyssey 2024", "manager": "Altaroc", "report_date": "2024-12-31", "tri_since_inception": 18.5}'
    result = parse_llm_response(raw)
    assert result["fund_name"] == "Altaroc Odyssey 2024"
    assert result["tri_since_inception"] == 18.5

def test_parse_llm_response_extracts_json_from_prose():
    raw = 'Voici les données : ```json\n{"fund_name": "Test Fund", "tri_since_inception": 20.0}\n```'
    result = parse_llm_response(raw)
    assert result["fund_name"] == "Test Fund"

def test_parse_llm_response_returns_empty_on_invalid():
    result = parse_llm_response("pas de JSON ici")
    assert result == {}
```

- [ ] **Vérifier que les tests échouent**

```bash
cd "/Users/mathisbaala/Projects/charlie financial advisor/charlie-investissement"
python -m pytest tests/test_pe_parser.py -v
# Expected: ImportError ou ModuleNotFoundError
```

- [ ] **Écrire `scripts/parsers/pe_parser.py`**

```python
#!/usr/bin/env python3
"""
pe_parser.py — Extraction LLM depuis les lettres trimestrielles PE
==================================================================
Extrait : fund_name, manager, report_date, nav_per_share,
          tri_since_inception, capital_called_pct,
          capital_distributed_pct, total_aum_eur

Usage module :
    from parsers.pe_parser import extract_pe_letter
    result = extract_pe_letter(pdf_bytes, api_key="sk-ant-...")
"""

import re
import json
import io
from typing import Any

# ─── Guardrails ───────────────────────────────────────────────────────────────

_GUARDRAILS: dict[str, tuple[float, float]] = {
    "tri_since_inception":     (-50.0, 100.0),
    "capital_called_pct":      (0.0,   200.0),
    "capital_distributed_pct": (0.0,   200.0),
}


def apply_guardrails(data: dict) -> dict:
    """Nullifie les champs numériques hors plage. Retourne une copie."""
    result = dict(data)
    for field, (lo, hi) in _GUARDRAILS.items():
        val = result.get(field)
        if val is not None:
            try:
                v = float(val)
                if not (lo <= v <= hi):
                    result[field] = None
            except (TypeError, ValueError):
                result[field] = None
    return result


# ─── Parsing réponse LLM ──────────────────────────────────────────────────────

def parse_llm_response(raw: str) -> dict:
    """Extrait le JSON de la réponse LLM, même entouré de prose."""
    # Cherche un bloc ```json ... ```
    m = re.search(r"```json\s*(.*?)\s*```", raw, re.DOTALL)
    if m:
        raw = m.group(1)
    else:
        # Cherche le premier { ... } de niveau racine
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            raw = m.group(0)

    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return {}


# ─── Extraction PDF ────────────────────────────────────────────────────────────

def _pdf_to_text(pdf_bytes: bytes) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            return "\n".join(
                p.extract_text(x_tolerance=2, y_tolerance=2) or ""
                for p in pdf.pages
            )
    except ImportError:
        raise ImportError("pdfplumber non installé — pip install pdfplumber")


# ─── Prompt LLM ───────────────────────────────────────────────────────────────

_SYSTEM = """Tu es un assistant d'extraction de données financières.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour."""

_PROMPT_TPL = """Extrait les informations suivantes depuis cette lettre aux investisseurs d'un fonds de Private Equity.
Retourne null pour chaque champ introuvable.

Champs attendus :
- fund_name : nom complet du fonds (string)
- manager : nom de la société de gestion (string)
- report_date : date du rapport au format YYYY-MM-DD (string)
- nav_per_share : valeur liquidative par part en EUR (number)
- tri_since_inception : TRI depuis l'inception en % (number, ex: 18.5 pour 18.5%)
- capital_called_pct : pourcentage du capital appelé (number, ex: 67.0)
- capital_distributed_pct : pourcentage du capital distribué / DPI (number)
- total_aum_eur : taille totale du fonds en EUR (number)

Texte du document :
---
{text}
---

Réponds avec un objet JSON uniquement."""


def extract_pe_letter(pdf_bytes: bytes, api_key: str) -> dict[str, Any]:
    """
    Extrait les données d'une lettre trimestrielle PE.
    Retourne un dict avec les champs PE (champs manquants = None).
    """
    import anthropic

    text = _pdf_to_text(pdf_bytes)
    # Limite à ~12 000 tokens (≈ 48 000 caractères)
    text = text[:48_000]

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=_SYSTEM,
        messages=[{"role": "user", "content": _PROMPT_TPL.format(text=text)}],
    )

    raw = response.content[0].text
    data = parse_llm_response(raw)
    return apply_guardrails(data)
```

- [ ] **Créer `tests/conftest.py`**

```python
# tests/conftest.py
# Point d'entrée pytest — rien à configurer pour l'instant
```

- [ ] **Vérifier que les tests passent**

```bash
python -m pytest tests/test_pe_parser.py -v
# Expected: 6 passed
```

- [ ] **Commit**

```bash
git add scripts/parsers/pe_parser.py tests/test_pe_parser.py tests/conftest.py
git commit -m "feat: add PE letter LLM parser with guardrails"
```

---

## Task 3 : `scpi_pdf_parser.py` — Extraction LLM bulletins SCPI

**Files:**
- Create: `scripts/parsers/scpi_pdf_parser.py`
- Create: `tests/test_scpi_pdf_parser.py`

- [ ] **Écrire le test qui échoue**

```python
# tests/test_scpi_pdf_parser.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from parsers.scpi_pdf_parser import apply_scpi_guardrails, parse_llm_response


def test_guardrails_rejects_dvm_over_15():
    data = {"dvm_pct": 20.0, "tof_pct": 95.0}
    result = apply_scpi_guardrails(data)
    assert result["dvm_pct"] is None
    assert result["tof_pct"] == 95.0

def test_guardrails_rejects_negative_dvm():
    data = {"dvm_pct": -1.0}
    result = apply_scpi_guardrails(data)
    assert result["dvm_pct"] is None

def test_guardrails_accepts_valid_scpi_data():
    data = {
        "dvm_pct": 5.5,
        "tof_pct": 94.2,
        "nav_per_share": 1020.0,
        "capitalization_eur": 850_000_000,
    }
    result = apply_scpi_guardrails(data)
    assert result == data

def test_parse_llm_response_handles_json_block():
    raw = '```json\n{"scpi_name": "Primovie", "dvm_pct": 4.5}\n```'
    from parsers.scpi_pdf_parser import parse_llm_response as plr
    result = plr(raw)
    assert result["scpi_name"] == "Primovie"
    assert result["dvm_pct"] == 4.5
```

- [ ] **Vérifier que les tests échouent**

```bash
python -m pytest tests/test_scpi_pdf_parser.py -v
# Expected: ImportError
```

- [ ] **Écrire `scripts/parsers/scpi_pdf_parser.py`**

```python
#!/usr/bin/env python3
"""
scpi_pdf_parser.py — Extraction LLM depuis les bulletins trimestriels SCPI
===========================================================================
Extrait : scpi_name, report_date, dvm_pct, tof_pct,
          nav_per_share, capitalization_eur

Usage module :
    from parsers.scpi_pdf_parser import extract_scpi_bulletin
    result = extract_scpi_bulletin(pdf_bytes, api_key="sk-ant-...")
"""

import re
import json
import io
from typing import Any

# ─── Guardrails ───────────────────────────────────────────────────────────────

_GUARDRAILS: dict[str, tuple[float, float]] = {
    "dvm_pct": (0.0, 15.0),
    "tof_pct": (0.0, 100.0),
}


def apply_scpi_guardrails(data: dict) -> dict:
    """Nullifie les champs numériques hors plage. Retourne une copie."""
    result = dict(data)
    for field, (lo, hi) in _GUARDRAILS.items():
        val = result.get(field)
        if val is not None:
            try:
                v = float(val)
                if not (lo <= v <= hi):
                    result[field] = None
            except (TypeError, ValueError):
                result[field] = None
    return result


# ─── Parsing réponse LLM ──────────────────────────────────────────────────────

def parse_llm_response(raw: str) -> dict:
    """Extrait le JSON de la réponse LLM, même entouré de prose."""
    m = re.search(r"```json\s*(.*?)\s*```", raw, re.DOTALL)
    if m:
        raw = m.group(1)
    else:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            raw = m.group(0)
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return {}


# ─── Extraction PDF ────────────────────────────────────────────────────────────

def _pdf_to_text(pdf_bytes: bytes) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            return "\n".join(
                p.extract_text(x_tolerance=2, y_tolerance=2) or ""
                for p in pdf.pages
            )
    except ImportError:
        raise ImportError("pdfplumber non installé — pip install pdfplumber")


# ─── Prompt LLM ───────────────────────────────────────────────────────────────

_SYSTEM = """Tu es un assistant d'extraction de données financières.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour."""

_PROMPT_TPL = """Extrait les informations suivantes depuis ce bulletin trimestriel de SCPI.
Retourne null pour chaque champ introuvable.

Champs attendus :
- scpi_name : nom de la SCPI (string)
- report_date : date du rapport au format YYYY-MM-DD (string)
- dvm_pct : taux de distribution sur valeur de marché en % (number, ex: 5.5 pour 5.5%)
- tof_pct : taux d'occupation financier en % (number, ex: 94.2)
- nav_per_share : valeur de part / valeur liquidative en EUR (number)
- capitalization_eur : capitalisation totale en EUR (number)

Texte du document :
---
{text}
---

Réponds avec un objet JSON uniquement."""


def extract_scpi_bulletin(pdf_bytes: bytes, api_key: str) -> dict[str, Any]:
    """
    Extrait les données d'un bulletin trimestriel SCPI.
    Retourne un dict avec les champs SCPI (champs manquants = None).
    """
    import anthropic

    text = _pdf_to_text(pdf_bytes)
    text = text[:48_000]

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=_SYSTEM,
        messages=[{"role": "user", "content": _PROMPT_TPL.format(text=text)}],
    )

    raw = response.content[0].text
    data = parse_llm_response(raw)
    return apply_scpi_guardrails(data)
```

- [ ] **Vérifier que les tests passent**

```bash
python -m pytest tests/test_scpi_pdf_parser.py -v
# Expected: 4 passed
```

- [ ] **Commit**

```bash
git add scripts/parsers/scpi_pdf_parser.py tests/test_scpi_pdf_parser.py
git commit -m "feat: add SCPI bulletin LLM parser with guardrails"
```

---

## Task 4 : `pdf-classifier.py` — Classification heuristique + LLM

**Files:**
- Create: `scripts/importers/pdf-classifier.py`
- Create: `tests/test_pdf_classifier.py`

- [ ] **Écrire le test qui échoue**

```python
# tests/test_pdf_classifier.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from importers.pdf_classifier import classify_heuristic


def test_classify_pe_letter_by_text():
    text = "Lettre aux investisseurs - Rapport Q4 2024\nTRI depuis l'inception : 18.5%\nCapital appelé : 67%"
    result = classify_heuristic(text, filename="rapport_q4.pdf")
    assert result == "pe_letter"

def test_classify_scpi_bulletin_by_text():
    text = "Bulletin trimestriel SCPI\nTaux de distribution sur valeur de marché : 5.5%\nTaux d'occupation : 94%"
    result = classify_heuristic(text, filename="bulletin_t3.pdf")
    assert result == "scpi_bulletin"

def test_classify_insurer_statement_by_text():
    text = "Relevé de situation au 31/12/2024\nValorisation du contrat : 85 432 €\nFR0013412285  Altaroc Odyssey  10 parts"
    result = classify_heuristic(text, filename="releve.pdf")
    assert result == "insurer_statement"

def test_classify_returns_none_on_ambiguous():
    text = "Document financier général sans indicateurs clairs"
    result = classify_heuristic(text, filename="doc.pdf")
    assert result is None

def test_classify_pe_by_filename_hint():
    # Le mot "lettre" dans le nom de fichier booste la détection PE
    text = "Capital appelé 60%"
    result = classify_heuristic(text, filename="lettre_investisseurs_2024Q4.pdf")
    assert result == "pe_letter"
```

- [ ] **Vérifier que les tests échouent**

```bash
python -m pytest tests/test_pdf_classifier.py -v
# Expected: ImportError
```

- [ ] **Écrire `scripts/importers/pdf_classifier.py`** (module importable)

```python
#!/usr/bin/env python3
"""
pdf_classifier.py — Classification de documents PDF financiers
==============================================================
Deux passes :
  1. Heuristique regex sur texte + nom de fichier (gratuit)
  2. LLM Claude Haiku si heuristique échoue (fallback)

Types supportés : pe_letter | scpi_bulletin | insurer_statement | unknown
"""

import re
import json
import io
from typing import Any


# ─── Patterns heuristiques ────────────────────────────────────────────────────

_HEURISTICS: dict[str, list[re.Pattern]] = {
    "pe_letter": [
        re.compile(r"lettre\s+aux\s+investisseurs", re.I),
        re.compile(r"capital\s+appel[eé]", re.I),
        re.compile(r"TRI\s+depuis\s+l.inception", re.I),
        re.compile(r"distribution.*capital", re.I | re.DOTALL),
        re.compile(r"valeur\s+liquidative\s+par\s+part.*fonds\s+(de\s+)?priv[eé]", re.I | re.DOTALL),
    ],
    "scpi_bulletin": [
        re.compile(r"taux\s+de\s+distribution\s+(sur\s+valeur\s+de\s+march[eé])?", re.I),
        re.compile(r"taux\s+d.occupation\s+(financier)?", re.I),
        re.compile(r"VL\s+par\s+part", re.I),
        re.compile(r"soci[eé]t[eé]\s+civile\s+de\s+placement\s+immobilier", re.I),
    ],
    "insurer_statement": [
        re.compile(r"relev[eé]\s+de\s+situation", re.I),
        re.compile(r"valorisation\s+du\s+contrat", re.I),
        re.compile(r"[A-Z]{2}[A-Z0-9]{10}.*\d[\s,]\d{3}", re.DOTALL),  # ISIN + montant
    ],
}

_FILENAME_HINTS: dict[str, list[str]] = {
    "pe_letter": ["lettre", "investor", "quarterly", "letter"],
    "scpi_bulletin": ["bulletin", "scpi", "trimestriel"],
    "insurer_statement": ["releve", "relevé", "situation", "contrat"],
}


def classify_heuristic(text: str, filename: str) -> str | None:
    """
    Classifie par regex. Retourne le type détecté ou None si ambigu.
    Chaque type nécessite ≥ 1 match regex OU 1 hint dans le nom de fichier + ≥ 1 match.
    """
    fname_lower = filename.lower()
    scores: dict[str, int] = {k: 0 for k in _HEURISTICS}

    for doc_type, patterns in _HEURISTICS.items():
        for pat in patterns:
            if pat.search(text):
                scores[doc_type] += 2

    for doc_type, hints in _FILENAME_HINTS.items():
        if any(h in fname_lower for h in hints):
            scores[doc_type] += 1

    best_type = max(scores, key=lambda k: scores[k])
    best_score = scores[best_type]

    if best_score < 2:
        return None
    # Vérifie qu'il n'y a pas d'ambiguïté entre deux types
    sorted_scores = sorted(scores.values(), reverse=True)
    if len(sorted_scores) >= 2 and sorted_scores[0] == sorted_scores[1]:
        return None
    return best_type


def classify_llm(text: str, filename: str, api_key: str) -> dict[str, Any]:
    """
    Classification LLM via Claude Haiku. Retourne un dict
    {"type": str, "confidence": float, "fund_name": str|None, "manager": str|None}.
    """
    import anthropic

    prompt = f"""Identifie le type de ce document financier parmi : pe_letter, scpi_bulletin, insurer_statement, unknown.
- pe_letter : lettre trimestrielle d'un fonds de Private Equity aux investisseurs
- scpi_bulletin : bulletin trimestriel d'une SCPI
- insurer_statement : relevé de situation d'un assureur (AV, PER, positions)
- unknown : autre

Nom du fichier : {filename}
Début du document :
---
{text[:1500]}
---

Réponds avec un objet JSON uniquement :
{{"type": "pe_letter|scpi_bulletin|insurer_statement|unknown", "confidence": 0.0-1.0, "fund_name": null, "manager": null}}"""

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=128,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except (json.JSONDecodeError, ValueError):
            pass
    return {"type": "unknown", "confidence": 0.0, "fund_name": None, "manager": None}
```

- [ ] **Écrire le script CLI `scripts/importers/pdf-classifier.py`**

```python
#!/usr/bin/env python3
"""
pdf-classifier.py — Classifie les docs mail_pipeline_log status='received'
Usage : python pdf-classifier.py [--cgp-id UUID] [--dry-run]
"""

import sys
import os
import argparse
import io
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client
from importers.pdf_classifier import classify_heuristic, classify_llm

try:
    import pdfplumber
except ImportError:
    raise ImportError("pip install pdfplumber")


def extract_head_text(pdf_path: str, chars: int = 3000) -> str:
    try:
        with pdfplumber.open(pdf_path) as pdf:
            pages = [p.extract_text(x_tolerance=2, y_tolerance=2) or "" for p in pdf.pages[:3]]
            return "\n".join(pages)[:chars]
    except Exception as e:
        return f"[ERREUR LECTURE PDF: {e}]"


def classify_pending(cgp_id: str | None = None, dry_run: bool = False) -> tuple[int, int]:
    db = get_client()
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    query = db.table("mail_pipeline_log").select("*").eq("status", "received")
    # Re-queue les docs failed depuis > 6h avec retry_count < 3
    failed_query = (
        db.table("mail_pipeline_log")
        .select("*")
        .eq("status", "failed")
        .lt("retry_count", 3)
        .lt("processed_at", (datetime.now(timezone.utc).isoformat()))
    )

    if cgp_id:
        query = query.eq("cgp_id", cgp_id)
        failed_query = failed_query.eq("cgp_id", cgp_id)

    docs = (query.execute().data or []) + (failed_query.execute().data or [])
    ok = fail = 0

    for doc in docs:
        doc_id = doc["id"]
        pdf_path = doc.get("raw_pdf_path", "")
        filename = doc.get("filename", "")

        if not pdf_path or not Path(pdf_path).exists():
            print(f"  ✗ {filename} — fichier introuvable : {pdf_path}")
            fail += 1
            continue

        text = extract_head_text(pdf_path)
        doc_type = classify_heuristic(text, filename)
        confidence = 1.0

        if doc_type is None and api_key:
            result = classify_llm(text, filename, api_key)
            doc_type = result.get("type", "unknown")
            confidence = result.get("confidence", 0.0)
            if confidence < 0.6:
                doc_type = "unknown"

        if doc_type is None:
            doc_type = "unknown"

        print(f"  {'[DRY]' if dry_run else ''} {filename} → {doc_type} (conf={confidence:.2f})")

        if not dry_run:
            db.table("mail_pipeline_log").update({
                "doc_type": doc_type,
                "status": "classified",
                "processed_at": datetime.now(timezone.utc).isoformat(),
                "retry_count": doc.get("retry_count", 0) + 1,
            }).eq("id", doc_id).execute()
        ok += 1

    return ok, fail


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cgp-id")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ok, fail = classify_pending(cgp_id=args.cgp_id, dry_run=args.dry_run)
    print(f"\n  → {ok} classifiés, {fail} erreurs")
```

- [ ] **Vérifier que les tests passent**

```bash
python -m pytest tests/test_pdf_classifier.py -v
# Expected: 5 passed
```

- [ ] **Commit**

```bash
git add scripts/importers/pdf_classifier.py scripts/importers/pdf-classifier.py tests/test_pdf_classifier.py
git commit -m "feat: add PDF classifier (heuristic + LLM Haiku fallback)"
```

---

## Task 5 : `mail-watcher.py` — Gmail OAuth2 + polling

**Files:**
- Create: `scripts/importers/mail-watcher.py`
- Create: `tests/test_mail_watcher.py`

**Pré-requis :** Télécharger `credentials.json` depuis Google Cloud Console (APIs & Services → Credentials → OAuth 2.0 Client ID → Desktop app). Placer dans `~/.charlie/gmail_credentials.json`.

- [ ] **Écrire le test qui échoue**

```python
# tests/test_mail_watcher.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from importers.mail_watcher import should_skip_attachment, load_allowlist


def test_skip_too_small():
    assert should_skip_attachment(filename="report.pdf", size_bytes=5_000) is True

def test_skip_too_large():
    assert should_skip_attachment(filename="report.pdf", size_bytes=60_000_000) is True

def test_accept_valid_pdf():
    assert should_skip_attachment(filename="lettre_q4.pdf", size_bytes=500_000) is False

def test_skip_non_pdf():
    assert should_skip_attachment(filename="image.png", size_bytes=500_000) is True

def test_allowlist_empty_accepts_all():
    assert load_allowlist(None) is None

def test_sender_blocked_by_allowlist():
    allowlist = ["altaroc.fr", "eurazeo.com"]
    sender = "newsletter@spam.com"
    assert not any(d in sender for d in allowlist)

def test_sender_allowed():
    allowlist = ["altaroc.fr", "eurazeo.com"]
    sender = "reports@altaroc.fr"
    assert any(d in sender for d in allowlist)
```

- [ ] **Vérifier que les tests échouent**

```bash
python -m pytest tests/test_mail_watcher.py -v
# Expected: ImportError
```

- [ ] **Écrire `scripts/importers/mail_watcher.py`** (module importable)

```python
#!/usr/bin/env python3
"""
mail_watcher.py — Gmail polling pour le pipeline mail Charlie
=============================================================
"""

import base64
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

TOKEN_DIR = Path.home() / ".charlie"
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
MIN_SIZE = 30_000        # 30 Ko
MAX_SIZE = 50_000_000    # 50 Mo


def should_skip_attachment(filename: str, size_bytes: int) -> bool:
    """Retourne True si la PJ doit être ignorée (taille ou extension)."""
    if not filename.lower().endswith(".pdf"):
        return True
    if size_bytes < MIN_SIZE or size_bytes > MAX_SIZE:
        return True
    return False


def load_allowlist(cgp_id: str | None) -> list[str] | None:
    """Charge la liste blanche d'expéditeurs si elle existe."""
    if cgp_id is None:
        return None
    path = TOKEN_DIR / f"gmail_allowlist_{cgp_id}.json"
    if path.exists():
        return json.loads(path.read_text())
    return None


def _load_credentials(cgp_id: str):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    token_path = TOKEN_DIR / f"gmail_token_{cgp_id}.json"
    if not token_path.exists():
        raise RuntimeError(
            f"Token Gmail non trouvé pour CGP {cgp_id}.\n"
            f"Lancez : python mail-watcher.py --setup --cgp-id {cgp_id}"
        )
    creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            token_path.write_text(creds.to_json())
        else:
            raise RuntimeError(f"Token expiré pour CGP {cgp_id} — relancer --setup")
    return creds


def setup_gmail_auth(cgp_id: str, credentials_path: str) -> None:
    """OAuth2 consent flow — ouvre le browser une fois."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
    creds = flow.run_local_server(port=0)
    TOKEN_DIR.mkdir(exist_ok=True)
    token_path = TOKEN_DIR / f"gmail_token_{cgp_id}.json"
    token_path.write_text(creds.to_json())
    print(f"  ✓ Token sauvegardé : {token_path}")


def _last_processed_date(db, cgp_id: str) -> str:
    """Date du dernier email traité pour ce CGP (format YYYY/MM/DD)."""
    res = (
        db.table("mail_pipeline_log")
        .select("received_at")
        .eq("cgp_id", cgp_id)
        .order("received_at", desc=True)
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0]["received_at"][:10].replace("-", "/")
    return (date.today() - timedelta(days=90)).strftime("%Y/%m/%d")


def _iter_parts(payload: dict):
    """Itère récursivement sur les MIME parts d'un email Gmail."""
    if "parts" in payload:
        for part in payload["parts"]:
            yield from _iter_parts(part)
    else:
        yield payload


def poll_cgp(service, db, cgp_id: str, tmp_dir: Path, dry_run: bool = False) -> int:
    """
    Scanne Gmail pour un CGP donné. Retourne le nombre de nouvelles PJs insérées.
    """
    allowlist = load_allowlist(cgp_id)
    last_date = _last_processed_date(db, cgp_id)
    query = f"has:attachment filename:pdf after:{last_date}"

    results = service.users().messages().list(userId="me", q=query, maxResults=200).execute()
    messages = results.get("messages", [])

    new_count = 0
    for msg_ref in messages:
        msg_id = msg_ref["id"]

        # Déduplication
        existing = (
            db.table("mail_pipeline_log")
            .select("id")
            .eq("gmail_message_id", msg_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            continue

        msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()

        # Filtre expéditeur
        headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
        sender = headers.get("From", "")
        if allowlist and not any(domain in sender for domain in allowlist):
            continue

        received_ts = datetime.fromtimestamp(
            int(msg["internalDate"]) / 1000, tz=timezone.utc
        )

        for part in _iter_parts(msg["payload"]):
            filename = part.get("filename", "")
            body = part.get("body", {})
            size = body.get("size", 0)
            att_id = body.get("attachmentId")

            if should_skip_attachment(filename, size) or not att_id:
                continue

            print(f"  + {filename} ({size:,} o) ← {sender[:50]}")

            if not dry_run:
                att = service.users().messages().attachments().get(
                    userId="me", messageId=msg_id, id=att_id
                ).execute()
                pdf_bytes = base64.urlsafe_b64decode(att["data"])

                tmp_dir.mkdir(parents=True, exist_ok=True)
                pdf_path = tmp_dir / f"{msg_id}_{filename}"
                pdf_path.write_bytes(pdf_bytes)

                db.table("mail_pipeline_log").insert({
                    "cgp_id": cgp_id,
                    "gmail_message_id": msg_id,
                    "filename": filename,
                    "received_at": received_ts.isoformat(),
                    "status": "received",
                    "raw_pdf_path": str(pdf_path),
                    "retry_count": 0,
                }).execute()

            new_count += 1

    return new_count
```

- [ ] **Écrire le script CLI `scripts/importers/mail-watcher.py`**

```python
#!/usr/bin/env python3
"""
mail-watcher.py — Polling Gmail → mail_pipeline_log
Usage :
  python mail-watcher.py --setup --cgp-id UUID          # auth initiale
  python mail-watcher.py [--cgp-id UUID] [--dry-run]   # polling
"""

import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client
from importers.mail_watcher import (
    TOKEN_DIR, setup_gmail_auth, _load_credentials, poll_cgp
)

try:
    from googleapiclient.discovery import build
except ImportError:
    raise ImportError("pip install google-api-python-client")


def get_active_cgp_ids(db) -> list[str]:
    """Liste tous les CGPs qui ont un token Gmail configuré."""
    tokens = list(TOKEN_DIR.glob("gmail_token_*.json"))
    return [t.stem.replace("gmail_token_", "") for t in tokens]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--setup", action="store_true", help="Lancer le flux OAuth2")
    parser.add_argument("--cgp-id", required=False)
    parser.add_argument("--credentials", default=str(TOKEN_DIR / "gmail_credentials.json"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.setup:
        if not args.cgp_id:
            print("--cgp-id requis avec --setup")
            sys.exit(1)
        setup_gmail_auth(args.cgp_id, args.credentials)
        return

    db = get_client()
    cgp_ids = [args.cgp_id] if args.cgp_id else get_active_cgp_ids(db)

    if not cgp_ids:
        print("Aucun token Gmail configuré. Lancer : python mail-watcher.py --setup --cgp-id UUID")
        sys.exit(0)

    total = 0
    for cgp_id in cgp_ids:
        print(f"\n── CGP {cgp_id} ──")
        try:
            creds = _load_credentials(cgp_id)
            service = build("gmail", "v1", credentials=creds)
            tmp_dir = Path(f"/tmp/charlie-mail/{cgp_id}")
            n = poll_cgp(service, db, cgp_id, tmp_dir, dry_run=args.dry_run)
            print(f"  → {n} nouvelle(s) PJ(s)")
            total += n
        except Exception as e:
            print(f"  ✗ {e}")

    print(f"\n  Total : {total} PJ(s) insérées")


if __name__ == "__main__":
    main()
```

- [ ] **Vérifier que les tests passent**

```bash
python -m pytest tests/test_mail_watcher.py -v
# Expected: 7 passed
```

- [ ] **Commit**

```bash
git add scripts/importers/mail_watcher.py scripts/importers/mail-watcher.py tests/test_mail_watcher.py
git commit -m "feat: add Gmail OAuth2 mail watcher with deduplication"
```

---

## Task 6 : `pdf-extractor.py` — Router + upsert

**Files:**
- Create: `scripts/importers/pdf-extractor.py`

- [ ] **Écrire `scripts/importers/pdf-extractor.py`**

```python
#!/usr/bin/env python3
"""
pdf-extractor.py — Extrait les données des docs classifiés → upsert Supabase
Usage : python pdf-extractor.py [--cgp-id UUID] [--dry-run]
"""

import sys
import os
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client
from cgp_common import upsert_all
from parsers.pe_parser import extract_pe_letter
from parsers.scpi_pdf_parser import extract_scpi_bulletin


def _upsert_pe(db, data: dict, log_id: str, dry_run: bool) -> None:
    """Upserte un rapport PE trimestriel."""
    fund_name = data.get("fund_name")
    if not fund_name:
        raise ValueError("fund_name manquant dans l'extraction PE")

    if not dry_run:
        # Lookup ou insert dans investissement_pe_funds
        res = db.table("investissement_pe_funds").select("id").eq("name", fund_name).limit(1).execute()
        if res.data:
            fund_id = res.data[0]["id"]
        else:
            fund_id = db.table("investissement_pe_funds").insert({
                "name": fund_name,
                "manager": data.get("manager"),
            }).execute().data[0]["id"]

        report_row = {
            "fund_id": fund_id,
            "report_date": data.get("report_date"),
            "source_log_id": log_id,
        }
        for field in ("nav_per_share", "tri_since_inception", "capital_called_pct",
                      "capital_distributed_pct", "total_aum_eur"):
            if data.get(field) is not None:
                report_row[field] = data[field]

        db.table("investissement_pe_quarterly_reports").upsert(
            report_row, on_conflict="fund_id,report_date"
        ).execute()

    print(f"    PE: {fund_name} @ {data.get('report_date')} — TRI={data.get('tri_since_inception')}%")


def _normalize_scpi_name(name: str) -> str:
    """Normalise un nom SCPI pour le matching (même logique que scpi-primaliance-enricher)."""
    import unicodedata
    n = unicodedata.normalize("NFD", name.lower())
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    return n.strip()


def _upsert_scpi(db, data: dict, dry_run: bool) -> None:
    """Met à jour les champs SCPI dans investissement_funds (si NULL uniquement)."""
    scpi_name = data.get("scpi_name")
    if not scpi_name:
        raise ValueError("scpi_name manquant dans l'extraction SCPI")

    if not dry_run:
        # Cherche par nom normalisé
        all_scpi = (
            db.table("investissement_funds")
            .select("id,name,performance_1y,ongoing_charges")
            .eq("product_type", "scpi")
            .execute()
        )
        norm_target = _normalize_scpi_name(scpi_name)
        match = next(
            (r for r in (all_scpi.data or []) if _normalize_scpi_name(r["name"]) == norm_target),
            None,
        )
        if not match:
            print(f"    SCPI non trouvée : {scpi_name}")
            return

        updates = {}
        if data.get("dvm_pct") is not None and match.get("performance_1y") is None:
            updates["performance_1y"] = data["dvm_pct"]
        if data.get("ongoing_charges") is not None and match.get("ongoing_charges") is None:
            updates["ongoing_charges"] = data.get("ongoing_charges")

        if updates:
            db.table("investissement_funds").update(updates).eq("id", match["id"]).execute()

    print(f"    SCPI: {scpi_name} — DVM={data.get('dvm_pct')}%  TOF={data.get('tof_pct')}%")


def _upsert_insurer(db, data: dict, cgp_id: str, insurer: str, dry_run: bool) -> None:
    """Branche sur cgp_common.upsert_all. data = résultat brut de genepro_parser.parse()."""
    records = [data] if isinstance(data, dict) else data
    if not dry_run:
        upsert_all(db, cgp_id, records, insurer=insurer, verbose=True)


def process_classified(cgp_id: str | None = None, dry_run: bool = False) -> tuple[int, int]:
    db = get_client()
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("⚠  ANTHROPIC_API_KEY non défini")
        return 0, 0

    query = db.table("mail_pipeline_log").select("*").eq("status", "classified").neq("doc_type", "unknown")
    if cgp_id:
        query = query.eq("cgp_id", cgp_id)

    docs = query.execute().data or []
    ok = fail = 0

    for doc in docs:
        doc_id = doc["id"]
        doc_type = doc["doc_type"]
        pdf_path = doc.get("raw_pdf_path", "")
        filename = doc.get("filename", "")

        print(f"\n  {filename} [{doc_type}]")

        if not pdf_path or not Path(pdf_path).exists():
            print(f"    ✗ fichier introuvable : {pdf_path}")
            if not dry_run:
                db.table("mail_pipeline_log").update({
                    "status": "failed",
                    "error_msg": "Fichier PDF introuvable",
                    "processed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", doc_id).execute()
            fail += 1
            continue

        try:
            pdf_bytes = Path(pdf_path).read_bytes()
            extracted_data: dict | None = None

            if doc_type == "pe_letter":
                extracted_data = extract_pe_letter(pdf_bytes, api_key)
                _upsert_pe(db, extracted_data, doc_id, dry_run)

            elif doc_type == "scpi_bulletin":
                extracted_data = extract_scpi_bulletin(pdf_bytes, api_key)
                _upsert_scpi(db, extracted_data, dry_run)

            elif doc_type == "insurer_statement":
                # genepro_parser.parse() — API : parse(file_bytes: bytes, filename: str) -> dict
                from parsers.genepro_parser import parse as parse_genepro
                parsed = parse_genepro(pdf_bytes, filename)
                insurer = "Generali"  # genepro_parser ne couvre que Generali pour l'instant
                _upsert_insurer(db, parsed, doc["cgp_id"], insurer, dry_run)

            if not dry_run:
                db.table("mail_pipeline_log").update({
                    "status": "done",
                    "processed_at": datetime.now(timezone.utc).isoformat(),
                    "extracted_json": extracted_data,
                }).eq("id", doc_id).execute()
            ok += 1

        except Exception as e:
            print(f"    ✗ {e}")
            retry = doc.get("retry_count", 0) + 1
            new_status = "abandoned" if retry >= 3 else "failed"
            if not dry_run:
                db.table("mail_pipeline_log").update({
                    "status": new_status,
                    "error_msg": str(e)[:500],
                    "retry_count": retry,
                    "processed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", doc_id).execute()
            fail += 1

    return ok, fail


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cgp-id")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ok, fail = process_classified(cgp_id=args.cgp_id, dry_run=args.dry_run)
    print(f"\n  → {ok} extraits, {fail} erreurs")
```

- [ ] **Tester manuellement le routing (sans LLM)**

Créer un doc factice dans `mail_pipeline_log` via Supabase Dashboard SQL Editor :
```sql
INSERT INTO mail_pipeline_log (cgp_id, gmail_message_id, filename, received_at, doc_type, status, raw_pdf_path)
VALUES (gen_random_uuid(), 'test-msg-001', 'test.pdf', now(), 'pe_letter', 'classified', '/tmp/inexistant.pdf');
```
Puis :
```bash
python scripts/importers/pdf-extractor.py --dry-run
# Expected: "test.pdf [pe_letter]" puis "✗ fichier PDF introuvable"
```

- [ ] **Commit**

```bash
git add scripts/importers/pdf-extractor.py
git commit -m "feat: add PDF extractor routing PE/SCPI/insurer with upsert"
```

---

## Task 7 : `mail-pipeline-status.py` — Observabilité

**Files:**
- Create: `scripts/importers/mail-pipeline-status.py`

- [ ] **Écrire `scripts/importers/mail-pipeline-status.py`**

```python
#!/usr/bin/env python3
"""
mail-pipeline-status.py — Tableau de bord du pipeline mail
Usage : python mail-pipeline-status.py [--cgp-id UUID]
"""

import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client


def print_status(cgp_id: str | None = None) -> None:
    db = get_client()

    query = db.table("mail_pipeline_log").select("status,doc_type,cgp_id,filename,error_msg,processed_at,retry_count")
    if cgp_id:
        query = query.eq("cgp_id", cgp_id)

    rows = query.order("processed_at", desc=True).limit(500).execute().data or []

    # Agrégation par statut
    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}
    failures = []

    for r in rows:
        s = r.get("status", "?")
        by_status[s] = by_status.get(s, 0) + 1
        if r.get("doc_type"):
            t = r["doc_type"]
            by_type[t] = by_type.get(t, 0) + 1
        if s in ("failed", "abandoned"):
            failures.append(r)

    print("\n╔══ Pipeline Mail — Statut ══╗")
    print(f"  Total docs     : {len(rows)}")
    for status, count in sorted(by_status.items()):
        bar = "█" * min(count, 30)
        print(f"  {status:<14}: {count:>5}  {bar}")

    print("\n── Par type détecté ──")
    for doc_type, count in sorted(by_type.items()):
        print(f"  {doc_type:<20}: {count}")

    if failures:
        print(f"\n── {len(failures)} échec(s) récents ──")
        for f in failures[:10]:
            print(f"  ✗ {f.get('filename', '?')[:40]:40s}  {f.get('status'):<10}  retry={f.get('retry_count', 0)}  {(f.get('error_msg') or '')[:60]}")

    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cgp-id")
    args = parser.parse_args()
    print_status(cgp_id=args.cgp_id)
```

- [ ] **Vérifier l'exécution (nécessite .env configuré)**

```bash
python scripts/importers/mail-pipeline-status.py
# Expected: tableau avec 0 docs si les tables sont vides
```

- [ ] **Commit final**

```bash
git add scripts/importers/mail-pipeline-status.py
git commit -m "feat: add mail pipeline status dashboard"
```

---

## Task 8 : Cron + documentation opérationnelle

- [ ] **Configurer le cron**

```bash
crontab -e
```
Ajouter (adapter le chemin) :
```cron
0  * * * *  cd "/Users/mathisbaala/Projects/charlie financial advisor/charlie-investissement" && python scripts/importers/mail-watcher.py >> logs/mail-pipeline-$(date +\%Y\%m\%d).log 2>&1
15 * * * *  cd "/Users/mathisbaala/Projects/charlie financial advisor/charlie-investissement" && python scripts/importers/pdf-classifier.py >> logs/mail-pipeline-$(date +\%Y\%m\%d).log 2>&1
30 * * * *  cd "/Users/mathisbaala/Projects/charlie financial advisor/charlie-investissement" && python scripts/importers/pdf-extractor.py >> logs/mail-pipeline-$(date +\%Y\%m\%d).log 2>&1
```

- [ ] **Documenter l'onboarding d'un nouveau CGP**

Créer `docs/onboarding-cgp-gmail.md` :
```markdown
# Onboarding CGP — Connexion Gmail

## Pré-requis
- `~/.charlie/gmail_credentials.json` (credentials Google Cloud Console, Gmail API activée)
- UUID du cabinet CGP dans Supabase

## Étapes
1. Lancer le flux OAuth2 (ouvre le browser, CGP doit se connecter à son compte) :
   ```bash
   python scripts/importers/mail-watcher.py --setup --cgp-id <UUID>
   ```
2. (Optionnel) Créer la liste blanche d'expéditeurs `~/.charlie/gmail_allowlist_<UUID>.json` :
   ```json
   ["altaroc.fr", "eurazeo.com", "tikehaucapital.com"]
   ```
3. Vérifier le premier polling :
   ```bash
   python scripts/importers/mail-watcher.py --cgp-id <UUID> --dry-run
   ```
4. Lancer un cycle complet manuellement :
   ```bash
   python scripts/importers/mail-watcher.py --cgp-id <UUID>
   python scripts/importers/pdf-classifier.py --cgp-id <UUID>
   python scripts/importers/pdf-extractor.py --cgp-id <UUID>
   python scripts/importers/mail-pipeline-status.py --cgp-id <UUID>
   ```
```

- [ ] **Commit**

```bash
git add docs/onboarding-cgp-gmail.md
git commit -m "docs: add CGP Gmail onboarding guide"
```

---

## Variables d'environnement requises

Ajouter dans `.env` :
```bash
ANTHROPIC_API_KEY=sk-ant-...    # déjà utilisé dans kid_parser
# SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY déjà présents
```

Fichiers locaux (hors .env, par CGP) :
```
~/.charlie/gmail_credentials.json          # depuis Google Cloud Console
~/.charlie/gmail_token_{cgp_id}.json       # généré par --setup
~/.charlie/gmail_allowlist_{cgp_id}.json   # optionnel
```
