# Pipeline Mail Tier 3 — Fonds PE, SCPI, Relevés Assureurs

**Date :** 2026-05-25  
**Statut :** Approuvé  
**Scope :** Gmail uniquement au lancement. Outlook ajouté quand un CGP en a besoin.

---

## Contexte

Les CGPs reçoivent chaque trimestre des PDFs par mail :
- **Lettres aux investisseurs PE** (Altaroc, Eurazeo, Tikehau, Ardian Access…) — VL, TRI, capital appelé/distribué. Format non-standardisé.
- **Bulletins trimestriels SCPI** (Primonial REIM, Perial, Iroko…) — DVM, TOF, VL, capitalisation.
- **Relevés assureurs** (Generali, Cardif, Spirica…) — positions client par contrat.

Personne ne traite ce flux automatiquement pour les CGPs français. C'est le vrai différenciateur Tier 3 de Charlie.

**Stratégie double :**
- *Best case* : scraper les données publiquement disponibles sans credentials (fait séparément).
- *Worst case* : construire l'infrastructure complète maintenant, prête à activer dès qu'un CGP donne accès à sa boîte mail.

---

## Architecture

```
Gmail API (OAuth2 — scope gmail.readonly)
      │
      ▼
mail-watcher.py  ──────────────────► mail_pipeline_log  (status: received)
                                              │
                        ┌─────────────────────┘
                        ▼
              pdf-classifier.py  ──► doc_type détecté + status: classified
                                              │
                        ┌─────────────────────┘
                        ▼
              pdf-extractor.py
               ├── pe_extractor      ──► investissement_pe_funds
               │                        investissement_pe_quarterly_reports
               ├── scpi_extractor    ──► investissement_funds (UPDATE)
               └── insurer_extractor ──► cgp_clients / cgp_contracts / cgp_positions
```

Chaque script est indépendant et relançable. `mail_pipeline_log` est le seul état partagé. Emplacement : `scripts/importers/`. Utilise `db.py` et `cgp_common.py` existants.

---

## Schéma DB

### `mail_pipeline_log`
```sql
id                uuid PK,
cgp_id            uuid,
gmail_message_id  text UNIQUE,
filename          text,
received_at       timestamptz,
doc_type          text,          -- pe_letter | scpi_bulletin | insurer_statement | unknown
status            text,          -- received | classified | done | failed | abandoned
retry_count       int DEFAULT 0,
error_msg         text,
raw_pdf_path      text,          -- chemin local temporaire
extracted_json    jsonb,         -- dump brut LLM avant upsert
processed_at      timestamptz
```

### `investissement_pe_funds`
```sql
id            uuid PK,
name          text UNIQUE,        -- "Altaroc Odyssey 2024"
manager       text,               -- "Altaroc"
vintage_year  int,
strategy      text,               -- buyout | growth | venture | infrastructure
currency      text DEFAULT 'EUR',
created_at    timestamptz
```

### `investissement_pe_quarterly_reports`
```sql
id                        uuid PK,
fund_id                   uuid → investissement_pe_funds,
report_date               date,
nav_per_share             decimal,
tri_since_inception       decimal,    -- % (ex: 18.5 = 18.5%)
capital_called_pct        decimal,
capital_distributed_pct   decimal,    -- DPI proxy
total_aum_eur             decimal,
source_log_id             uuid → mail_pipeline_log,
UNIQUE(fund_id, report_date)
```

**SCPI** → UPDATE dans `investissement_funds` (pas de nouvelle table).  
**Relevés assureurs** → `cgp_clients / cgp_contracts / cgp_positions` via `cgp_common.upsert_all()`.

---

## Script 1 — `mail-watcher.py`

**Rôle :** Polling Gmail → insère les nouvelles PJs PDF dans `mail_pipeline_log`.

**Auth OAuth2 :**
- Scopes : `https://www.googleapis.com/auth/gmail.readonly`
- Token stocké dans `~/.charlie/gmail_token_{cgp_id}.json` (access + refresh)
- Setup initial : `python mail-watcher.py --setup --cgp-id <uuid>` ouvre le browser une fois

**Logique :**
1. Charge le token (refresh auto si expiré)
2. Requête Gmail : `has:attachment filename:pdf after:{dernière_date_traitée}`
3. Pour chaque email avec PJ PDF non vue (`gmail_message_id` absent de `mail_pipeline_log`) :
   - Ignore PJs < 30 Ko (logos) et > 50 Mo
   - Applique liste blanche expéditeurs si `~/.charlie/gmail_allowlist_{cgp_id}.json` existe
   - Télécharge dans `/tmp/charlie-mail/{cgp_id}/{message_id}_{filename}.pdf`
   - Insère dans `mail_pipeline_log` avec `status='received'`

**Multi-CGP :** `--cgp-id` pour cibler un cabinet, sinon scanne `~/.charlie/gmail_token_*.json` — chaque fichier token = un CGP actif.

**Liste blanche expéditeurs :** fichier optionnel `~/.charlie/gmail_allowlist_{cgp_id}.json` — liste de domaines/adresses autorisés. Si absent, aucun filtre appliqué.

---

## Script 2 — `pdf-classifier.py`

**Rôle :** Classifie les docs `status='received'` → `status='classified'`.

**Deux passes :**

**Passe 1 — Heuristique (gratuite) :**  
Extrait les 500 premiers caractères via `pdfplumber`. Regex sur nom de fichier + texte :
- `pe_letter` : "lettre aux investisseurs", "TRI", "capital appelé", "distribution"
- `scpi_bulletin` : "taux de distribution", "taux d'occupation", "VL par part", "SCPI"
- `insurer_statement` : "relevé de situation", "valorisation", ISIN + montant €
Couvre ~70% des cas.

**Passe 2 — LLM Haiku (si heuristique échoue) :**  
Envoie les 1 500 premiers tokens du texte extrait. Prompt demande :
```json
{
  "type": "pe_letter|scpi_bulletin|insurer_statement|unknown",
  "confidence": 0.0-1.0,
  "fund_name": "...",
  "manager": "..."
}
```
Coût estimé : ~$0.001 par doc.

Si `confidence < 0.6` → `doc_type='unknown'`, `status='classified'` (l'extracteur ignorera les `unknown`). Log pour revue manuelle — on n'extrait jamais en aveugle.

---

## Script 3 — `pdf-extractor.py`

**Rôle :** Extrait les données des docs `status='classified'` → upsert → `status='done'`.

### Extracteur PE

Prompt Claude Sonnet avec texte PDF complet. JSON cible :
```json
{
  "fund_name": "Altaroc Odyssey 2024",
  "manager": "Altaroc",
  "report_date": "2024-12-31",
  "nav_per_share": 102.4,
  "tri_since_inception": 18.5,
  "capital_called_pct": 67.0,
  "capital_distributed_pct": 12.0,
  "total_aum_eur": 850000000
}
```
Chaque champ nullable — on upserte ce qu'on a. `fund_name` → lookup/insert dans `investissement_pe_funds`, puis upsert `pe_quarterly_reports` avec `ON CONFLICT (fund_id, report_date) DO UPDATE`.

### Extracteur SCPI

Champs ciblés : `dvm_pct`, `tof_pct`, `nav_per_share`, `capitalization_eur`, `report_date`, `scpi_name`.  
Résolution vers `investissement_funds` par nom normalisé (même matcher que `scpi-primaliance-enricher.py`).  
UPDATE uniquement si champ actuellement NULL — ne réécrase pas les scrapers publics.

### Extracteur assureur

Appel direct à `genepro_parser.py` si format Generali Genepro détecté.  
Sinon, prompt LLM pour extraire client/contrat/positions dans le format `cgp_common.upsert_all()`.

### Guardrails numériques

| Champ | Plage valide | Action si hors plage |
|-------|-------------|----------------------|
| `tri_since_inception` | -50% à 100% | null + warning |
| `dvm_pct` | 0% à 15% | null + warning |
| `capital_called_pct` | 0% à 200% | null + warning |
| `capital_distributed_pct` | 0% à 200% | null + warning |

Le reste du doc est quand même upsertré — un champ hors plage ne bloque pas tout.

---

## Orchestration Cron

```cron
0  * * * *  python scripts/importers/mail-watcher.py
15 * * * *  python scripts/importers/pdf-classifier.py
30 * * * *  python scripts/importers/pdf-extractor.py
```

Décalage intentionnel : watcher remplit, classifier consomme, extracteur finalise — tout traité en 30 min.

## Retry

- Tout doc `status='failed'` avec `processed_at < now() - 6h` est remonté à l'étape précédente au prochain run.
- Max 3 tentatives (`retry_count`). Au-delà → `status='abandoned'` (ne repart plus automatiquement).

## Observabilité

- Logs : `logs/mail-pipeline-YYYYMMDD.log` (même convention que les autres scripts)
- Script utilitaire `mail-pipeline-status.py` : tableau récap par statut / CGP / derniers échecs

---

## Fichiers à créer

```
scripts/importers/
  mail-watcher.py
  pdf-classifier.py
  pdf-extractor.py
  mail-pipeline-status.py

scripts/parsers/
  pe_parser.py          # prompt LLM PE (réutilisable)
  scpi_pdf_parser.py    # prompt LLM SCPI bulletins

migrations/
  create-mail-pipeline-tables.sql
  create-pe-tables.sql
```

---

## Ce qui n'est PAS dans ce scope

- Outlook / Microsoft Graph (ajout ultérieur, quand un CGP en a besoin)
- Scrapers publics PE/SGP (spec séparée — Tier 3 partie 2)
- Interface UI pour revue manuelle des docs `unknown`
- Webhook Gmail Pub/Sub (over-ingéniéré pour un flux trimestriel)
