# Runbook — Parsing KID/DICI en masse

> **À ne pas confondre avec le rapport DICI à la demande** (live, depuis le 19/06).
> La page `/documents` du site laisse un utilisateur **déposer un PDF** → `POST /api/dici/parse`
> (Claude Haiku 4.5, vision) → **rapport de fonds design** (composant `DiciReport`), enrichi des
> données de marché du fonds rattaché en base. C'est un flux *front, unitaire, à la demande*,
> protégé par rate-limit + cap de taille (cf. mémoire `dici-report` / `ai-rate-limit`).
> Le présent runbook couvre le flux **batch back-office** (enrichir la base en masse depuis les
> `kid_url` déjà connus), indépendant du rapport live.

Extrait **SRI, SFDR (Article 8/9), frais courants (TER), frais d'entrée/sortie/performance,
période de détention** depuis les KID/DICI PRIIPs. ~52 % des fonds ont un `kid_url` en base.
Le KID est la **source légale autoritaire** → ces champs sont **écrasés** (override) et tracés
`field_sources = "kid_pdf"`.

Débloque les 3 gros manques restants : SFDR correct (Art. 9 actuellement sur-attribué, cf. §11.17),
frais (TER nullés lors de la purge garbage §11.14), éligibilités indirectes.

## 0. Prérequis

```bash
# venv déjà prêt : scripts/.venv (py3.11) avec pdfplumber, anthropic, scrapling, supabase
# Credentials RÉELS requis (le .env racine local est un stub). Exporter :
export SUPABASE_URL="https://dehigtgzizsdehyhmjxn.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<clé service_role — dispo dans Vercel env vars>"
export ANTHROPIC_API_KEY="<clé Anthropic>"   # requis seulement pour --llm
```

## 1. Dry-run (aucune écriture) — valider l'extraction

```bash
scripts/.venv/bin/python scripts/scrapers/kid-bulk-parser.py --limit 30 --min-aum 100000000
# inspecte les champs extraits ; TER doit être une FRACTION (0.0187 = 1,87 %)
```

## 2. Run regex (gratuit, rapide) — gros fonds d'abord

```bash
# Passe 1 : sans LLM, sur les fonds > 50 M€ (qualité KID meilleure), parallélisme 10
scripts/.venv/bin/python scripts/scrapers/kid-bulk-parser.py --apply --min-aum 50000000 --workers 10
# Passe 2 : élargir à tous les kid_url (les déjà parsés sont skippés via kid_parsed_at)
scripts/.venv/bin/python scripts/scrapers/kid-bulk-parser.py --apply --workers 10
```

## 3. Run LLM (payant ~20-30 €) — fallback sur les KID difficiles

Le `--llm` n'appelle Claude Haiku **que** si la confiance regex < 50 (PDFs scannés, mises en page
exotiques). Surtout utile pour **maximiser la couverture SFDR** (le LLM comprend le contexte mieux
que les regex).

```bash
scripts/.venv/bin/python scripts/scrapers/kid-bulk-parser.py --apply --llm --workers 6
# Re-parser les low-confidence déjà tentés :
scripts/.venv/bin/python scripts/scrapers/kid-bulk-parser.py --apply --llm --force --workers 6
```

## 4. POST-RUN OBLIGATOIRE — recalculer la complétude

Le parser **ne recalcule pas** `data_completeness` (pour ne pas appliquer la formule legacy).
Après une session de parsing, rejouer la formule v2 :

```bash
# via Supabase MCP / SQL editor :
\i scripts/migrations/recompute-completeness-v2.sql
```

## Garde-fous intégrés

- **Unités** : TER stocké en fraction (÷100), conforme à la contrainte CHECK `chk_ter_fraction`.
  Si un TER parsé sort de [0, 0.5] → les frais sont retirés et le reste est écrit (cf. `kid_write`).
- **Idempotent** : `kid_hash` (SHA-256 du PDF) + `kid_parsed_at` ; les fonds déjà parsés sont
  skippés sauf `--force`.
- **Validation** : SRI ∈ [1,7], SFDR ∈ {8,9}, frais ∈ bornes plausibles avant écriture.
- **Fill seuil** : un fonds n'est écrit que si ≥ 2 champs extraits (`MIN_FIELDS_FOR_SUCCESS`).

## Vérification qualité (échantillon validé le 07/06)

| Fonds | TER DB | TER parsé KID |
|---|---|---|
| Comgest Renaissance Europe | 1,86 % | **1,87 %** ✓ |
| AXA Select Lafayette | 0,36 % | **0,35 %** ✓ |
| R-CO Core Equity Euro | 1,83 % | 1,70 % |

Le bug historique (TER capté = "incidence sur le rendement annuel" 1 an = ~5 %) est corrigé :
on lit désormais la ligne **"Frais de gestion et autres frais X %"** (ongoing charges).
