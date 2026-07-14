#!/usr/bin/env python3
"""
av-contract-terms.py — Conditions PROPRES au contrat (vague 2 du mapping CGP)
============================================================================
Extrait les CONDITIONS d'un contrat d'assurance-vie (frais d'entrée / gestion UC /
gestion fonds euros / arbitrage, taux du fonds euros, options de gestion, univers,
gestion sous mandat, ticket, distributeur) depuis un document officiel — DIC PRIIPs,
conditions générales / annexe tarifaire, ou page produit du distributeur — puis
upsert dans `investissement_av_contract_terms`.

Pourquoi le DIC : le « Document d'Information Clé » (PRIIPs) porte une section
« Coûts » NORMALISÉE (coûts d'entrée, coûts récurrents = frais de gestion, coûts de
transaction = arbitrage). C'est la source la plus FIABLE et AUDITABLE pour les frais.
Le taux du fonds euros n'y est pas → laissé à null ici (curé à part depuis L'Argus /
communiqués assureurs).

Chaîne : fetch (curl_cffi TLS-impersonation, réutilise le socle _av_pdf_common) →
texte (pdftotext pour PDF, strip HTML pour page) → extraction structurée Claude Haiku
→ validation → upsert (confidence='scraped', source_url, as_of).

N'ÉCRIT QUE `investissement_av_contract_terms` — jamais les fonds ni l'éligibilité.
La clé de chaque contrat DOIT être un `key` réel de investissement_contract_groups_mv
("Assureur::Contrat"), sinon la fiche ne joindra rien (contrôle en tête de run).

DRY-RUN (sans --apply) : fetch + extraction + affichage, NE TOUCHE PAS la DB.

Usage :
    python3 scripts/scrapers/av-contract-terms.py                       # dry-run, tous
    python3 scripts/scrapers/av-contract-terms.py --apply               # écrit en base
    python3 scripts/scrapers/av-contract-terms.py --only "Generali Vie::Himalia"
    python3 scripts/scrapers/av-contract-terms.py --limit 3
"""
import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from curl_cffi import requests as cffi_requests  # noqa: F401 (via socle)

sys.path.insert(0, str(Path(__file__).parent.parent))  # scripts/ pour `db`
from _av_pdf_common import make_session, fetch_pdf_text, DEFAULT_TIMEOUT  # noqa: E402
from db import get_client, log_run  # noqa: E402

SCRAPER_NAME = "av-contract-terms"
MODEL = "claude-haiku-4-5-20251001"
TABLE = "investissement_av_contract_terms"

# ── Surface de curation : les contrats à collecter et leur source officielle ──
# `key` = clé RÉELLE de investissement_contract_groups_mv ("Assureur::Contrat").
# `kind` = 'pdf' (DIC / annexe tarifaire) ou 'html' (page produit distributeur).
# Étendre cette liste = étendre la couverture. Une URL morte est ignorée (skip).
CONTRACTS: list[dict] = [
    {
        "key": "Generali Vie::Himalia",
        "source_url": "https://particuliers.generali.fr/professionnels-patrimoine/himalia",
        "kind": "html",
    },
    {
        "key": "Spirica::Netlife 2",
        "source_url": "https://www.uaf-life-patrimoine.fr/nos-contrats/netlife-2/",
        "kind": "html",
    },
    {
        "key": "BNP Paribas Cardif::Cardif Elite (Assurance Vie)",
        "source_url": "https://www.cardif.fr/documents-contractuels",
        "kind": "html",
    },
]

# ── Prompt d'extraction (JSON strict, null si absent) ─────────────────────────
FIELDS_DOC = {
    "frais_entree_pct": "Frais/droits d'entrée MAXIMUM en % (float, ex 3.0). null si 0 non confirmé.",
    "frais_gestion_uc_pct": "Frais de gestion annuels de l'enveloppe sur unités de compte, en % (ex 0.60). Dans un DIC = 'coûts récurrents' hors coûts du support.",
    "frais_gestion_fonds_euros_pct": "Frais de gestion annuels sur le fonds en euros, en % (ex 0.60).",
    "frais_arbitrage_pct": "Frais d'un arbitrage en % (ex 0.50). null si gratuit → mettre frais_arbitrage_note.",
    "frais_arbitrage_note": "Texte si arbitrage gratuit/plafonné (ex 'gratuit en ligne'). Sinon null.",
    "fonds_euros_nom": "Nom du fonds en euros du contrat (ex 'Netissima'). Sinon null.",
    "fonds_euros_taux_pct": "Taux net servi par le fonds euros pour une année, en % (ex 3.10). Sinon null.",
    "fonds_euros_annee": "Année (millésime) du taux fonds euros (ex 2024). Sinon null.",
    "fonds_euros_bonus": "Bonus de rendement conditionné (texte court) ou null.",
    "fonds_euros_contrainte_uc": "Quota d'UC exigé pour accéder/bonifier le fonds euros (texte) ou null.",
    "garantie_fonds_euros": "'brute de frais' ou 'nette de frais' si précisé, sinon null.",
    "univers_classes": "Liste des classes accessibles parmi : SCPI, SCI, OPCI, private equity, titres vifs, ETF, produits structurés, fonds euros. [] si inconnu.",
    "gestion_sous_mandat": "true si gestion sous mandat / pilotée disponible, false si explicitement non, sinon null.",
    "options_gestion": "Liste d'options parmi : sécurisation des plus-values, stop-loss, investissement progressif, rééquilibrage automatique, limitation des moins-values. [] si inconnu.",
    "ticket_entree": "Versement initial minimum (texte, ex '1 000 €' ou '100 000 €'). Sinon null.",
    "versement_min": "Versement complémentaire/programmé minimum (texte). Sinon null.",
    "distributeur": "Plateforme / courtier distributeur si mentionné (ex 'UAF Life Patrimoine'). Sinon null.",
}

_PCT_FIELDS = (
    "frais_entree_pct", "frais_gestion_uc_pct",
    "frais_gestion_fonds_euros_pct", "frais_arbitrage_pct", "fonds_euros_taux_pct",
)
_STR_FIELDS = (
    "frais_arbitrage_note", "fonds_euros_nom", "fonds_euros_bonus",
    "fonds_euros_contrainte_uc", "garantie_fonds_euros", "ticket_entree",
    "versement_min", "distributeur",
)


def _load_env() -> None:
    env = Path(__file__).parent.parent.parent / ".env"
    if env.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(env)
        except ImportError:
            pass


def _fetch_text(session, url: str, kind: str) -> str | None:
    """PDF → pdftotext (socle) ; HTML → texte nettoyé (parsel)."""
    if kind == "pdf":
        return fetch_pdf_text(session, url)
    try:
        r = session.get(url, timeout=DEFAULT_TIMEOUT)
        if r.status_code != 200 or not r.text:
            return None
        try:
            from parsel import Selector
            sel = Selector(text=r.text)
            for bad in sel.xpath("//script | //style | //noscript"):
                bad.root.getparent().remove(bad.root)
            text = " ".join(t.strip() for t in sel.xpath("//body//text()").getall() if t.strip())
        except Exception:
            text = re.sub(r"<[^>]+>", " ", r.text)
        text = re.sub(r"\s+", " ", text)
        return text or None
    except Exception:
        return None


def _llm_extract(text: str, company: str, contract: str) -> dict | None:
    try:
        import anthropic
    except ImportError:
        print("  ! module anthropic absent", flush=True)
        return None
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("  ! ANTHROPIC_API_KEY absente", flush=True)
        return None

    truncated = text[:12000]
    prompt = (
        f"Tu extrais les conditions du contrat d'assurance-vie « {contract} » "
        f"(assureur : {company}) depuis ce document officiel.\n"
        "Réponds UNIQUEMENT par un JSON valide, sans markdown. Mets null (ou [] pour "
        "les listes) si l'information est absente ou incertaine — n'invente jamais un chiffre.\n\n"
        f"Champs :\n{json.dumps(FIELDS_DOC, ensure_ascii=False, indent=2)}\n\n"
        f"Document (tronqué) :\n---\n{truncated}\n---\n"
    )
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=MODEL, max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return json.loads(raw)
    except Exception as e:
        print(f"  ! extraction LLM échouée : {e}", flush=True)
        return None


def _normalize(raw: dict, key: str, company: str, contract: str, source_url: str) -> dict:
    """Valide/normalise la sortie LLM en une ligne de la table (champs sûrs seulement)."""
    row: dict = {
        "key": key, "company": company, "contract": contract,
        "source_url": source_url, "as_of": date.today().isoformat(),
        "confidence": "scraped", "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    for f in _PCT_FIELDS:
        v = raw.get(f)
        if v is None:
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        # Frais plausibles ≤ 10 % ; fonds euros ≤ 8 %. Écarte les aberrations.
        cap = 8.0 if f == "fonds_euros_taux_pct" else 10.0
        if 0 <= n <= cap:
            row[f] = round(n, 2)
    for f in _STR_FIELDS:
        v = raw.get(f)
        if isinstance(v, str) and v.strip():
            row[f] = v.strip()[:200]
    yr = raw.get("fonds_euros_annee")
    try:
        if yr is not None and 2015 <= int(yr) <= 2030:
            row["fonds_euros_annee"] = int(yr)
    except (TypeError, ValueError):
        pass
    gsm = raw.get("gestion_sous_mandat")
    if isinstance(gsm, bool):
        row["gestion_sous_mandat"] = gsm
    for f in ("univers_classes", "options_gestion"):
        v = raw.get(f)
        if isinstance(v, list):
            row[f] = [str(x).strip() for x in v if str(x).strip()][:12]
    return row


def _has_signal(row: dict) -> bool:
    """Au moins un attribut de fond extrait (sinon inutile d'écrire une coquille)."""
    keys = set(row) - {"key", "company", "contract", "source_url", "as_of", "confidence", "updated_at"}
    return any(row.get(k) not in (None, [], "") for k in keys)


def main() -> None:
    ap = argparse.ArgumentParser(description="Conditions de contrat AV → av_contract_terms")
    ap.add_argument("--apply", action="store_true", help="écrit en base (sinon dry-run)")
    ap.add_argument("--only", help="ne traiter qu'une clé « Assureur::Contrat »")
    ap.add_argument("--limit", type=int, help="limiter aux N premiers contrats")
    ap.add_argument("--use-proxy", action="store_true", help="router via AV_PROXY_URL")
    args = ap.parse_args()

    _load_env()
    started = datetime.now(timezone.utc)

    todo = [c for c in CONTRACTS if not args.only or c["key"] == args.only]
    if args.limit:
        todo = todo[: args.limit]

    client = get_client() if args.apply else None

    # Garde-fou : en --apply, ne garder que les clés RÉELLES du référentiel de contrats
    # (sinon la fiche ne joindrait rien). En dry-run, on n'y touche pas.
    valid_keys: set[str] | None = None
    if client is not None:
        try:
            res = client.table("investissement_contract_groups_mv").select("key").execute()
            valid_keys = {r["key"] for r in (res.data or [])}
        except Exception as e:
            print(f"! impossible de charger les clés de contrats : {e}", flush=True)

    session = make_session(use_proxy=args.use_proxy)
    rows: list[dict] = []
    processed = failed = 0

    for c in todo:
        key, url, kind = c["key"], c["source_url"], c.get("kind", "html")
        company, _, contract = key.partition("::")
        print(f"\n▸ {key}\n  source: {url} ({kind})", flush=True)

        if valid_keys is not None and key not in valid_keys:
            print("  ! clé absente de contract_groups_mv → ignoré", flush=True)
            failed += 1
            continue

        text = _fetch_text(session, url, kind)
        if not text or len(text) < 200:
            print("  ! document illisible / vide → skip", flush=True)
            failed += 1
            continue

        raw = _llm_extract(text, company, contract)
        if not raw:
            failed += 1
            continue

        row = _normalize(raw, key, company, contract, url)
        if not _has_signal(row):
            print("  ! aucun attribut exploitable extrait → skip", flush=True)
            failed += 1
            continue

        processed += 1
        preview = {k: v for k, v in row.items() if k not in ("updated_at",)}
        print("  ✓ " + json.dumps(preview, ensure_ascii=False), flush=True)
        rows.append(row)

    if args.apply and rows and client is not None:
        try:
            client.table(TABLE).upsert(rows, on_conflict="key").execute()
            print(f"\n✅ {len(rows)} contrat(s) écrit(s) dans {TABLE}", flush=True)
        except Exception as e:
            print(f"\n❌ upsert échoué : {e}", flush=True)
            failed += len(rows)
            processed -= len(rows)
        log_run(SCRAPER_NAME,
                "success" if failed == 0 else "partial",
                records_processed=processed, records_failed=failed, started_at=started)
    else:
        print(f"\n(dry-run) {len(rows)} contrat(s) prêt(s) — relancer avec --apply pour écrire.", flush=True)


if __name__ == "__main__":
    main()
