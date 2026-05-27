# Data Collection Playbook — charlie-investissement

> Référence opérationnelle pour la collecte, l'enrichissement et la maintenance des données d'investissement.
> Dernière mise à jour : 2026-05-19
> Public visé : tout développeur reprenant le projet — pas de pré-requis sur l'historique des sessions.

Ce document est **le runbook** : il catalogue les sources, les scrapers, les pièges, les incidents passés, et l'ordre d'exécution. Pour une vue session-par-session des décisions, voir `memory/scraper_architecture.md`.

---

## 1. Vue d'ensemble

### Stack technique

| Composant | Détail |
|-----------|--------|
| Base de données | Supabase Postgres (préfixe `investissement_*` sur toutes les tables) |
| Langage | Python 3.11 |
| Module d'accès DB | `scripts/db.py` — singleton client, helpers `upsert_fund`, `update_funds_bulk`, `upsert_prices`, `log_run` |
| Variables d'environnement | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SERVICE_KEY`) dans `.env` racine |
| Orchestrateurs | `scripts/cron/daily-pipeline.py`, `scripts/cron/overnight-mass-scrape.py`, scripts shell `wait-and-run-morningstar.sh`, `post-morningstar-pipeline.sh` |

### Tables Supabase principales

| Table | Rôle | Volume actuel |
|-------|------|---------------|
| `investissement_funds` | Référentiel canonique des supports | 22 292 lignes |
| `investissement_fund_prices` | NAV/VL historiques par ISIN/date | ~1.24 M lignes (depuis 2021) |
| `investissement_scpi_metrics` | Métriques SCPI spécifiques (DVM, TOF) | ~35 lignes |
| `investissement_pipeline_runs` | Log d'exécution de chaque scraper | append-only |

### Inventaire par `product_type`

| Type | Nombre | Note |
|------|--------|------|
| `opcvm` | 13 263 | Dont ~4 297 « fonds dédiés » non enrichissables (plafond structurel) |
| `etf` | 2 370 | Couverture quasi-complète (avg completeness 95+) |
| `action` | 5 489 | FR + US/HK/SG/TW/IN/KR. Max structurel 56 pts (champs N/A par nature) |
| `scpi` | 280 | ISINs synthétiques `SCPI_*` pour les véhicules sans ISIN officiel |
| `fct` | 176 | Fonds Communs de Titrisation (ISINs `OT0*`) — non enrichissables |
| `crypto` | 101 | ISINs synthétiques `CRYPTO_*` |
| `livret` | 7 | Données statiques Banque de France |
| `fonds_euros` | 50 | Données statiques compagnies d'assurance |
| `fcpi`/`fip`/`fcpr`/`fpci` | 483 | Reclassifiés depuis `opcvm` par regex sur le nom |
| `fcpe`/`fps` | 24 | Fonds spéciaux |
| `obligation` | 45 | OAT, obligations souveraines |
| `opci`/`sci` | 22 | Immobilier autres que SCPI |
| **Total** | **22 292** | |

### Score `data_completeness`

Calculé dans `scripts/db.py::compute_completeness`, plage 0-100 :

| Critère | Points |
|---------|--------|
| `ter` OU `ongoing_charges` non null | +14 |
| `sri` OU `srri` non null | +14 |
| `performance_1y` non null | +14 |
| `performance_3y` non null | +14 |
| `sfdr_article` non null | +14 |
| `aum_eur` non null | +14 |
| `kid_parsed_at` non null | +16 (bonus source primaire) |

À recalculer après chaque enrichissement massif via `scripts/migrations/recalc-completeness.py --apply`.

---

## 2. Architecture des données par type de produit

### OPCVM (13 263)

| Champ | Couverture | Source canonique | Statut |
|-------|-----------|------------------|--------|
| `sfdr_article` | 100% | `sfdr-enricher.py` (heuristique) | ✅ |
| `aum_eur` | 59.8% | `geco-aum-enricher.py`, `boursorama-aum-fill.py`, Morningstar | ✅ |
| `performance_1y` | 55.3% | Morningstar LT, `compute-metrics` depuis prix | ✅ |
| `performance_3y` | 50.5% | Morningstar LT, `compute-metrics` | ⚠️ |
| `ter` | 38.5% | Morningstar LT (principal), KID PDF | ⚠️ |
| `kid_parsed_at` | 38.7% | `kid-bulk-parser.py` | ⚠️ |
| `morningstar_rating` | 35.1% | `morningstar-lt-enricher.py` | ⚠️ |
| `sri` | 19.2% | KID PDF (graphique → LLM requis) | ❌ |

**Plafond dur** : ~4 297 OPCVM dédiés/institutionnels (`Fonds dédié***`, FPS, FCPE confidentiels) — aucune source publique gratuite ne les couvre. Plafond atteignable réaliste : 80% de complétude moyenne sur les 8 966 OPCVM restants.

### ETF (2 370)

Quasi-saturé (avg 95+, 94% ≥80). Principale source d'enrichissement : **JustETF** + Boursorama.

| Champ | Couverture | Source canonique |
|-------|-----------|------------------|
| `ter` | 97.4% | JustETF, Yahoo Finance |
| `performance_1y` | 96.8% | JustETF, Boursorama |
| `aum_eur` | 88.1% | JustETF, Yahoo Finance |
| `srri` | 95.0% | Dérivé de volatilité (ESMA) ou Boursorama |
| `management_company` | 89.8% | JustETF |
| `region_exposure` / `category` / `inception_date` | terminé en mai 2026 | `justetf-fields-enricher.py` |

### SCPI (280)

ISINs réels (35) via AMF GECO real-estate ; ISINs synthétiques `SCPI_*` (245) pour les SCPIs sans ISIN officiel. Métriques uniquement disponibles via `scpi-lab.com` (autres sources bloquées réseau).

| Champ | Couverture | Source |
|-------|-----------|--------|
| `performance_1y` (DVM) | 61% | `scpi-lab-enricher.py`, `aspim-scpi.py` |
| `performance_3y` | 22% | Indisponible publiquement (Playwright requis) |
| `aum_eur` | partiel | `scpi-lab-enricher.py` |

### Action (5 489)

Plafond structurel `data_completeness` = **56 pts** (les champs `ter`, `kid_parsed_at`, `sfdr_article` ne s'appliquent pas aux actions individuelles). Score moyen 55 ≈ 98% du max.

| Champ | Couverture | Source |
|-------|-----------|--------|
| `performance_1y/3y/5y` | bon | Wikidata SPARQL + Yahoo Finance (`euronext-equities.py`) |
| `aum_eur` (market cap) | bon | Yahoo Finance |
| `currency`, `inception_date` | bon | Yahoo Finance |

### Crypto (101)

| Champ | Couverture | Source |
|-------|-----------|--------|
| `performance_1y` | 100% | CoinGecko `/coins/markets` |
| `performance_3y` | 57% | yfinance (`YF_MAP` de 33 tickers validés) |
| `aum_eur` | 100% | CoinGecko market_cap |
| `srri`/`sri` | 100% | Statique = 7 (risque max) |

### Livret / Fonds euros / Obligations OAT

Données statiques mises à jour annuellement (livrets) ou trimestriellement (fonds euros). ISINs synthétiques :

| Préfixe | Instrument |
|---------|-----------|
| `FR_LIVRET_A`, `FR_LDDS`, `FR_LEP`, `FR_PEL`, `FR_CEL`, `FR_LIVRET_JEUNE`, `FR_LIVRET_B` | Livrets réglementés |
| `FE_GENERALI`, `FE_AXA`, etc. | Fonds en euros |
| `CRYPTO_BTC`, `CRYPTO_ETH`, etc. | Cryptomonnaies |

---

## 3. Catalogue des sources par champ

### `performance_1y` / `performance_3y` / `performance_5y`

| Source | Scraper | Périmètre | Statut |
|--------|---------|-----------|--------|
| Morningstar LT API | `scrapers/morningstar-lt-enricher.py` | OPCVM avec MS ID | ⚠️ WORKERS=1 obligatoire, blocage IP fréquent |
| Yahoo Finance | `scrapers/fetch-nav-yahoo.py` + `enrichers/compute-metrics.py` | OPCVM/ETF couverts par YF (~76%) | ✅ Source la plus fiable |
| AMF GECO chart | `scrapers/geco-performance-enricher.py` | OPCVM FR avec shareId | ✅ Fallback pour fonds non-YF |
| Boursorama HTML | `scrapers/boursorama-enricher.py` | OPCVM/ETF retail FR | ⚠️ Exclut fonds dédiés/FPS |
| JustETF HTML | `scrapers/justetf-perf-fill.py` | ETFs européens | ⚠️ WORKERS=1, RATE_LIMIT 3.5s |
| CoinGecko | `scrapers/coingecko-crypto.py` | Top 100 cryptos | ✅ Free tier suffisant pour 1y |
| Wikidata + yfinance | `scrapers/euronext-equities*.py` | Actions FR/EU | ✅ |
| `scpi-lab.com` | `scrapers/scpi-lab-enricher.py` | SCPIs (DVM 1y seulement) | ✅ |

> ⚠️ **Convention critique** : `performance_3y` et `performance_5y` sont stockés en **rendement cumulatif total** (`(1+r)^N - 1`), pas en annualisé. Morningstar fournit l'annualisé → la conversion est faite **inline** par `morningstar-lt-enricher.py`. Voir section 7 pour l'incident.

### `ter` / `ongoing_charges`

| Source | Scraper | Périmètre | Statut |
|--------|---------|-----------|--------|
| JustETF | `justetf-ter-enricher.py`, `justetf-enricher.py` | ETFs | ✅ 97% couverture |
| Morningstar LT | `morningstar-lt-enricher.py`, `morningstar-ter-fill.py` | OPCVM avec MS ID | ⚠️ Principal gap : ~2 328 OPCVM en attente |
| KID PDF | `kid-bulk-parser.py` | Fonds avec `kid_url` | ✅ ~85% extraction sur KIDs lisibles |
| Boursorama | `boursorama-enricher.py` | OPCVM retail | ⚠️ Partiel |
| Yahoo Finance | `yahoo-finance-ter-fill.py` | ETFs récents | ❌ ~0% nouveaux ETFs |

> **Format de stockage** : `ter` est stocké en **décimal** (`0.0020` = 0.20%, **pas** 0.20). Toujours diviser le pourcentage extrait par 100.

### `sri` / `srri`

| Source | Scraper | Statut |
|--------|---------|--------|
| KID PDF (FR/EN) | `kid-bulk-parser.py` regex | ⚠️ Le SRI PRIIPS est **graphique** dans les PDFs récents — extraction texte échoue souvent |
| Boursorama `data-gauge-current-step` | `boursorama-enricher.py` | ✅ Fiable pour les OPCVM retail FR |
| Volatilité ESMA | `migrations/derive-srri-from-volatility.py` | ✅ Dérivation automatique depuis `volatility_1y` |
| KID LLM (Claude) | `kid-bulk-parser.py --llm` | ✅ Fallback pour les ~28 PDFs avec graphiques `€€€` — coûteux, désactivé par défaut |

**Seuils SRRI ESMA appliqués** (sur volatilité annualisée en %) :

```python
< 0.5%   → 1
0.5-2%   → 2
2-5%     → 3
5-10%    → 4
10-15%   → 5
15-25%   → 6
≥ 25%    → 7
```

### `kid_url`

| Source | Scraper | Statut |
|--------|---------|--------|
| AMF GECO `document/byShare` | `geco-kid-finder.py` | ✅ ~2 694 KIDs trouvés sur 12 396 fonds FR |
| Morningstar `Document` | inline dans `morningstar-lt-enricher.py` | ✅ Source la plus large pour les fonds étrangers |
| Amundi / Carmignac scraping | `kid-url-finder.py` | ⚠️ Faible — sites SPA |
| `doc.morningstar.com` PDFs | — | ❌ 404 depuis mai 2026 |

> **Note** : Les KIDs GECO ne sont **pas tous des PDFs**. Certains sont au format DOCX. `kid-bulk-parser.py` supporte les deux via `python-docx`.

### `aum_eur`

| Source | Scraper | Périmètre |
|--------|---------|-----------|
| AMF GECO `share/{shareId}.netAssetValueDTOS` | `geco-aum-enricher.py` | OPCVM FR |
| Morningstar LT | `morningstar-lt-enricher.py` | OPCVM avec MS ID |
| JustETF `etf-profile-header_fund-size-value-wrapper` | `justetf-aum-fill.py` | ETFs |
| Boursorama `Actif net` | `boursorama-aum-fill.py` | OPCVM retail |
| Yahoo Finance `totalAssets` | `yahoo-finance-aum.py` | ETFs internationaux |
| CoinGecko `market_cap` | `coingecko-crypto.py` | Cryptos |
| `scpi-lab.com` | `scpi-lab-enricher.py` | SCPIs |

> ⚠️ **Bug devise locale** : Yahoo Finance retourne parfois l'AUM des ETFs EM (VN, TH, KR, TW, JP, HK, etc.) en devise locale (VND, KRW…). Seuil de validation : si AUM > 50 Mrd€ pour ISIN d'un de ces pays → mettre `NULL`. Voir `/tmp/data-cleaner.py` (676 corrections en mai 2026).

### `sfdr_article`

| Source | Scraper | Statut |
|--------|---------|--------|
| Heuristique sur nom + catégorie | `sfdr-enricher.py --heuristic` | ✅ 100% rempli (Article 6 par défaut, Article 8/9 via mots-clés ESG) |
| API AMF GECO | `sfdr-enricher.py --source geco` | ❌ Le champ n'est pas exposé par l'API REST |
| KID PDF | `kid-bulk-parser.py` regex `"article (8\|9) du règlement SFDR"` | ✅ Confirmation des Article 8/9 |

---

## 4. Catalogue des scrapers (par fichier)

### Phase 1 — Collecte (fonds + métadonnées de base)

| Script | Source | Output | Workers / Rate |
|--------|--------|--------|----------------|
| `scrapers/amf-geco-full.py` | `POST /back-office/funds/getCompartmentsBycriteria?productType=FR` | ~12 000 fonds FR | 1 / 1.1s |
| `scrapers/amf-geco-foreign.py` | Idem, `productType in {LU,IE,DE,CH,GB,SE}` | ~3 000 fonds étrangers | 1 / 1.1s |
| `scrapers/euronext-etf-v2.py` | `live.euronext.com/fr/search_instruments/etf` paginé | ~2 900 ETFs (160 pages) | 1 / 0.6s |
| `scrapers/justetf-scraper.py` | `https://www.justetf.com/api/etfs` JSON | ~2 500 ETFs européens | 1 / 0.5s |
| `scrapers/geco-realestate.py` | AMF GECO, filtrage real-estate | ~35 SCPIs/OPCI/SCI avec vrais ISINs | 1 / 0.5s |
| `scrapers/scpi-seed-extended.py` | Seed Q4 2024 ASPIM | ~245 SCPIs (ISINs synthétiques) | — |
| `scrapers/scpi-full-scraper.py` | `france-scpi.fr` + `meilleuresscpi.com` | SCPIs avec métriques | ❌ 213.186.33.5 bloqué |
| `scrapers/euronext-equities.py` | Wikidata SPARQL (P946 ISIN FR) → yfinance | ~199 actions FR | 4 / 0.8s |
| `scrapers/euronext-equities-eu.py` | Wikidata SPARQL (DE/GB/NL/IT/ES/BE…) → yfinance | ~800-1200 actions EU | 4 / 0.8s |
| `scrapers/coingecko-crypto.py` | `api.coingecko.com/v3/coins/markets` | Top 100 cryptos | 1 / 2s (free tier) |
| `scrapers/linxea-av-catalog.py` | API Linxea | UC éligibles AV | 1 / 0.8s |
| `scrapers/livrets-reglements.py` | Statique BdF | 7 livrets | — |
| `scrapers/fonds-euros-seed.py` | Statique compagnies d'assurance | 50 fonds euros | — |
| `scrapers/obligations-souveraines-seed.py` | Statique AFT + BCE | 45 obligations (OAT, Bund, BTP…) | — |

### Phase 2 — Enrichissement performance / TER / AUM

| Script | Source | Données | Workers / Rate | Gotcha |
|--------|--------|---------|----------------|--------|
| `scrapers/morningstar-lt-enricher.py` | `morningstar.fr/util/SecuritySearch.ashx` + `lt.morningstar.com/api/rest.svc/.../security_details/{id}` | `performance_1y/3y/5y`, `morningstar_rating`, `ter`, `kid_url`, `volatility_*`, `sharpe_*` | **1 / 1.5s** | ≥2 workers déclenchent blocage IP **~4h**. Le script fait la conversion M36/M60 annualisé→cumul **inline**. |
| `scrapers/morningstar-enhanced.py` | morningstar.fr (HTML) | `morningstar_rating`, catégorie, perf | 1 / 1s | Échec sur fonds dédiés |
| `scrapers/morningstar-ter-fill.py` | Morningstar LT | `ter` pour fonds déjà notés mais sans TER | 1 / 0.5s | Faible succès — search ne retrouve pas tous les fonds |
| `scrapers/boursorama-enricher.py` | `boursorama.com/bourse/opcvm/cours/{ISIN}/` ou `/trackers/cours/{ISIN}/` | `performance_1y/3y/5y`, `srri`, `morningstar_rating`, `aum_eur`, `ter` | 4 / 0.6s | Redirige les fonds privés vers une 404 |
| `scrapers/boursorama-aum-fill.py` | Idem | `aum_eur` seul (fonds avec perf déjà connue) | 4 / 1s | — |
| `scrapers/justetf-enricher.py` | `justetf.com/fr/etf-profile.html?isin=X` | `ter`, `performance_*`, `distribution_policy`, `replication` | **1 / 1.2s** | Voir bloc Anti-blocage JustETF |
| `scrapers/justetf-ter-enricher.py` | Idem | `ter` seul | 1 / 1.2s | — |
| `scrapers/justetf-aum-fill.py` | Idem | `aum_eur` | 1 / 1.2s | Pattern : `etf-profile-header_fund-size-value-wrapper` + nettoyage `\xa0` |
| `scrapers/justetf-perf-fill.py` | Idem | `performance_1y/3y/5y` | 1 / 1.2s | — |
| `scrapers/justetf-fields-enricher.py` | Idem | `region_exposure`, `inception_date`, `management_company`, `category` | **1 / 3.5s** | Rate plus élevé requis pour les champs profile |
| `scrapers/yahoo-finance-aum.py` | yfinance `ticker.info` | `aum_eur`, `performance_1y`, `ter` | 5 / 0.5s | Bug devise locale (voir section 11) |
| `scrapers/yahoo-finance-ter-fill.py` | Idem | `ter` ETF | 4 / 0.5s | 0% sur ETFs récents (info absent) |
| `scrapers/geco-performance-enricher.py` | GECO `funds/chart/{shareId}` | `performance_1y/3y/5y` (calculé depuis NAV) | 3 / 1.2s | Hit rate ~4.6% |
| `scrapers/geco-aum-enricher.py` | GECO `share/{shareId}.netAssetValueDTOS[0]` | `aum_eur` | 4 / 1.0s | — |
| `scrapers/etf-openfigi.py` | OpenFIGI `/v3/search` + yfinance | ISIN→ticker, TER, AUM | 4 / 0.5s | Aucune donnée financière par OpenFIGI seul |
| `scrapers/sfdr-enricher.py` | Heuristique sur nom + catégorie | `sfdr_article` | — | ✅ 100% rempli ; GECO API ne retourne pas le champ |
| `scrapers/pea-eligibility-fix.py` | Règle ISIN prefix (UE 27 + EEE) | `pea_eligible` boolean | — | — |

### Phase 3 — KID / DICI

| Script | Source | Données | Workers / Rate | Gotcha |
|--------|--------|---------|----------------|--------|
| `scrapers/geco-kid-finder.py` | GECO `document/byShare/{shareId}` filtré sur `docTypeLib LIKE '%DIC%'` | `kid_url` | 4 / 0.8s | Le champ `parIndSrri` existe dans le bundle Angular mais **n'est pas dans l'API REST** |
| `scrapers/kid-url-finder.py` | Amundi/Carmignac/BNP/Natixis HTML | `kid_url` | 4 / 1s | Faible — sites SPA Angular/React |
| `scrapers/kid-bulk-parser.py` | Téléchargement PDF/DOCX → regex FR/EN bilingue | `sri`, `ter`, `ongoing_charges`, `sfdr_article`, `recommended_holding_years` | 10 / 0.3s | `--llm` pour fallback Claude (pour les 28 PDFs `€€€`). Détection langue avec confidence threshold. Cache `kid_hash` (SHA256) |

### Phase 4 — Prix historiques (NAV)

| Script | Source | Output |
|--------|--------|--------|
| `fetch-etf-prices.py` | yfinance (weekly) | `investissement_fund_prices` |
| `fetch-opcvm-nav.py` | yfinance (ISIN direct) | `investissement_fund_prices` |
| `scrapers/fetch-nav-yahoo.py` | yfinance + calcul métriques inline | `fund_prices` + update `funds` |
| `scrapers/fetch-nav-geco.py` | `geco.amf-france.org/Bio/rech_part.aspx?CodeISIN=X` HTML | Fallback ~24% OPCVM non-YF |

### Phase 5 — Calculs et migrations

| Script | Rôle |
|--------|------|
| `enrichers/compute-metrics.py` | Depuis `fund_prices` → `performance_1y/3y/5y` (cumul), `volatility_1y/3y`, `sharpe_1y/3y`, `max_drawdown_*`, `track_record_years`, `srri` (ESMA), `average_performance` |
| `migrations/recalc-completeness.py` | Recalcule `data_completeness` après enrichissement partiel |
| `migrations/recalc-average-perf.py` | `average_performance = mean(p1y, p3y, p5y)` |
| `migrations/recalc-track-record.py` | `track_record_years` depuis `inception_date` |
| `migrations/derive-srri-from-volatility.py` | `srri` depuis `volatility_1y` (seuils ESMA) |
| `migrations/reclassify-pe-funds.py` | Regex sur `name` → `product_type` (FCPI/FIP/FCPR/FPCI/FCPE/FPS) |
| `migrations/fix-decimal-metrics.py` | Corrige les métriques stockées en fraction (0.0982) au lieu de % (9.82) |
| `migrations/set-kid-parsed-at.py` | Marque `kid_parsed_at` pour fonds avec SRRI+TER (KID implicitement traité via Morningstar/Boursorama) |
| `migrations/backfill-inception-date.py` | `inception_date` via Morningstar LT |
| `migrations/fix-ms-annualized-perf.py` | ⚠️ **RETIRÉ DU PIPELINE** — voir section 7 |

---

## 5. Sources testées mais non fonctionnelles

| Source | Problème | Contournement |
|--------|----------|---------------|
| Quantalys (`quantalys.com/fonds/{isin}`) | SPA JavaScript — HTML statique vide | Playwright headless (non implémenté) |
| ESMA PRIIPS Central (`priipscentral.esma.europa.eu`) | DNS fail | VPN ou source alternative |
| FundInfo (`doc.fundinfo.com`) | DNS fail intermittent + besoin de compte | API payante |
| Sites SGPs (CPR, Candriam, AXA IM, DNCA, Oddo…) | Tous SPA Angular/React | Playwright |
| `doc.morningstar.com` PDFs | Retourne 404 depuis mai 2026 | Récupérer via `kid_url` du LT API à la place |
| CoinGecko historique (`days > 30`) | Retourne 401 (réservé tier payant) | `yfinance` avec `YF_MAP` de 33 tickers |
| Morningstar France 2+ workers | Blocage IP immédiat dure ~4h+ | **WORKERS=1 obligatoire** |
| GECO API champ SRRI (`parIndSrri`) | Présent dans bundle Angular, absent du JSON REST | Reverse-engineer le bundle JS ou Boursorama |
| Yahoo Finance ISINs SCPI | Aucun résultat | scpi-lab.com pour DVM/AUM, pas de p3y |
| `france-scpi.fr`, `meilleuresscpi.com` | IP `213.186.33.5` filtre les requêtes | scpi-lab.com (seule source accessible) |
| KID PDFs PRIIPS récents (SRI graphique) | L'indicateur SRI est un graphique, pas du texte | `kid-bulk-parser.py --llm` (Claude vision) |

---

## 6. Pipeline complet — séquence d'exécution

### Quotidien (cron 03:30 UTC)

```bash
python3 scripts/cron/daily-pipeline.py
# Lance fetch-opcvm-nav, fetch-etf-prices
# Si lundi → compute-metrics (relance hebdo des Sharpe/vol/perf)
```

### Hebdomadaire (lundi soir)

```bash
# 1. Nouveau KIDs et performances depuis sources stables
python3 scripts/scrapers/geco-kid-finder.py --apply
python3 scripts/scrapers/kid-bulk-parser.py --apply --min-aum 0
python3 scripts/scrapers/geco-performance-enricher.py --apply

# 2. Recalculs
python3 scripts/enrichers/compute-metrics.py --apply
python3 scripts/migrations/recalc-average-perf.py --apply
python3 scripts/migrations/recalc-completeness.py --apply
```

### Mensuel — collecte étendue

```bash
# Phase 1 : nouvelles ISINs
python3 scripts/scrapers/amf-geco-full.py --apply
python3 scripts/scrapers/amf-geco-foreign.py --apply
python3 scripts/scrapers/euronext-etf-v2.py --apply
python3 scripts/scrapers/justetf-scraper.py --apply

# Phase 2 : enrichissement Morningstar (long, peut bloquer)
bash scripts/wait-and-run-morningstar.sh &
WATCHER_PID=$!
bash scripts/post-morningstar-pipeline.sh $WATCHER_PID

# Phase 3 : ETFs via JustETF (un script à la fois !)
python3 scripts/scrapers/justetf-ter-enricher.py --apply
python3 scripts/scrapers/justetf-aum-fill.py --apply
python3 scripts/scrapers/justetf-perf-fill.py --apply
python3 scripts/scrapers/justetf-fields-enricher.py --apply

# Phase 4 : SRRI, SFDR, PEA
python3 scripts/migrations/derive-srri-from-volatility.py --apply
python3 scripts/scrapers/sfdr-enricher.py --apply --heuristic
python3 scripts/scrapers/pea-eligibility-fix.py --apply

# Phase 5 : SCPI/crypto/equities
python3 scripts/scrapers/scpi-lab-enricher.py --apply
python3 scripts/scrapers/aspim-scpi.py --apply
python3 scripts/scrapers/coingecko-crypto.py --apply
python3 scripts/scrapers/euronext-equities-eu.py --apply

# Phase 6 : recalculs finaux
python3 scripts/migrations/recalc-completeness.py --apply
python3 scripts/migrations/recalc-average-perf.py --apply
python3 scripts/migrations/recalc-track-record.py --apply
```

### Orchestrateurs shell

| Script | Rôle | Usage |
|--------|------|-------|
| `wait-and-run-morningstar.sh` | Poll Morningstar (test 1 ISIN) toutes les 10 min ; lance le scraper dès déblocage ; puis `recalc-avg-perf` + `recalc-completeness`. **N'inclut PAS `fix-ms-annualized-perf`** (retiré) | `bash scripts/wait-and-run-morningstar.sh &` |
| `post-morningstar-pipeline.sh` | Attend le PID, puis lance `kid-bulk-parser` (nouveaux KIDs Morningstar) + `set-kid-parsed-at` + recalculs | `bash scripts/post-morningstar-pipeline.sh $WATCHER_PID` |
| `watch-yahoo-then-compute.sh` | Attend la fin du scraper YF, lance `compute-metrics`, `recalc-avg-perf`, `derive-srri` | À hardcoder le PID Yahoo |
| `watch-morningstar-then-cleanup.sh` | ⚠️ **Version obsolète** : appelle encore `fix-ms-annualized-perf.py`. Ne pas utiliser | — |
| `cron/overnight-mass-scrape.py` | Orchestrateur Python complet (phase 1→4) avec gestion erreurs | `python3 scripts/cron/overnight-mass-scrape.py [--phase N]` |

---

## 7. Incidents et bugs critiques

### 7.1. Incident `fix-ms-annualized-perf.py` — corruption en cascade

**Sévérité** : Critique (1 174 fonds corrompus)
**Date** : nuit du 18→19 mai 2026
**Détection** : valeurs `performance_3y` jusqu'à **8 100%** dans la table

#### Contexte

Morningstar `lt.morningstar.com` retourne les rendements 3Y/5Y en format **annualisé** (champs `M36`, `M60` = ex. 11.1% par an sur 3 ans). La convention interne du projet est de stocker en **cumul total** (35.7% sur 3 ans).

Le script `migrations/fix-ms-annualized-perf.py` a été conçu pour convertir :
```python
total_3y = ((1 + ann_3y / 100) ** 3 - 1) * 100
total_5y = ((1 + ann_5y / 100) ** 5 - 1) * 100
```

#### Le bug

Le script n'était **pas idempotent** initialement : il ne vérifiait pas si la valeur avait déjà été convertie. À chaque relance, il ré-appliquait `(1+r)^N - 1` sur un cumul déjà converti, produisant un **compounding exponentiel** :

| Run | Valeur typique d'une perf 3Y |
|-----|------------------------------|
| 1 (post-MS, annualisé 11.1%) | → 36.97% (correct) |
| 2 (re-relancé sur cumul) | → 156% (`(1.3697)^3 - 1`) |
| 3 | → 1 587% |
| 4 | → 47 800% (overflow Postgres `numeric(8,4)` → 87 erreurs `22003`) |
| 5 | → 8 100% (clamp à `PERF_MAX = 9999.9999`) |

Les logs `logs/fix-ms-annualized-perf.log`, `fix-ms-annualized-2.log`, `-3.log`, `-4.log` montrent les nombres d'erreurs `22003` qui augmentent à chaque run (0 → 3 → 87 → 753), preuve directe de l'amplification exponentielle.

#### Cause racine

Trois facteurs cumulés :
1. **Pipeline doublonné** : `wait-and-run-morningstar.sh` ET `post-morningstar-pipeline.sh` ET `watch-morningstar-then-cleanup.sh` appelaient tous `fix-ms-annualized-perf.py`, alors qu'un seul aurait suffi.
2. **Conversion déjà inline** : `morningstar-lt-enricher.py` faisait **déjà** la conversion M36/M60 → cumul lors de l'écriture initiale. Le script de migration était donc **redondant** dès l'origine.
3. **Pas d'idempotence** : aucun garde-fou (pas de tag `_annualized=true`, pas de check `if p3y > 100%`).

#### Remédiation appliquée

1. **`fix-ms-annualized-perf.py` retiré du pipeline** dans `wait-and-run-morningstar.sh` (commentaire en place lignes 32-34) :
   ```bash
   # fix-ms-annualized-perf retiré : morningstar-lt-enricher effectue déjà la
   # conversion annualisé→cumulatif en ligne (M36/M60). Relancer ce script après
   # un enrichissement causerait une double conversion.
   ```
2. **Garde-fou ajouté** au script (lignes 67-77) : skip si `abs(p3y) > 100%` (idempotence partielle, script conservé pour usage manuel ponctuel sur fonds individuels).
3. **Nettoyage** : `/tmp/fix-corrupt-ms-perf.py --apply` a nullifié les 1 174 fonds avec `p3y > 200%` (force re-enrichment Morningstar).
4. **Force re-enrichment** : 2 071 fonds force-nullés sur `performance_1y` pour redéclencher `morningstar-lt-enricher`.

#### Leçons apprises

- **Tout script de transformation doit être idempotent** : tag explicite ou check sur la plage de valeurs.
- **Un seul orchestrateur** par tâche : éliminer les doublons d'invocation entre scripts shell.
- **Tester l'idempotence** : relancer le script 2 fois sur la même donnée et vérifier qu'il ne change rien la 2e fois.
- **Alerter sur les overflows Postgres** : `numeric(8,4)` plafonne à 9999.9999 — un overflow doit être une erreur visible, pas un silent clamp.

### 7.2. Autres incidents

| Incident | Cause | Remédiation |
|----------|-------|-------------|
| 259 fonds avec métriques en fraction décimale (`0.0982` au lieu de `9.82`) | Ancienne version de `compute-metrics.py` stockait en fraction | `migrations/fix-decimal-metrics.py --apply` (deux cas : tout ×100 ou perfs seulement ×100) |
| AUM ETFs EM en devise locale (jusqu'à 50 Mrd€) | Yahoo Finance retourne `totalAssets` en devise du listing | `/tmp/data-cleaner.py` : NULL si pays ∈ {VN,TH,KR,TW,JP,HK,HU,PL,ZA,IN,CN} ET AUM > 50 Mrd€ |
| 250 noms avec HTML entities (`S&amp;P`) | Source HTML mal décodée | Bulk update : `name = decode_html_entities(name)` |
| JustETF bans IP intempestifs | 2 scripts simultanés ou rate < 2s | WORKERS=1, RATE_LIMIT≥3.5s, **un seul script JustETF à la fois** |
| `parIndSrri` GECO absent | Champ présent dans bundle Angular mais filtré par l'API REST | Aucun ; utiliser Boursorama ou KID PDF |
| KID GECO format DOCX | AMF distribue certains KIDs en DOCX | Support ajouté dans `kid-bulk-parser.py` via `python-docx` |
| KID SRI graphique | PRIIPS templates avec SRI en image | Fallback LLM Claude (`--llm`) |

---

## 8. Données encore à collecter (gaps)

### Par champ (OPCVM uniquement)

| Champ | Manquant | Source résiduelle |
|-------|----------|-------------------|
| `morningstar_rating` | 8 604 | Morningstar (bloqué fréquemment) |
| `ter` | 8 153 | KID PDF + Morningstar pour fonds non-retail |
| `performance_1y` | 5 926 | Morningstar + GECO chart |
| `sri` | ~10 700 | KID LLM (graphique) — coûteux |
| `kid_url` | 8 134 | Quasi-saturé (fonds dédiés sans KID public) |

### Par type de produit

| Type | Gap résiduel |
|------|-------------|
| OPCVM dédiés (~4 297) | Aucune source publique — plafond structurel |
| SCPI nouvelles (>165) | Playwright pour sites SPA |
| ETF récents (~50) | yfinance ne couvre pas — attendre 1 an d'historique |
| Actions UE non-FR | Wikidata + yfinance (extensible) |

### Périmètres manquants entièrement

| Périmètre | Source |
|-----------|--------|
| Obligations corporate | ❌ Aucune source publique gratuite |
| Produits structurés | ❌ Aucune source identifiée |
| PERP / PERCO / PER | ❌ Pas de source publique |
| UC AV France Assureurs, Cardif, Swiss Life | Sites assureurs en SPA — Playwright |

---

## 9. Roadmap future — sources non encore testées

| Idée | Source potentielle | Effort |
|------|-------------------|--------|
| **Playwright headless** pour Quantalys + sites SGPs | `playwright` (Python) | Moyen — débloquerait 500-1000 OPCVMs |
| **Wikidata extension** actions UE | SPARQL avec `wd:Q2502884` (entreprises cotées EU) | Faible — +500-1000 actions |
| **KID LLM batch** sur 28 PDFs `€€€` | Claude Haiku 4.5 avec vision | Faible (coût ~$2) — débloquerait SRI manquants |
| **AMF GECO bundle Angular reverse** pour SRRI | Lire le bundle JS pour extraire le champ filtré | Élevé — gain incertain |
| **Bloomberg open data** | `data.bloomberg.com` (limité) | Inconnu |
| **OECD Funds Database** | API OECD | À tester |
| **API IShares / Amundi / Vanguard issuers** | Endpoints JSON propriétaires | Moyen — pour les ETFs sans MS rating |
| **PERIN/PERCO via DGT** | Site DGT (open data) | Faible — couverture PER |

---

## 10. Runbook — ajouter une nouvelle source

### Template de scraper

```python
#!/usr/bin/env python3
"""
new-source-enricher.py — Description de la source
==================================================
Source : https://example.com/api
Données collectées : ter, aum_eur, performance_1y
Cible : fonds X (product_type='Y') avec champ Z IS NULL

Usage :
    python3 scripts/scrapers/new-source-enricher.py [--apply] [--limit N]
"""

import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

WORKERS        = 1            # ⚠️ Commencer à 1 et augmenter prudemment
RATE_LIMIT_SEC = 1.5
TIMEOUT        = 12

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Charlie-Investissement/1.0)",
    "Accept-Language": "fr-FR,fr;q=0.9",
}


def fetch_one(session, isin: str) -> dict | None:
    try:
        resp = session.get(f"https://example.com/api/{isin}", headers=HEADERS, timeout=TIMEOUT)
        if resp.status_code != 200:
            return None
        data = resp.json()
        return {
            "ter":            data.get("ter") / 100 if data.get("ter") else None,  # → décimal
            "performance_1y": data.get("perf_1y"),                                  # → %
            "aum_eur":        int(data.get("aum_eur")) if data.get("aum_eur") else None,
        }
    except Exception:
        return None


def run(apply: bool, limit: int | None):
    started = datetime.now(timezone.utc)
    client  = get_client()
    session = requests.Session()

    # Cibler uniquement les fonds avec données manquantes (économise les requêtes)
    funds = client.table("investissement_funds") \
        .select("isin") \
        .eq("product_type", "opcvm") \
        .is_("ter", "null") \
        .limit(limit or 10000) \
        .execute().data

    ok = fail = 0
    for f in funds:
        result = fetch_one(session, f["isin"])
        if result and any(v is not None for v in result.values()):
            if apply:
                upsert_fund({"isin": f["isin"], **result})
            ok += 1
        else:
            fail += 1
        time.sleep(RATE_LIMIT_SEC)

    print(f"  → {ok} enrichis, {fail} échecs")
    log_run("new-source-enricher", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
```

### Checklist avant intégration

- [ ] **Test isolé** : `python3 scripts/scrapers/new-source-enricher.py` (sans `--apply`) — vérifier le format de sortie
- [ ] **Idempotence** : relancer 2× sur le même fond avec `--apply` → la 2e fois ne doit rien modifier (ou modifier de façon stable)
- [ ] **Rate limit prudent** : commencer à `WORKERS=1, RATE_LIMIT=1.5s` ; tester avant d'augmenter
- [ ] **Anti-blocage** : User-Agent réaliste, Referer correct, gestion des 403/429
- [ ] **Convention de format** :
  - TER en **décimal** (0.0020 = 0.20%)
  - Performance en **% direct** (20.26 = 20.26%)
  - Performance ≥1y en **cumul total**, jamais annualisé
  - AUM en **euros entiers** (bigint)
- [ ] **Bornes de validation** : performance ∈ [-9999, 9999]%, TER ∈ [0, 0.10] (10%), AUM ≤ 50 Mrd€ (sauf cas spéciaux)
- [ ] **`upsert_fund` sans `name`** : utilise UPDATE-only (n'écrase pas les fonds inexistants)
- [ ] **`log_run`** : appelé en fin de script pour tracer dans `investissement_pipeline_runs`
- [ ] **Documentation** : header docstring + ajout dans ce playbook (section 4)

### Anti-patterns à éviter

| Anti-pattern | Pourquoi | Solution |
|-------------|----------|----------|
| Script de migration relancé dans le pipeline régulier | Risque de corruption en cascade (cf. 7.1) | Migrations one-shot dans dossier `migrations/`, jamais dans `daily-pipeline` |
| `WORKERS=5+` sur source non vérifiée | Blocage IP immédiat | Toujours commencer à 1 |
| `if data["ter"]:` au lieu de `if data.get("ter") is not None:` | `0.0` est falsy mais valide | Utiliser `is not None` partout |
| Écrire des perfs annualisées dans `performance_3y/5y` | Mélange avec calculs cumulatifs | Convertir avant : `(1+r)^N - 1` |
| Stocker TER en pourcentage | Convention inverse au reste du code | Toujours diviser par 100 |

---

## 11. Standards de qualité des données

### Conventions de format

| Champ | Format DB | Exemple | Note |
|-------|-----------|---------|------|
| `ter`, `ongoing_charges` | `numeric(6,4)` décimal | `0.0020` = 0.20% | Diviser le % par 100 |
| `performance_1y/3y/5y` | `numeric(8,4)` pourcentage | `20.26` = +20.26% | Cumul total, **pas** annualisé |
| `volatility_1y/3y` | `numeric(8,4)` pourcentage | `12.5` = 12.5% annualisé | Annualisée (sqrt(52) sur hebdo) |
| `sharpe_1y/3y` | `numeric(8,4)` adimensionnel | `0.8` | Risk-free rate = BCE deposit facility |
| `aum_eur` | `bigint` euros entiers | `2_500_000_000` | Toujours en EUR (pas en local currency) |
| `srri`, `sri` | `int2` | `1` à `7` | Selon ESMA/PRIIPS |
| `sfdr_article` | `int2` | `6`, `8`, ou `9` | Default 6 si non spécifié |
| `morningstar_rating` | `int2` | `1` à `5` | Étoiles |
| `kid_url` | `text` | URL absolue HTTPS | Préférer source canonique (GECO > Morningstar > SGP) |
| `kid_hash` | `text` SHA256 hex | 64 chars | Évite re-parsing si PDF identique |
| `kid_parsed_at` | `timestamptz` ISO 8601 | `2026-05-19T08:30:00+00:00` | Toujours UTC |

### Contraintes numériques Postgres

- `numeric(8,4)` plafonne à **9999.9999** → toute valeur dépassante déclenche erreur `22003`
- Clamp obligatoire dans les scrapers : `max(-PERF_MAX, min(PERF_MAX, value))` avec `PERF_MAX = 9999.9999`
- Bornes métier (validation pré-écriture) :
  - Performance 1Y : `[-99%, +500%]`
  - Performance 3Y/5Y cumul : `[-99%, +2000%]`
  - TER : `[0, 0.10]` (10%)
  - AUM : `[10_000, 1e12]` (10k€ à 1 000 Mrd€)

### Conversions à connaître

| De | Vers | Formule |
|----|------|---------|
| Pourcentage `20.26%` | Fraction décimale `0.2026` | `pct / 100` |
| TER affiché `0,20% p.a.` | DB décimal `0.0020` | `parse_pct("0,20") / 100` |
| Performance annualisée 3Y `11.1%` | Cumul total 3Y `36.97%` | `((1 + ann/100)**3 - 1) * 100` |
| Cumul total 3Y `36.97%` | Annualisée 3Y `11.1%` | `((1 + total/100)**(1/3) - 1) * 100` |
| Volatilité hebdo `2.3%` | Annualisée `16.6%` | `weekly_std * sqrt(52)` |
| Volatilité quotidienne `0.8%` | Annualisée `12.7%` | `daily_std * sqrt(252)` |

### Détection des anomalies courantes

```python
# Performance stockée en fraction (0.0982) au lieu de % (9.82)
if vol_1y < 0.5 and abs(perf_1y) < 1:
    # Probable format fraction → multiplier par 100
    fix_decimal_metrics()

# AUM EM en devise locale
if isin[:2] in {"VN","TH","KR","TW","JP","HK","HU","PL","ZA","IN","CN"} and aum_eur > 50e9:
    aum_eur = None  # devise locale stockée comme EUR

# Performance corrompue (compounding exponentiel)
if abs(perf_3y) > 200 and isin not in isins_with_prices:
    perf_3y = None  # forcer re-enrichment Morningstar
```

### Tables de support — ISINs synthétiques

| Préfixe | Type | Exemple |
|---------|------|---------|
| `FR_LIVRET_*` | Livret réglementé | `FR_LIVRET_A` |
| `FE_*` | Fonds en euros | `FE_GENERALI`, `FE_AXA` |
| `CRYPTO_*` | Cryptomonnaie | `CRYPTO_BTC`, `CRYPTO_ETH` |
| `SCPI_*` | SCPI sans ISIN officiel | `SCPI_CORUM_ORIGIN` |
| `OT0*` | Fonds Communs de Titrisation | Format ISIN réel mais classifié `fct` |

Tous insérés dans `investissement_funds` avec `product_type` approprié.

---

## 12. Annexe — endpoints utiles

### AMF GECO API (non documentée, reverse-engineered)

```
POST /back-office/funds/getCompartmentsBycriteria?productType={FR|LU|IE|...}
  Body: {"offset": 0, "limit": 100}
  → Liste paginée des compartiments

GET  /back-office/funds/shareByCmpCodeParPrincp/{ISIN}
  → shareId interne (clé pour les autres endpoints)

GET  /back-office/funds/chart/{shareId}?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  → { "navList": [{"navDate": "...", "nav": ...}, ...] }

GET  /back-office/funds/share/{shareId}
  → { "netAssetValueDTOS": [{"assetUnderManagement": ...}], ... }

GET  /back-office/document/byShare/{shareId}
  → Liste documents (filtrer docTypeLib contenant "DIC" ou "PRIIPS")

GET  /back-office/document/download/{idInterne}
  → Téléchargement direct PDF/DOCX
```

### Morningstar LT API

```
GET https://www.morningstar.fr/fr/util/SecuritySearch.ashx?q={ISIN}&limit=1
  Response: "Nom|{json avec 'i'=ms_id, 'sr'=star_rating}|TYPE|||Categorie"

GET https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{ms_id}
    ?viewId=snapshot&locale=fr-FR&languageId=fr-FR&currencyId=EUR&responseViewFormat=json
  → JSON avec TrailingPerformance, RiskStatistics, Documents, OngoingCharge, etc.
```

### JustETF

```
GET https://www.justetf.com/api/etfs                # liste paginée
GET https://www.justetf.com/api/etfs/{isin}         # détail JSON
GET https://www.justetf.com/fr/etf-profile.html?isin={ISIN}   # page HTML (data-testid)
```

Patterns HTML stables (mai 2026) :
```python
re.search(r'data-testid="tl_etf-basics_value_ter">([^<]+)<', html)
re.search(r'etf-profile-header_fund-size-value-wrapper[^>]*>.*?EUR\s*([\d\s\xa0,.]+)\s*M', html, re.DOTALL)
re.search(r'data-testid="etf-returns-section_1year-return"[^>]*>([^<]+)<', html)
```

### Boursorama

```
https://www.boursorama.com/bourse/opcvm/cours/{ISIN}/   # OPCVM
https://www.boursorama.com/bourse/trackers/cours/{ISIN}/ # ETFs
```

Patterns HTML :
```python
re.search(r'data-gauge-current-step="(\d+)"', html)        # SRRI
re.search(r"Actif net[^<]*</p>[^<]*<p[^>]*>\s*([^<\n]+)", html)  # AUM
# Table FONDS | 1erJANV | 1MOIS | 6MOIS | 1AN | 3ANS | 5ANS | 10ANS
re.search(r"FONDS\s*</th>" + (r"\s*<td[^>]*>\s*([^<]*?)\s*</td>") * 7, html, re.DOTALL)
```

### Yahoo Finance (yfinance)

```python
import yfinance as yf

# Résolution ISIN → ticker (Wikidata fallback préférable)
resp = requests.get(
    "https://query1.finance.yahoo.com/v1/finance/search",
    params={"q": isin, "quotesCount": 1}
)

# Données fonds
t = yf.Ticker(isin)  # ISIN direct fonctionne pour ~76% OPCVM FR
info = t.info  # totalAssets, netExpenseRatio, morningStarOverallRating, ...

# Historique
hist = t.history(period="5y", interval="1wk")  # weekly NAV
```

### CoinGecko (free tier)

```
GET /api/v3/coins/markets?vs_currency=eur&per_page=100&page=1&price_change_percentage=1y
  → Top cryptos avec market_cap, performance_1y
  Note : days > 30 sur /market_chart retourne 401 (réservé pro)
```

---

## 13. Quick reference — commandes les plus utilisées

```bash
# Vérifier l'état Morningstar (test 1 ISIN)
curl -s "https://www.morningstar.fr/fr/util/SecuritySearch.ashx?q=FR0010321794&limit=1" \
  -H "Referer: https://www.morningstar.fr/fr/" | head -c 200

# Vérifier la couverture globale (psql via Supabase)
SELECT product_type, COUNT(*), AVG(data_completeness)::int AS avg_completeness
FROM investissement_funds GROUP BY product_type ORDER BY 2 DESC;

# Champs manquants pour les OPCVM
SELECT
  COUNT(*) FILTER (WHERE ter IS NULL) AS missing_ter,
  COUNT(*) FILTER (WHERE performance_1y IS NULL) AS missing_p1y,
  COUNT(*) FILTER (WHERE morningstar_rating IS NULL) AS missing_ms,
  COUNT(*) FILTER (WHERE kid_url IS NULL) AS missing_kid
FROM investissement_funds WHERE product_type = 'opcvm';

# Vérifier les performances aberrantes (signe corruption)
SELECT isin, name, performance_3y FROM investissement_funds
WHERE performance_3y > 200 ORDER BY performance_3y DESC LIMIT 20;

# Lancer le pipeline Morningstar avec watcher
bash scripts/wait-and-run-morningstar.sh > logs/ms-run.log 2>&1 &

# Recalcul complet de la complétude
python3 scripts/migrations/recalc-completeness.py --apply
python3 scripts/migrations/recalc-average-perf.py --apply
```

---

## 14. Contacts et références

| Topic | Référence |
|-------|-----------|
| Architecture sessions | `memory/scraper_architecture.md` (auto-mémoire) |
| Carte scrapers (legacy) | `docs/SCRAPER_MAP.md` |
| Pattern accès DB | `scripts/db.py` |
| Module parser KID | `scripts/parsers/kid_parser.py` |
| Variables BdF (taux) | `legifrance.gouv.fr`, `banque-france.fr` |
| Référentiel SFDR | `eur-lex.europa.eu/eli/reg/2019/2088` |
| API ECB risk-free rate | `data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV` |

---

**Fin du playbook.** Toute mise à jour majeure (nouvelle source, incident, changement d'API) doit être reflétée ici **avant** d'être déployée en production.
