# 📋 Session Handoff — 19 mai 2026 (fin de journée)

> Session intensive — 20+ scrapers gratuits, migration JSONB, schema CGP étendu, 22 619 fonds en base.

---

## 🎯 Vue d'ensemble

| Métrique | Avant session | **Maintenant** |
|---|---:|---:|
| **Total fonds** | 22 292 | **22 619** (+327) |
| **≥80 completeness** | 29% | **54%** ✨ |
| **SCPI** | 61 | **237** (+135 via Quantalys) |
| **Cryptos avec vol_1y** | 0% | **100%** ✨ |
| **AV Lux eligible** | 0 | **2 895** ✨ |
| **Share classes clusters** | 0 | **1 015 groupes / 2 114 fonds** |
| **Mgmt company normalisée** | 0 | **16 482 (73%)** |
| **field_sources peuplé** | 0 | **22 484 (100%)** ✨ |

---

## ✅ Tous les gains de la session

### Chantier A — Collecte (100% gratuit)
- 🪙 Crypto vol_1y : **100/100 cryptos** (yfinance + CoinGecko slow)
- 📊 Compute-metrics : **5 920 fonds** recalculés
- 🇫🇷 AMF GECO Foreign : **4 080 fonds étrangers**
- 🇫🇷 GECO Performance : **762 OPCVMs**
- 🇫🇷 JustETF Fields : **836 ETFs**
- ⚡ JustETF perf : **114 ETF**
- 💰 JustETF AUM : **32 ETF**
- 💰 Yahoo AUM : **100 fonds**
- 🏝️ Quantalys SCPI scanner : **+135 nouvelles SCPI** + 41 enrichies
- 🇱🇺 AV Lux : 20 compagnies + 2 895 fonds flagués éligibles
- 🌱 ASPIM SCPI : 35 upserts
- 🏛️ Obligations Seed : 43 ; Livrets : 7

### Chantier B — Nettoyage
- 🩹 SCPI TER unités : **103 corrigés** (×100 → fraction)
- 🩹 Perf décimales high-confidence : **119 corrigés** (×100)
- 🩹 5 SRI=1 erronés : corrigés ou nullifiés
- 🩹 CRYPTO_MATIC supprimé (doublon CRYPTO_POL)
- 🔧 Devises normalisées : 251 GBp→GBP, ZAc→ZAR, ILA→ILS, KWF→KWD
- 🔧 Mgmt company normalisée : 854 variantes → ~300 canoniques (16 482 fonds)
- 🔧 Recalc-completeness : 21 594 fonds rescorés (formule v2 per-type)

### Chantier C — Standardisation
- 🏗️ Migration `field_sources JSONB` : appliquée + backfill **22 484 fonds**
- 🏗️ Schema CGP étendu : `asset_class_broad`, `region_normalized`, `sector`, `management_style`, `labels JSONB`, `per_eligible`, `ucits_compliant`
- 🏗️ Classifier from name : asset_class/region/sector/style/labels (en cours)
- 🏗️ PER eligibility heuristique : ~1 046 fonds flagés (en cours)
- 🏗️ Vue SQL `investissement_funds_cgp` : **18 203 fonds CGP-exploitables**
- 🏗️ `share_class_group_id` : 1 015 groupes de parts identifiés
- 📖 Documentation : `docs/data-standards-v3.md` (10 sections, 350 lignes)
- 📖 Script bilan quotidien : `scripts/bilan-daily.py`

---

## 🟢 Process toujours actifs en background

```
PID 41779  quantalys-sitemap-scanner  Long scan (~38h)
PID 63391  fetch-ter-fundinfo         14 470 cibles
PID 53224  kid-url-finder             17 146 cibles
PID 6802   classify-from-name         Application sur ~12k fonds
PID 13892  fetch-nav-yahoo            1000 fonds VLs
+ LaunchAgent Morningstar             retry IP toutes les 2h
```

Tous **détachés** (`disown`), survivent à la fermeture du terminal.

---

## 📐 Schema final `investissement_funds` (49 colonnes)

### Identification
`isin`, `name`, `product_type`, `currency`, `data_source`, `field_sources`, `data_completeness`

### Performances & Risque
`performance_1y/3y/5y`, `volatility_1y/3y`, `sharpe_1y/3y`, `max_drawdown_1y/3y`,
`average_performance`, `sri`, `srri`, `risk_level`, `morningstar_rating`

### Frais & AUM
`ter`, `ongoing_charges`, `aum_eur`

### Classification CGP (NOUVEAU)
`asset_class`, `asset_class_broad`, `sector`, `region_exposure`, `region_normalized`,
`category`, `management_style`, `labels JSONB`

### Métadonnées
`management_company`, `management_company_normalized`, `inception_date`, `track_record_years`,
`kid_url`, `kid_parsed_at`, `kid_hash`, `sfdr_article`, `hedged`

### Eligibilité (NOUVEAU)
`pea_eligible`, `av_lux_eligible`, `per_eligible`, `ucits_compliant`, `distributor_france`

### Groupage
`share_class_group_id` (parts du même fonds)

---

## 🗂️ Tables liées

- `investissement_funds` (22 619 lignes, table maîtresse)
- `investissement_fund_prices` (VL historiques)
- `investissement_pipeline_runs` (logs scrapers)
- `investissement_av_lux_companies` (20 compagnies AV Lux)
- VUE `investissement_funds_cgp` (18 203 fonds CGP-exploitables)

---

## ⚠️ Pièges à éviter

1. **Ne PAS** relancer `fix-ms-annualized-perf.py` (cascade bug × compounding)
2. **Morningstar** : 1 worker max sinon blocage IP
3. **CoinGecko free tier** : 401 sur `days≥365`, rate-limit ~30s/req
4. **Quantalys URL** : `/Fonds/{ID}` PAS `/fonds/{ISIN}` (l'ancien `quantalys-enricher.py` était cassé)
5. **`field_sources` migration** : appliquée ✓ — les futurs enrichers DOIVENT merger plutôt qu'écraser
6. **`recalc-completeness-v2`** : utilise la formule per-type, plus stricte que la legacy
7. **Devises** : toujours ISO 4217 majeur (pas GBp, ZAc, ILA)

---

## 🎯 Quand Quantalys scan finira (~38h restant)

Attendu : **~2 000 OPCVMs** supplémentaires avec TER + perf 1y/3y/5y + vol_3y + sharpe_3y + SRI.
→ Coverage OPCVM passera de 33% à ~50-60% sur ≥80 completeness.

Monitor :
```bash
python3 -c "import json; c=json.load(open('data/quantalys-mapping.json')); print(f'{len(c[\"scanned\"])}/54731')"
grep -c "MATCH ✓" logs/quantalys-scan.log
```

---

## 📅 Pour ton bilan demain matin

```bash
cd /Users/mathisbaala/Projects/charlie\ financial\ advisor/charlie-investissement
python3 scripts/bilan-daily.py > docs/bilans/bilan-$(date +%F).md
cat docs/bilans/bilan-$(date +%F).md
```

Le rapport markdown te donnera :
- Coverage globale + par product_type
- Couverture par champ
- État AV Lux
- Share classes
- Pipeline runs des dernières 24h

---

## 🚧 Suspendu (payant)

- **SRI via LLM Anthropic** : `kid-bulk-parser.py --llm` prêt, juste besoin `ANTHROPIC_API_KEY` (~50€)

---

## 📚 Documentation

- `docs/data-standards-v3.md` ← conventions complètes (NEW)
- `docs/data-collection-playbook.md` ← référence scrapers (840 lignes)
- `docs/data-sources-fonds-euros.md` ← sources testées
- `docs/data-sources-scpi.md` ← sources SCPI
- `scripts/migrations/migrate-data-source-jsonb.sql` ← migration field_sources

---

## 🔔 Watchdogs encore actifs

| ID | Surveille |
|---|---|
| `bw5g223l7` | Quantalys progress / fini |
| `boyrz22um` | Tout scraper qui termine |

---

**Tu peux fermer le terminal. Tout tourne en autonomie. Reviens demain pour le bilan.**
