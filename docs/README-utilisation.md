# 📘 Guide d'utilisation — Base Charlie Investissement

> Comment utiliser la base `investissement_*` pour un CGP français ou un développeur front.

---

## 🚀 Démarrage rapide

### Connexion Supabase
```python
from supabase import create_client
import os
client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)
```

### Première requête : "Top 10 ETF Europe pour PEA"
```python
r = client.table("investissement_funds_cgp") \
    .select("isin, name, gestionnaire, ter, performance_3y, sharpe_3y") \
    .eq("pea_eligible", True) \
    .eq("asset_class_broad", "action") \
    .eq("region_normalized", "europe") \
    .gte("data_completeness", 70) \
    .order("sharpe_3y", desc=True) \
    .limit(10) \
    .execute()
```

---

## 📋 Tables disponibles

| Table | Lignes | Usage |
|---|---:|---|
| `investissement_funds` | ~29 020 | Table maîtresse (tous les fonds) |
| **`investissement_funds_cgp` (VUE)** | ~24 604 | **À utiliser** pour la majorité des requêtes (exclut fonds dédiés/placeholders) |
| `investissement_fund_prices` | 800k+ | Historique des VLs (5 ans) |
| `investissement_av_lux_companies` | 20 | Compagnies d'AV Luxembourg |
| `investissement_pipeline_runs` | growing | Logs des scrapers (audit) |

---

## 🎯 Vue CGP — colonnes essentielles

### Identification & catégorisation
- `isin` (PK) : ISIN officiel ou code synthétique (`CRYPTO_BTC`, `SCPI*`, `CSSF_*`, etc.)
- `name` : nom officiel du fonds
- `product_type` : `etf` / `opcvm` / `scpi` / `action` / `crypto` / `fonds_euros` / `livret` / `obligation` / `fps` / `sicav` / ...
- `asset_class_broad` : `action` / `obligation` / `monetaire` / `diversifie` / `immobilier` / `matieres_premieres` / `alternatif` / `crypto`
- `region_normalized` : `france` / `europe` / `usa` / `world` / `emerging` / `asia` / `china` / `japan` / ...
- `sector` : `technologie` / `sante` / `finance` / `energie` / `climat` / ...

### Performances & risque
- `performance_1y` / `_3y` / `_5y` (% en absolu, ex: `12.5`)
- `volatility_1y` / `_3y` (%)
- `sharpe_1y` / `_3y` (adim)
- `max_drawdown_1y` / `_3y` (% négatif)
- `risk_score` (1-7, COALESCE de SRI/SRRI)

### Frais & AUM
- `ter` / `ongoing_charges` : **fraction** (`0.012` = 1.2%)
- `aum_eur` : entier en EUR

### Eligibilité enveloppes (CRITIQUE pour CGP)
- `pea_eligible` (bool)
- `per_eligible` (bool)
- `av_lux_eligible` (bool)
- `ucits_compliant` (bool)
- `is_institutional` (bool) — TRUE = HNW/qualified investor only
- **`accessible_retail`** (bool) — TRUE si client lambda peut souscrire

### Labels ESG
- `labels` (JSONB array) : `["ISR", "ESG", "Greenfin", "Article9", "Climate", "Impact", ...]`
- `sfdr_article` (entier 6 / 8 / 9)

### Métadonnées
- `gestionnaire` (alias de `management_company_normalized`)
- `inception_date`
- `track_record_years`
- `kid_url` / `kid_parsed_at`
- `morningstar_rating` (1-5)
- `share_class_group_id` : pour regrouper les classes de parts d'un même fonds
- `currency` : ISO 4217
- `hedged` (bool)

### Qualité & traçabilité
- `data_completeness` (0-100) — **≥80 = exploitable**
- `data_source` : source principale legacy
- `field_sources` (JSONB) : traçabilité par champ

---

## 🍴 Recettes CGP fréquentes

### Profil "équilibré ISR" pour AV Lux
```python
client.table("investissement_funds_cgp") \
    .select("isin,name,gestionnaire,performance_3y,ter,sharpe_3y") \
    .eq("av_lux_eligible", True) \
    .eq("accessible_retail", True) \
    .eq("asset_class_broad", "diversifie") \
    .contains("labels", ["ESG"]) \
    .gte("data_completeness", 70) \
    .order("sharpe_3y", desc=True) \
    .limit(15) \
    .execute()
```

### Tous les fonds Amundi
```python
client.table("investissement_funds_cgp") \
    .select("*") \
    .eq("gestionnaire", "Amundi") \
    .execute()
```

### SCPI top par TDVM
```python
client.table("investissement_funds_cgp") \
    .select("isin,name,gestionnaire,performance_1y,ter,aum_eur") \
    .eq("product_type", "scpi") \
    .order("performance_1y", desc=True) \
    .limit(20) \
    .execute()
```

### Cryptos avec sharpe positif
```python
client.table("investissement_funds_cgp") \
    .select("isin,name,performance_1y,volatility_1y,sharpe_1y") \
    .eq("product_type", "crypto") \
    .gt("sharpe_1y", 0) \
    .order("sharpe_1y", desc=True) \
    .execute()
```

---

## 🔑 Conventions essentielles

| Convention | Valeur |
|---|---|
| Performances | en **pourcentage absolu** (`12.5` = 12.5%) |
| TER / ongoing_charges | en **fraction** (`0.012` = 1.2%) |
| Devises | ISO 4217 strict (EUR, USD, GBP, ...) |
| SRI / SRRI | entier 1-7 (1 = très faible risque, 7 = très élevé) |
| labels | JSONB array (use `@>` pour `contains`) |

**Voir** `docs/data-standards-v3.md` pour les détails complets.

---

## 📊 Indexes performants

8 indexes optimisés pour les requêtes CGP fréquentes :
- `pea_eligible` + `data_completeness`
- `per_eligible` + `data_completeness`
- `av_lux_eligible` + `data_completeness`
- `asset_class_broad` × `region_normalized`
- `product_type` × `data_completeness`
- `sri` × `performance_1y`
- `management_company_normalized`
- `sector` × `performance_1y`
- `is_institutional`
- `labels` (GIN sur JSONB)

---

## 🔄 Pipeline d'enrichissement

### Sources de données
- **AMF GECO** (français + foreign) — ~13 333 fonds
- **Wikidata + Yahoo Finance** — ~5 291 fonds
- **Euronext** — ~2 484 fonds
- **CSSF Lux** — **6 175 fonds institutionnels Lux** 🆕
- **Quantalys** — ~250 OPCVMs (scan en cours, ~600 fin)
- **JustETF** — ETF metadata
- **Boursorama** — TER + AUM OPCVMs FR
- **CoinGecko + Yahoo Finance** — 100 cryptos
- **ASPIM** — SCPI

### Cycles
- **Cron quotidien** : `python3 scripts/bilan-daily.py > docs/bilans/bilan-$(date +%F).md`
- **Cron hebdo** : `python3 scripts/enrichers/compute-metrics.py --apply`
- **Cron mensuel** : `python3 scripts/scrapers/fetch-nav-yahoo.py --apply` (refresh VLs)

---

## 📜 Audit qualité

```bash
python3 scripts/migrations/audit-data-quality-extended.py --no-base
```

Détecte :
- Performances aberrantes (>200% ou <-100%)
- TER aberrants (>10% sauf SCPI à 12%)
- SRI vs vol_3y drift
- Doublons potentiels (parts du même fonds)
- Stale data (>6 mois sans update)
- Source coverage matrix

---

## 📦 Scripts disponibles

### Enrichers
- `enrichers/compute-metrics.py` — vol/sharpe/drawdown depuis fund_prices
- `enrichers/classify-from-name.py` — asset_class/region/sector/labels
- `enrichers/crypto-perf-enricher.py` — cryptos via yfinance
- `enrichers/crypto-coingecko-slow.py` — fallback CoinGecko

### Scrapers (par source)
- `scrapers/cssf-lux-funds.py` — registre OPC Lux 🆕
- `scrapers/quantalys-sitemap-scanner.py` — OPCVMs FR via Quantalys
- `scrapers/quantalys-scpi-scanner.py` — SCPI Quantalys
- `scrapers/quantalys-fondseuros-scanner.py` — Fonds euros Quantalys
- `scrapers/justetf-*.py` — ETFs JustETF (perf/AUM/TER/fields)
- `scrapers/yahoo-finance-*.py` — Yahoo (AUM, TER, NAV)
- `scrapers/boursorama-*.py` — Boursorama FR
- `scrapers/amf-geco-*.py` — AMF GECO (full + foreign)
- `scrapers/aspim-scpi.py` — ASPIM SCPI
- ... + ~15 autres

### Migrations
- `migrations/migrate-data-source-jsonb.sql` — schema field_sources
- `migrations/normalize-management-company.py` — canonicalisation gestionnaires
- `migrations/normalize-currency.py` — ISO 4217
- `migrations/cluster-share-classes.py` — share_class_group_id
- `migrations/audit-data-quality-extended.py` — audit complet
- `migrations/recalc-completeness-v2.py` — formule par type

---

## ⚙️ Configuration

`.env` doit contenir :
```
SUPABASE_URL=https://dehigtgzizsdehyhmjxn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Optionnel (payant) :
```
ANTHROPIC_API_KEY=...  # pour SRI via LLM (kid-bulk-parser --llm)
```

---

## 🎓 Aide CGP

Le but de cette base est de **permettre à un CGP français de matcher un client à un fonds en quelques secondes**.

Filtres typiques :
1. **Enveloppe fiscale** : PEA / PER / AV Lux
2. **Profil risque** : `risk_score` 1-7
3. **Asset class** : action / obligation / diversifié
4. **Région** : France / Europe / World
5. **Critères ESG** : `labels` contient "ISR" ou "Article9"
6. **Accessibilité** : `accessible_retail` (client lambda) ou pas

Combine ces filtres + tri par `sharpe_3y` ou `data_completeness` pour avoir les **meilleurs candidats CGP-ready**.
