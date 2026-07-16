# Charlie Investissement — Carte des Sources de Données

> Dernière mise à jour : 2026-06-19
> État base : ~36 000 supports (univers screener = parts primaires hors action/crypto/fps/structuré).
> Les tableaux de complétude ci-dessous datent de mai 2026 (valeurs indicatives, non rafraîchies).

---

## 🔄 Rafraîchissements planifiés (à jour juin 2026)

Les enrichers sont **fill-only** par défaut ; les *refreshs* ci-dessous réécrivent des
colonnes ciblées sur une cadence GitHub Actions. **Ne jamais relancer un scraper en mode
seeding/upsert global** (destructif). Alerte issue `if: failure()` sur chaque workflow.

| Cadence | Source / script | Périmètre |
|---|---|---|
| **Hebdo** | FT (`ft-enricher.py`, rotation `--offset`) | NAV + frais + catégorie (top-4000/sem + bucket tournant) |
| **Hebdo** | GECO (`geco-nav.py`, `source='amf-geco'`) | VL OPCVM FR — **couverture complète ~10,7k** + cache ISIN→idInterne |
| **Hebdo** | JustETF (`justetf-nav.py`) | filet NAV ETF |
| **Hebdo** | Crypto (`coingecko`, en `requests`) | prix/perf/vol crypto |
| **Hebdo** | `td-enricher.py` (après `compute-metrics`) | alpha vs indice + benchmark_perf (⚠ relancer APRÈS code `map_index` final) |
| **Mensuel** | Morningstar EMEA (`ms-emea-perf-enricher.py --refresh`) | perfs OPCVM étrangers LU/IE sans VL (creds en secrets, 1 worker) |
| **Mensuel** | `ft-enricher.py --fill-breakdowns --by-referencing` | compositions look-through (priorité fonds référencés) |
| **Mensuel** | `issuer-holdings.py --issuer ishares --refresh` | **composition COMPLÈTE des ETF** depuis fichiers émetteurs (constituants intégraux ≤500/ETF + secteurs/géo agrégés), `source='issuer:ishares'`, ~491 ETF (95% du parc iShares) |
| **Mensuel** | OpenFIGI (`openfigi-classify.py`) | garde classification (titres vifs mal classés opcvm) |
| **Trimestriel** | SCPI Primaliance (`scpi-primaliance-enricher.py --refresh`, `requests`/`parsel`) | TD/TRI/frais/capitalisation/**prix de part** |
| **Annuel** | Fonds euros (`fonds-euros-enricher.py --refresh`) | taux servis, **fenêtre d'années dynamique** |

`yfinance` est cassé (ne pas s'appuyer dessus). GECO est devenu une source quasi-primaire FR.
Voir mémoire projet `scheduled-refresh` et `data-freshness-volets` pour le détail.

---

## Vue d'ensemble de la complétude

| Champ | ETF | OPCVM | Notes |
|-------|-----|-------|-------|
| TER / frais | 97.4% (2309/2370) | 37.2% (5086/13677) | Principal gap OPCVM |
| Performance 1Y | 96.8% (2295/2370) | 54.2% (7415/13677) | |
| AUM (€) | 88.1% (2088/2370) | 59.0% (8074/13677) | |
| SRI (1-7) | 16.4% (388/2370) | 18.3% (2509/13677) | Extrait KID PDF |
| SRRI (1-7) | 95.0% (2251/2370) | 40.2% (5496/13677) | Boursorama, KID |
| KID URL | 23.1% (5146/22311) | | AMF GECO uniquement |
| KID parsé | ~33% | | Sur fonds avec URL |
| SFDR article | 75.0% (16730/22311) | | Art.6 par défaut |
| management_company | 89.8% (2129/2370) | — | JustETF |
| region_exposure | 8.2% (195/2370) | — | JustETF (en cours) |
| inception_date | 55.0% (1304/2370) | — | JustETF (en cours) |
| category | 8.2% (195/2370) | — | JustETF (en cours) |

---

## Sources et Scripts

### 1. AMF GECO API (principale source OPCVM FR)

**Base URL** : `https://geco.amf-france.org/back-office/`

**Scripts** :
- `scripts/scrapers/amf-geco-full.py` — Collecte initiale massive (compartiments + parts)
- `scripts/scrapers/amf-geco-foreign.py` — Fonds étrangers (non-FR)
- `scripts/scrapers/geco-kid-finder.py` — URLs KID/DICI pour chaque ISIN FR
- `scripts/scrapers/geco-performance-enricher.py` — NAV historique → perf 1Y/3Y/5Y
- `scripts/scrapers/geco-aum-enricher.py` — Actif net depuis GECO

**Endpoints découverts** :
```
GET /funds/shareByCmpCodeParPrincp/{ISIN}
  → Retourne le shareId interne à partir d'un ISIN (fonds FR principalement)
  → Taux de succès : ~55% sur les fonds FR (beaucoup de fonds dédiés sans shareId)

POST /funds/getCompartmentsBycriteria?productType=FR
  → Liste paginée de tous les compartiments FR (offset/limit)
  → Utilisé pour la collecte initiale

GET /funds/chart/{shareId}?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  → Série de VL (NAV) entre deux dates
  → Format : { "navList": [{"navDate": "...", "nav": ...}] }

GET /document/byShare/{shareId}
  → Liste des documents associés à une part (KID, prospectus, rapport)
  → Filtrer sur documentType contenant "KID", "DICI", "DIC"

GET /document/download/{idInterne}
  → Téléchargement PDF direct
  → URL stockée : https://geco.amf-france.org/back-office/document/download/{id}
```

**Limitations** :
- Le champ `parIndSrri` (SRRI) existe dans le bundle Angular mais N'EST PAS retourné par l'API REST
- Les fonds dédiés (ex: `Fonds dédié***`) n'ont généralement pas de KID public
- ~9421/12396 fonds FR n'ont pas de document KID sur GECO
- Rate limit recommandé : 0.8s entre appels, WORKERS ≤ 4

**Résultat geco-kid-finder** : 2694 URLs KID trouvées en 1 run (12396 fonds traités)

---

### 2. KID PDF Parser (extraction TER + SRI depuis les PDF AMF)

**Script** : `scripts/scrapers/kid-bulk-parser.py`

**Fonctionnement** :
1. Lit les `kid_url` depuis `investissement_funds`
2. Télécharge le PDF depuis GECO
3. Extrait le texte avec `pdfplumber`
4. Applique des regex sur les patterns FR/EN pour extraire :
   - SRI (1-7) : `"indicateur synthétique de risque"` + chiffre encadré
   - TER / frais courants : `"frais courants"`, `"ongoing charges"`
   - SFDR article : `"article 8/9 du règlement SFDR"`
   - Performance scénarios (facultatif)

**Patterns clés (français)** :
```python
# SRI
r"indicateur\s+synth[eé]tique\s+de\s+risque\s+et\s+de\s+rendement\s*[:\-]?\s*(\d)"
r"class[eé]\s+(\d)\s+sur\s+(?:une\s+)?(?:[eé]chelle|classe)\s+(?:de\s+risque\s+)?(?:de\s+)?7"

# TER
r"frais\s+courants\s*[:\-]?\s*([\d]+[,\.]\d+)\s*%"
r"total\s+des\s+frais\s+sur\s+encours\s*[:\-]?\s*([\d]+[,\.]\d+)\s*%"

# SFDR
r"article\s+(9)\s+du\s+r[eè]glement\s+SFDR"
r"SFDR\s+article\s+(8|9)"
```

**Workers / rate** : WORKERS=10, RATE_LIMIT=0.5s, timeout=20s  
**Min AUM** : `--min-aum 0` pour traiter tous les fonds (sans filtre)  
**Taux de succès** : ~85% des KIDs contenant SRI ou TER extrait avec succès

---

### 2bis. Constituants ETF émetteurs (`issuer-holdings.py`)

Composition **complète** des ETF (vs top 10) par téléchargement direct du fichier
de l'émetteur. Tables `investissement_fund_holdings` / `_sectors` / `_geos`,
`source='issuer:<emetteur>'`. Cap **500 lignes/ETF** (log de troncature ; les
secteurs/géo restent agrégés sur la liste complète). Élargi en `numeric(9,6)`
pour les petites lignes (cf. migration `20260619200000`).

**iShares (câblé).** Site UK = SPA dur ; seuls 2 endpoints passent en `requests` :
- **Catalogue ISIN→productId** (1378 fonds, JSON 3,8 Mo) — le `dcrPath` est la clé,
  capturé via navigateur :
  `.../product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/uk/product-screener/ishares-product-screener-backend-config&siteEntryPassthrough=true`
- **CSV holdings** — seul le `productId` du chemin compte (token `.ajax` constant
  pour la locale UK, `fileName` cosmétique) :
  `.../products/{productId}/x/1506575576011.ajax?fileType=csv&dataType=fund`
  Colonnes : Ticker, Name, Sector, Asset Class, **Weight (%)**, Location (pays EN→ISO2).

Couverture : **491/514 ETF iShares en base (95 %)** ; les 23 manques sont surtout
des lignes cotées en Allemagne (DE…, catalogue iShares DE non branché).

**Amundi / Xtrackers (à brancher).** SPA aussi. Amundi : page produit
`/fr/professionnels/produits/{classe}/{slug}/{isin}`, compo via widget JS sur
`POST /mapi/ProductAPI/getProductsData` (téléchargement « composition des actifs »
généré côté client → reste à décoder). Stubs présents dans `ISSUER_FILTERS`.

---

### 3. JustETF (ETFs européens — TER + AUM + Perf)

**Base URL** : `https://www.justetf.com/fr/etf-profile.html?isin={ISIN}`

**Scripts** :
- `scripts/scrapers/justetf-ter-enricher.py` — TER pour ETFs sans TER
- `scripts/scrapers/justetf-aum-fill.py` — AUM pour ETFs sans AUM
- `scripts/scrapers/justetf-perf-fill.py` — Performance pour ETFs sans perf_1y
- `scripts/scrapers/justetf-scraper.py` — Collecte initiale ETFs
- `scripts/scrapers/justetf-enricher.py` — Enrichissement général

**Patterns HTML valides (mai 2026)** :
```python
# TER
re.search(r'data-testid="tl_etf-basics_value_ter">([^<]+)<', html)
# → "0,20% p.a." → diviser par 100 pour décimal

# AUM (fund size)
re.search(
    r'etf-profile-header_fund-size-value-wrapper[^>]*>.*?EUR\s*([\d\s\xa0 ,.]+)\s*M',
    html, re.DOTALL
)
# → "119 096 M" → int(num_str.strip()) * 1_000_000
# IMPORTANT : utiliser re.sub(r'[\s\xa0 ,]', '', num_str) pour nettoyer les espaces insécables

# Performances
re.search(r'data-testid="etf-returns-section_1year-return"[^>]*>([^<]+)<', html)
re.search(r'data-testid="etf-returns-section_3year-return"[^>]*>([^<]+)<', html)
re.search(r'data-testid="etf-returns-section_5year-return"[^>]*>([^<]+)<', html)
# → "+20,26%" → remplacer virgule par point, supprimer % et +
```

**Scripts additionnels** :
- `scripts/scrapers/justetf-fields-enricher.py` — region_exposure, inception_date, management_company, category

**Anti-blocage** : WORKERS=1 (pas de parallélisme), RATE_LIMIT≥3.5s
- Lancer **un seul** script JustETF à la fois
- Avec 2 scripts simultanés ou rate < 2s → HTTP 403 systématique dès ~200 requêtes
- En cas de bloc, attendre 2-4h avant de relancer

**Taux de succès** :
- TER : ~97% sur ETFs majeurs
- AUM : 88% (~282 ETFs encore sans AUM, principalement récents)
- Perf : 97% sur ETFs majeurs
- management_company : 126/367 dans un seul run (34% hit rate)
- region/category/inception : en cours (ban IP levé attendu)

---

### 4. Boursorama (OPCVM et ETFs français)

**URL** : `https://www.boursorama.com/bourse/opcvm/cours/{ISIN}/`  
**URL ETF** : `https://www.boursorama.com/bourse/trackers/cours/{ISIN}/`

**Script** : `scripts/scrapers/boursorama-enricher.py`

**Données disponibles** :
- Performance 1Y / 3Y / 5Y (table FONDS)
- SRRI 1-7 (`data-gauge-current-step`)
- Notation Morningstar
- AUM / Actif net
- TER / Frais courants

**Patterns HTML** :
```python
# SRRI
re.search(r'data-gauge-current-step="(\d+)"', html)

# Performances (table avec colonnes : 1erJANV | 1MOIS | 6MOIS | 1AN | 3ANS | 5ANS | 10ANS)
re.search(r"FONDS\s*</th>" + (r"\s*<td[^>]*>\s*([^<]*?)\s*</td>") * 7, html, re.DOTALL)
# Indices : vals[3]=1AN, vals[4]=3ANS, vals[5]=5ANS

# AUM
re.search(r"Actif net[^<]*</p>[^<]*<p[^>]*>\s*([^<\n]+)", html)
```

**Coverage** : Principalement les fonds FR retail accessibles (OPCVM commercialisés)  
**Fonds à exclure** : `fonds dédié`, `***`, `ficpv`, `fcpe` (via filtre Python)  
**Workers** : WORKERS=4, RATE_LIMIT=0.6s

---

### 5. Euronext (actions + ETFs cotés)

**Scripts** :
- `scripts/scrapers/euronext-equities.py` — Actions FR/EU depuis l'API Euronext
- `scripts/scrapers/euronext-equities-eu.py` — Extension européenne
- `scripts/scrapers/euronext-etf.py` / `euronext-etf-v2.py` — ETFs Euronext

**API Euronext** :
```
GET https://live.euronext.com/fr/pd_es/data/track?mics=ALXB,ALXL,ALXP,XPAR,XAMS,XBRU,XLIS,XOSL,XMIL&display_datapoints=dp_1&display_filters=df_5
```
Retourne les cotations en direct avec ISIN, nom, marché.

---

### 6. Yahoo Finance (NAV historique + AUM)

**Scripts** :
- `scripts/scrapers/fetch-nav-yahoo.py` — Collecte historique VL
- `scripts/scrapers/yahoo-finance-aum.py` — AUM depuis yfinance
- `scripts/scrapers/yahoo-finance-ter-fill.py` — TER depuis yfinance

**Limitations** :
- Les AUM retournés pour les ETFs EM (VN, TH, KR, TW, JP, HK, etc.) sont en devise locale (VND, KRW, JPY…) et non en EUR → valeurs aberrantes corrigées en NULL
- Le TER yfinance est souvent absent ou erroné pour les fonds FR
- Rate limit strict : requêtes trop fréquentes → blocage IP

**Nettoyage AUM currency bug** : voir `/tmp/data-cleaner.py`  
ISINs pays à risque : `VN`, `TH`, `KR`, `TW`, `JP`, `HK`, `HU`, `PL`, `ZA`, `IN`, `CN`  
Seuil : AUM > 50 Mrd€ pour ces pays → NULL (valeur en devise locale)

---

### 7. CoinGecko (crypto)

**Script** : `scripts/scrapers/coingecko-crypto.py`

Collecte les 100+ principales cryptomonnaies avec :
- Prix, market cap, volume 24h
- Performance 1Y, 7J, 30J, 1Y
- Données Supabase : table `investissement_funds` avec `product_type = 'crypto'`

---

### 8. ASPIM / INSEE / scpi-lab / Primaliance (SCPI)

**Scripts** :
- `scripts/scrapers/aspim-scpi.py` — Seed initial (table `investissement_scpi_metrics`)
- `scripts/scrapers/scpi-lab-enricher.py` — TDVM + AUM depuis scpi-lab.com (126/280 matchées)
- `scripts/scrapers/scpi-primaliance-enricher.py` — **TRI 5 ans, frais de gestion, TDVM, AUM, inception** depuis primaliance.com (148/280 matchées)
- `scripts/scrapers/geco-realestate.py` — 35 ISINs SCPI/OPCI réels depuis AMF GECO

**Documentation détaillée** : voir `docs/data-sources-scpi.md` pour la liste
exhaustive des sources testées (succès et échecs), les sélecteurs CSS et les
limites structurelles (SRI graphique, kid_url N/A pour SCPI).

---

### 9. Référencement assurance-vie (UC ↔ contrat)

Système documenté dans `docs/av-referencing.md` (modèle de données, orchestration
trimestrielle `av-refresh.yml`/`av-refresh-browser.yml`, conventions
éligibilité-only, gotcha `contract_name ≠ company_name`). Scrapers
`scripts/scrapers/av-fr-*` et `av-lux-*`. Ajouts 2026-07-16 (AV Lux LPS France) :

| Scraper | Source | Volumétrie dry-run |
|---|---|---|
| `av-lux-cnp-catalog.py` | Quantalys Easypack CNP Lux (JSON DataTables par contrat) | 9 contrats / ~2 277 ISIN |
| `av-lux-sogelife-catalog.py` | ZIP PRIIPS doc.sogelife.com (ISIN dans les noms de fichiers, lus via Range) | 5 contrats / ~1 001 ISIN |
| `av-lux-cali-europe-catalog.py` | Portail PRIIPS my-calie.com (DevExpress, navigateur) | 4 contrats / ~286 ISIN |
| `av-lux-allianz-catalog.py` | Portail PRIIPS life.allianz.lu (POST par produit) | 2 contrats / ~172 ISIN |
| `av-lux-afi-esca-catalog.py` | PDF loi PACTE afi-esca.lu (URL découverte) | 2 contrats / ~129 ISIN |
| `av-lux-utmost-catalog.py` | API REST utmostgroup.com (ex-Lombard → Utmost Luxembourg S.A.) | 1 contrat / 66 ISIN |

Ajouts 2026-07-16 (AV France) :

| Scraper | Source | Volumétrie dry-run |
|---|---|---|
| `av-fr-sogecap-catalog.py` | Portail PRIIPS statique priips.sogecap.com (arbre cdproduit/cdisine) | 10 contrats / ~415 ISIN |
| `av-fr-oradea-catalog.py` (ressuscité) | Même portail, page oradea.html — l'ex-priips.oradea-vie.com a déménagé | 8 contrats / ~1 119 ISIN |
| `av-fr-conservateur-catalog.py` | PDF loi PACTE M40/M41/M42 (millésime via wp-json media) | 5 contrats / ~54 ISIN |

Ajouts 2026-07-16 (mapping PER — cf. av-referencing §8quater) :

| Scraper | Source | Volumétrie dry-run |
|---|---|---|
| `av-fr-caar-catalog.py` | WP REST ca-assurances-retraite.com → PDF (FRPS ex-Predica) | 2 PER / ~303 ISIN |
| `av-fr-cnp-dic-catalog.py` | API JSON dic.cnp.fr (supports par produit, entité via codeEntiteJuridique) | 2 PER / ~172 ISIN |
| `av-fr-lmp-easypack.py` | Easypack Quantalys France AG2R (per-bassin, 41 contrats retraite) | 41 contrats / ~2 535 ISIN |
| `av-fr-covea-easypack.py` | Portails Quantalys MMA/GMF (id_contrat) | 3 PER / ~164 ISIN |
| `av-fr-generali-catalog.py` (étendu) | + annexe PDF « Le PER Generali Patrimoine » (Generali Retraite) | 1 PER / ~1 091 ISIN |
| `av-fr-sogecap-catalog.py` (étendu) | + Doc_Perf loi PACTE « PER Acacia » | 1 PER / 68 ISIN |

---

### 10. Sources testées et abandonnées

| Source | Script | Raison d'échec |
|--------|--------|----------------|
| FundInfo | `fetch-ter-fundinfo.py` | Données inaccessibles sans compte |
| Morningstar | `morningstar-enhanced.py` | Anti-scraping robuste, 403 systématique |
| Quantalys | `quantalys-enricher.py` | HTML dynamique (JS), données non scrappables |
| OpenFIGI | `etf-openfigi.py` | Pas de données financières (seulement identifiants) |
| GECO SRRI | — | Champ `parIndSrri` présent dans bundle Angular mais absent de l'API REST |

---

## Pipeline recommandé pour mise à jour

### Ordre optimal des scripts

```bash
# 1. Collecte de base (mensuel)
python3 scripts/scrapers/amf-geco-full.py --apply
python3 scripts/scrapers/euronext-equities-eu.py --apply
python3 scripts/scrapers/justetf-scraper.py --apply

# 2. Enrichissement KID/DICI (hebdomadaire)
python3 scripts/scrapers/geco-kid-finder.py --apply
python3 scripts/scrapers/kid-bulk-parser.py --apply --min-aum 0

# 3. Performances historiques (hebdomadaire)
python3 scripts/scrapers/geco-performance-enricher.py --apply
python3 scripts/scrapers/fetch-nav-yahoo.py --apply

# 4. TER et frais (mensuel)
python3 scripts/scrapers/justetf-ter-enricher.py --apply
python3 scripts/scrapers/justetf-aum-fill.py --apply

# 5. Indicateurs risque (mensuel)
python3 scripts/scrapers/boursorama-enricher.py --apply

# 6. Crypto et SCPI (hebdomadaire)
python3 scripts/scrapers/coingecko-crypto.py --apply
python3 scripts/scrapers/aspim-scpi.py --apply
python3 scripts/scrapers/scpi-lab-enricher.py --apply
python3 scripts/scrapers/scpi-primaliance-enricher.py --apply
```

---

## Schéma de données clés

### Table `investissement_funds`

| Colonne | Type | Source principale |
|---------|------|-------------------|
| `isin` | text PK | AMF, Euronext |
| `name` | text | AMF, Euronext |
| `product_type` | text | Enum: etf, opcvm, action, crypto, scpi, livret |
| `ter` | numeric(6,4) | JustETF (ETF), KID PDF (OPCVM) |
| `ongoing_charges` | numeric(6,4) | Identique à TER |
| `sri` | int2 | KID PDF (PRIIPs) |
| `srri` | int2 | Boursorama, KID |
| `performance_1y` | numeric(8,2) | GECO NAV, Yahoo Finance |
| `performance_3y` | numeric(8,2) | GECO NAV, Yahoo Finance |
| `performance_5y` | numeric(8,2) | GECO NAV, Yahoo Finance |
| `aum_eur` | bigint | JustETF, Boursorama, Yahoo Finance |
| `kid_url` | text | AMF GECO |
| `kid_parsed_at` | timestamptz | kid-bulk-parser |
| `kid_hash` | text | SHA256 du PDF |
| `sfdr_article` | int2 | KID PDF, SFDR enricher |
| `data_completeness` | int2 | Calculé auto (0-100) |

### Calcul `data_completeness` (fonction `compute_completeness` dans `scripts/db.py`)

```
ter OU ongoing_charges  → +14
sri OU srri             → +14
performance_1y          → +14
performance_3y          → +14
sfdr_article            → +14
aum_eur                 → +14
kid_parsed_at           → +16 (bonus source primaire)
TOTAL MAX               = 100
```

**Important** : La fonction lit les données existantes en DB avant de calculer le score (correctif appliqué en mai 2026). Tout enrichissement partiel récupère les champs existants pour un score précis.

---

## Nettoyage des données

### Corrections appliquées (2026-05-19, session 3)

- **HTML entities dans `name`** : 250 noms corrigés (`S&amp;P` → `S&P`, etc.)
- **HTML entities dans `management_company`** : 24 valeurs corrigées (`Legal &amp; General` → `Legal & General`)
- **Valeurs `region_exposure` en français** : `états-unis→usa`, `monde→global`, `marchés émergents→emerging`, `japon→japan` (12 fonds) 
- **Valeurs `region_exposure` invalides** : `usd→NULL`, `eur→NULL` (6 fonds avec devise stockée comme région)
- **Catégories ETF non-normalisées** : 183 ETFs normalisés (`Actions internationales→actions`, `Or Physique→matieres-premieres`, `Bitcoin ETP→crypto`, etc.)

### Script de correction appliqué (`/tmp/data-cleaner.py`)

676 corrections appliquées le 2026-05-18 :
- Performance > 500% ou < -99% → NULL (valeurs erronées issue de débordements numériques)
- TER > 10% → NULL (valeurs aberrantes)
- AUM > 50 Mrd€ pour pays EM (VN, TH, KR, TW, JP, HK, HU, PL, ZA, IN, CN) → NULL (valeurs en devise locale stockées comme EUR)

### Contraintes numériques

- TER stocké en **décimal** (0.0020 = 0.20%, PAS 0.20)
- Performances en **pourcentage direct** (20.26 = 20.26%)
- Colonne `numeric(8,2)` → max 999999.99% — bornes de validation : `-9999 < p < 9999`
- AUM en **euros entiers** (bigint)

---

## Lacunes restantes et pistes

### OPCVM TER (36% couverture)
- **Meilleure piste** : Continuer le parsing KID PDF via `kid-bulk-parser.py` au fur et à mesure que `geco-kid-finder.py` trouve de nouvelles URLs
- Les fonds dédiés et institutionnels (43% des OPCVM) n'ont pas de KID public → gap structurel

### OPCVM SRRI / SRI (35% couverture)
- **Meilleure piste** : KID PDF parsing (seule source fiable)
- Boursorama couvre les fonds retail FR mais pas les institutionnels

### OPCVM Performance 1Y (54% couverture)
- **Meilleure piste** : GECO NAV (`geco-performance-enricher.py`) — certains fonds ont un shareId mais pas encore traités
- 459 fonds sans shareId (fonds dédiés / institutionnels)

### ETF region_exposure / category / inception_date (8-55% couverture)
- **Source principale** : `scripts/scrapers/justetf-fields-enricher.py` (RATE_LIMIT=3.5s, 1 seul scraper à la fois)
- Ban IP JustETF déclenché si plusieurs scrapers simultanés → attendre 2-4h
- Re-lancer après le ban pour compléter les 2000+ ETFs manquants

### ETFs sans management_company (10%)
- 241 ETFs restants non trouvés sur JustETF (ETFs très récents ou non listés)
- Alternative : scraper les pages issuer (iShares, Amundi, Vanguard) — non implémenté

### ETFs sans données TER/AUM/Perf (3%)
- Principalement des ETFs récents (< 1 an) sans historique de performance
- JustETF ne couvre pas tous les ETFs listés sur Euronext

### ISINs invalides dans la base
- 7 ETFs avec ISINs "BIODIVERSITY", "INTELLIGENCE", "BREAKTHROUGH", etc. — source inconnue
- 23 SCPIs avec préfixe `SCPI_` — design intentionnel (pas d'ISIN officiel)
- 49 Fonds euros avec préfixe `FE_` — design intentionnel
- 99 Cryptos avec préfixe `CRYPTO_` — design intentionnel (pas d'ISIN pour les tokens)

---

## Recalcul de complétude

Après chaque enrichissement massif, recalculer le score de complétude :

```bash
python3 /tmp/recalc-completeness-fast.py
```

Ce script lit tous les fonds et recompute `data_completeness` avec les données actuelles.
- Mai 2026 session 1 : OPCVM avg=53, ETF avg=94
- Mai 2026 session 3 : recalcul en cours

## Pipeline complet (ordre recommandé)

```bash
# Étape 1 — Collecte initiale (mensuel)
python3 scripts/scrapers/amf-geco-full.py --apply
python3 scripts/scrapers/euronext-equities-eu.py --apply
python3 scripts/scrapers/justetf-scraper.py --apply

# Étape 2 — KID/DICI (hebdomadaire)
python3 scripts/scrapers/geco-kid-finder.py --apply
python3 scripts/scrapers/kid-bulk-parser.py --apply --min-aum 0

# Étape 3 — Performances (hebdomadaire)
python3 scripts/scrapers/geco-performance-enricher.py --apply
python3 scripts/scrapers/fetch-nav-yahoo.py --apply

# Étape 4 — Enrichissement ETF JustETF (un seul script à la fois !)
python3 scripts/scrapers/justetf-ter-enricher.py --apply
# Attendre que le précédent soit terminé avant de lancer le suivant
python3 scripts/scrapers/justetf-aum-fill.py --apply
python3 scripts/scrapers/justetf-perf-fill.py --apply
python3 scripts/scrapers/justetf-fields-enricher.py --apply

# Étape 5 — Indicateurs risque / SRRI (mensuel)
python3 scripts/scrapers/boursorama-enricher.py --apply

# Étape 6 — Crypto et SCPI (hebdomadaire)
python3 scripts/scrapers/coingecko-crypto.py --apply
python3 scripts/scrapers/aspim-scpi.py --apply

# Étape 7 — Recalcul scores de complétude
python3 /tmp/recalc-completeness-fast.py
```
