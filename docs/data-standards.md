# Data Standards — `investissement_funds`

> Référence de toutes les conventions d'unités, formules de scoring et contraintes DB
> pour la table `investissement_funds`. Mise à jour : 2026-05-19.

---

## 1. Conventions d'unités (canoniques)

Toute lecture/écriture sur `investissement_funds` doit respecter ces conventions.
Les écarts détectables sont audités par `scripts/migrations/audit-data-quality.py`.

| Champ | Unité | Format DB | Exemple | Notes |
|---|---|---|---|---|
| `ter` | **fraction** | `numeric(6,4)` | `0.0085` = 0.85 % | Pas en pourcentage. |
| `ongoing_charges` | **fraction** | `numeric(6,4)` | `0.0085` | Doit être ≡ `ter` (PRIIPs). |
| `performance_1y` | **pourcentage** | `numeric(8,4)` | `7.42` = +7.42 % | Cumul total, **pas** annualisé. Cap ±9999.9999. |
| `performance_3y` | **pourcentage** | `numeric(8,4)` | `35.10` | Cumul total 3 ans. |
| `performance_5y` | **pourcentage** | `numeric(8,4)` | `58.04` | Cumul total 5 ans. |
| `average_performance` | **pourcentage** | `numeric(8,4)` | Moyenne(p1y, p3y, p5y) | Recalc par `recalc-average-perf.py`. |
| `volatility_1y` | **pourcentage annualisé** | `numeric(8,4)` | `12.70` | Écart-type des rendements journaliers × √252 × 100. |
| `volatility_3y` | **pourcentage annualisé** | `numeric(8,4)` | `15.21` | Idem sur 3 ans. |
| `max_drawdown_1y` | **pourcentage négatif** | `numeric(8,4)` | `-12.45` | Toujours ≤ 0. |
| `max_drawdown_3y` | **pourcentage négatif** | `numeric(8,4)` | `-25.10` | Toujours ≤ 0. |
| `sharpe_1y` | ratio | `numeric(8,4)` | `0.82` | Sans dimension. |
| `sharpe_3y` | ratio | `numeric(8,4)` | `0.62` | Sans dimension. |
| `aum_eur` | **euros entiers** | `bigint` | `83957808` ≈ 84 M€ | Jamais en devise locale, jamais en M€ ni en Mrd€. |
| `sri` | int 1-7 | `int2` | `5` | PRIIPs, remplace SRRI depuis 2023. |
| `srri` | int 1-7 | `int2` | `5` | UCITS (legacy mais encore présent dans Boursorama/KID). |
| `sfdr_article` | int 6/8/9 | `int2` | `8` | `6` = pas SFDR, `8` / `9` = art. ESG. |
| `inception_date` | ISO date | `date` | `2018-12-13` | YYYY-MM-DD. Jamais dans le futur. |
| `track_record_years` | années (float) | `numeric(5,1)` | `7.8` | (today - inception) / 365.25. Toujours ≥ 0. |
| `morningstar_rating` | int 1-5 | `int2` | `4` | Star rating. |
| `data_completeness` | int 0-100 | `int2` | `82` | Calculé auto. Cf. §3. |
| `currency` | ISO-4217 | `text` | `EUR`, `USD`, `JPY` | 3 lettres. `GBp` = pence pour stocks UK. |

### 1.1 Cap numérique

Les colonnes `numeric(8,4)` ont un cap à **9999.9999**. Toute valeur saturée à
9999.9999 doit être considérée comme **corrompue** (NULL recommandé), pas valide.

### 1.2 HTML entities

Les champs string (`name`, `management_company`, `category`) doivent être en
texte décodé : `S&P` et non `S&amp;P`. Appliquer `html.unescape()` en collecte.

---

## 2. Périmètre fonctionnel par `product_type`

| product_type | n | Source(s) principale(s) | Champs canoniques renseignés | Champs non applicables |
|---|---:|---|---|---|
| `opcvm` | 13 263 | AMF GECO, Boursorama, KID PDF | ter, sri/srri, perf, sfdr, aum, kid | — |
| `action` | 5 489 | Euronext, Yahoo, Wikidata | currency, aum (market cap), perf | ter, sri, srri, kid, sfdr |
| `etf` | 2 370 | JustETF, Morningstar | tous | — |
| `scpi` | 280 | ASPIM, GECO realestate | perf_1y (DVM), aum (capi), category | kid_url (rare) |
| `crypto` | 101 | CoinGecko | aum (market cap), perf, category | kid, sfdr UCITS |
| `fonds_euros` | 50 | Statique GVFM | perf_1y (taux annuel), ter, mngmt | aum public, sfdr UCITS |
| `livret` | 7 | Banque de France | perf_1y (taux légal), aum (encours) | ter (= 0), kid |
| `obligation` | 45 | AFT, statique | perf, srri, rating, mngmt | ter |
| `fcpi` / `fip` / `fcpr` | ~316 | AMF GECO | aum, mngmt, inception, sri/srri | ter (rare), perf souvent absente |
| `fpci` / `fps` / `fct` / `fcpe` | ~367 | AMF GECO | mngmt, inception, aum, asset_class | tout le reste (institutionnels) |
| `opci` | 4 | GECO realestate | perf, srri, aum, frais | — |

**Sémantique des champs par type** :

- **`action`** : `aum_eur` = market cap ; `currency` = devise de cotation ; pas de TER.
- **`scpi`** : `performance_1y` = **DVM** (taux de distribution sur valeur de marché) ; `aum_eur` = capitalisation totale ; `ter` ≈ frais courants annuels (commission de gestion).
- **`crypto`** : `aum_eur` = market cap en EUR ; `currency` = "EUR" (pas la devise du token).
- **`fonds_euros`** : `performance_1y` = taux annuel servi (net frais de gestion) ; `aum_eur` non public.
- **`livret`** : `performance_1y` = taux réglementé (3 % Livret A en 2025) ; `aum_eur` = encours total agrégé Banque de France.

---

## 3. Score `data_completeness` — formule différenciée par type

### 3.1 Problème de la formule uniforme actuelle

La formule legacy dans `scripts/db.py:compute_completeness` applique les mêmes
poids à tous les fonds, ce qui crée des biais structurels :

| Type | Score max structurel | Raison |
|---|---:|---|
| `action` | **56** | Pas de TER, SRRI, KID, SFDR-pénalisée |
| `fonds_euros` | **72** | Pas d'AUM, pas de p3y |
| `livret` | **86** | Pas de KID au sens UCITS |
| `fct` / `fcpe` | **14** | Aucune donnée publique attendue |
| `fpci` | **28** | Institutionnels sans KID |

Conséquence : impossible de filtrer "fonds bien documentés" via `data_completeness ≥ 80`.

### 3.2 Nouvelle formule par `product_type` (v2)

Implémentée dans `scripts/migrations/recalc-completeness-v2.py` (mode `--per-type`).
Chaque type a sa propre pondération, calibrée pour atteindre 100 quand toutes les
sources canoniques sont remplies.

#### ETF & OPCVM (formule alignée UCITS)

| Critère | ETF | OPCVM |
|---|---:|---:|
| Frais (ter ∪ ongoing_charges) | 14 | 14 |
| Risque (sri ∪ srri) | 14 | 14 |
| Perf 1Y | 12 | 12 |
| Perf 3Y | 10 | 10 |
| SFDR | 8 | 8 |
| AUM | 12 | 10 |
| KID parsé | 14 | 14 |
| Volatilité 1Y | 8 | 8 |
| Track record (inception ∪ years) | 4 | 6 |
| Management company | 4 | 4 |
| **TOTAL** | **100** | **100** |

#### Action

| Critère | Points |
|---|---:|
| Devise (currency) | 20 |
| Market cap (aum_eur) | 25 |
| Perf 1Y | 20 |
| Perf 3Y | 15 |
| Perf 5Y | 10 |
| asset_class | 5 |
| pea_eligible (toujours rempli) | 5 |
| **TOTAL** | **100** |

#### SCPI

| Critère | Points |
|---|---:|
| DVM = `performance_1y` | 20 |
| Perf 3Y | 10 |
| Capitalisation (`aum_eur`) | 15 |
| Frais (ter ∪ ongoing_charges) | 10 |
| Risque (sri ∪ srri) | 10 |
| Management company | 10 |
| Inception date | 10 |
| Category | 5 |
| Region | 5 |
| SFDR | 5 |
| **TOTAL** | **100** |

#### Crypto

| Critère | Points |
|---|---:|
| Market cap | 25 |
| Perf 1Y | 20 |
| Perf 3Y | 15 |
| Volatilité 1Y | 15 |
| Risque (sri ∪ srri) | 10 |
| Category | 10 |
| Currency | 5 |
| **TOTAL** | **100** |

**Note** : la nouvelle formule **réduit le score** de la plupart des cryptos
(passage de 100 → 75-85) car `volatility_1y` n'est pas encore calculée. C'est
intentionnel — c'est un signal pour brancher CoinGecko sur les rendements
journaliers.

#### Fonds euros

| Critère | Points |
|---|---:|
| Taux annuel servi (`performance_1y`) | 35 |
| Frais (ter) | 20 |
| Management company | 15 |
| Risque (sri ∪ srri) | 10 |
| AUM (souvent absent → bonus si présent) | 10 |
| Historique 3 ans | 10 |
| **TOTAL** | **100** |

#### Livret

| Critère | Points |
|---|---:|
| Taux légal (`performance_1y`) | 50 |
| Management company | 20 |
| Encours total (`aum_eur`) | 15 |
| Risque (sri ∪ srri = 1) | 10 |
| Currency | 5 |
| **TOTAL** | **100** |

#### Obligation

| Critère | Points |
|---|---:|
| Perf 1Y | 15 |
| Perf 3Y | 10 |
| Risque (sri ∪ srri) | 15 |
| Morningstar rating | 15 |
| AUM | 10 |
| Volatilité | 10 |
| Track record | 10 |
| Management company | 10 |
| Currency | 5 |
| **TOTAL** | **100** |

#### FCPI / FIP / FCPR (PE retail)

| Critère | Points |
|---|---:|
| AUM | 15 |
| Management company | 15 |
| Category | 10 |
| Inception | 10 |
| Track record years | 10 |
| Risque (sri ∪ srri) | 15 |
| Perf 1Y | 10 |
| Perf 3Y | 5 |
| Frais | 5 |
| SFDR | 5 |
| **TOTAL** | **100** |

#### FPCI / FPS / FCT / FCPE (institutionnels)

| Critère | Points |
|---|---:|
| Management company | 25 |
| Inception | 20 |
| Track record years | 15 |
| AUM | 15 |
| Category | 10 |
| SFDR | 5 |
| Currency | 5 |
| asset_class | 5 |
| **TOTAL** | **100** |

Pas de KID/perf/risque exigé : ce sont des produits **non scorables** sur le
plan retail. Atteindre 100 = "documentation administrative complète".

#### OPCI

| Critère | Points |
|---|---:|
| Perf 1Y | 20 |
| Perf 3Y | 15 |
| Risque (sri ∪ srri) | 15 |
| AUM | 15 |
| Frais | 10 |
| Management company | 10 |
| Inception | 10 |
| SFDR | 5 |
| **TOTAL** | **100** |

### 3.3 Impact attendu (dry-run sur 22 292 fonds)

| Type | Avant ≥80 | Après ≥80 | Δ | Avant avg | Après avg |
|---|---:|---:|---:|---:|---:|
| action | 0 (0%) | 5 112 (93%) | **+5 112** | 54.6 | 90.4 |
| fpci | 0 (0%) | 162 (97%) | **+162** | 26.7 | 97.9 |
| fonds_euros | 0 (0%) | 50 (100%) | **+50** | 72.0 | 80.0 |
| fps | 1 (5%) | 17 (85%) | +16 | 30.2 | 93.0 |
| fcpr | 1 (1%) | 10 (12%) | +9 | 30.7 | 66.3 |
| fip | 2 (1%) | 6 (4%) | +4 | 29.5 | 65.7 |
| fcpi | 0 (0%) | 4 (5%) | +4 | 29.1 | 65.5 |
| fcpe | 0 (0%) | 4 (100%) | +4 | 14.0 | 85.0 |
| livret | 4 (57%) | 6 (86%) | +2 | 80.0 | 90.7 |
| scpi | 60 (21%) | 60 (21%) | 0 | 45.6 | 59.7 |
| etf | 2 045 (86%) | 2 042 (86%) | -3 | 94.1 | 94.4 |
| opcvm | 4 210 (32%) | 4 188 (32%) | -22 | 52.7 | 54.0 |
| crypto | 86 (85%) | 56 (55%) | **-30** | 91.7 | 75.3 |
| **TOTAL** | **6 410 (29%)** | **11 718 (53%)** | **+5 308** | 56.8 | 68.2 |

Régressions notables et acceptées :
- **crypto -30** : nouvelle formule exige `volatility_1y` (gap réel à combler).
- **opcvm -22 / etf -3** : la formule est légèrement plus stricte (KID parsé descend de 16 → 14, mais volatility ajoute 8).

### 3.4 Pourquoi des poids différents par type ?

Le score `data_completeness` est un **filtre d'utilisabilité produit**, pas une
note de qualité absolue. Il doit répondre à la question :
> "Ai-je assez d'info pour recommander ce produit à un client retail ?"

Pour une action, la réponse est OUI dès qu'on a market cap + devise + 3 ans de
perf. Pour un fonds euros, OUI dès qu'on a le taux annuel + l'assureur. Cette
sémantique est encodée par les pondérations.

---

## 4. Contraintes DB et garde-fous

### 4.1 Contraintes connues

- `data_completeness` : `int2`, ∈ [0, 100], calculé par trigger ou par `db.upsert_fund`.
- `numeric(8,4)` : `performance_*`, `volatility_*`, `max_drawdown_*`, `sharpe_*` → cap |val| ≤ 9999.9999.
- `numeric(6,4)` : `ter`, `ongoing_charges` → cap |val| ≤ 99.9999.
- `bigint` : `aum_eur` → cap ≈ 9.2 × 10^18.
- `text PK` : `isin` (peut être `SCPI_*`, `FE_*`, `CRYPTO_*`, `FR_LIVRET_*` pour les non-ISIN).
- `currency` : 3 lettres (souvent ISO-4217 + `GBp`).

### 4.2 Garde-fous lors d'un upsert

Tout script qui écrit dans `investissement_funds` doit :

1. **Coercer les types** : `float(v)`, `int(v)` explicites.
2. **Capper les numerics** : `max(-9999.9999, min(9999.9999, val))`.
3. **Valider SRI/SRRI** ∈ [1, 7] et drop sinon.
4. **Convertir AUM en EUR** si la source donne en devise locale.
5. **Décoder HTML** : `html.unescape(name)`.
6. **Recompute `data_completeness`** via `db.compute_completeness` (qui ré-fetch les champs existants pour éviter de baisser un score).

---

## 5. Incohérences détectées (snapshot 2026-05-19)

Sorti de `audit-data-quality.py` exécuté sur 22 292 fonds.

### HIGH severity (correction prioritaire)

| Check | Nb | Top types |
|---|---:|---|
| `perf_decimal` (perfs en fraction) | **1 867** | opcvm=1126, etf=544, action=177, scpi=10 |
| `vol_decimal` (vol en fraction) | **673** | opcvm=571, etf=83, scpi=17, fps=2 |
| `aum_currency` (AUM en devise locale) | **51** | action=50, crypto=1 (devises: IDR, USD, CLP, MXN, ARS) |

### MEDIUM severity

| Check | Nb | Notes |
|---|---:|---|
| `perf_outliers` (\|perf\|>500%) | 153 | action=116 (penny stocks plausibles), opcvm=21 |
| `vol_saturated` (vol = 9999.9999) | 25 | ETFs sans historique propre → NULL recommandé |

### LOW severity

| Check | Nb | Notes |
|---|---:|---|
| `perf_avg_drift` (`average_performance` divergent) | 60 | Relancer `recalc-average-perf.py` |
| `html_entities` (S&amp;P, Legal &amp; General…) | 50 | Migration `html.unescape` |
| `ter_mismatch` (ter ≠ ongoing_charges) | 32 | etf=31, divergence ≤ 0.001 |
| `vol_high` (vol > 100 %) | 25 | etf=22 (anomalies probables) |
| `asset_class_mismatch` (SCPI avec asset_class=diversifie) | 25 | Normaliser à `immobilier` |

### Détail `perf_decimal` par champ

| Champ | Nb |
|---|---:|
| performance_1y | 776 |
| performance_5y | 637 |
| performance_3y | 454 |

### Migrations correctives proposées (non appliquées)

1. **`fix-perf-decimal-all-types.py`** *(à créer)* — étendre `fix-decimal-metrics.py`
   en relâchant la condition (`vol_1y < 0.5`), couvrir tous les champs perf indépendamment.
   Garde-fou idempotent : si déjà multiplié (|perf| ≥ 10 sur un type pour lequel on
   attendait < 1) → skip.

2. **`fix-aum-currency-local.py`** *(à créer)* — pour les 51 fonds avec
   `aum_eur > 10^12`, applique soit :
   - re-fetch depuis Yahoo en demandant le champ `marketCap` en USD puis × taux FX → EUR,
   - soit `NULL` si la devise est exotique (IDR, COP, ARS).

3. **`fix-vol-saturated.py`** *(à créer)* — `UPDATE … SET volatility_1y = NULL
   WHERE volatility_1y >= 9999.9 OR volatility_1y > 200` — puis relancer
   `compute-metrics.py` sur ces ISINs.

4. **`fix-ter-mismatch.py`** *(à créer)* — `SET ter = ongoing_charges WHERE
   ongoing_charges IS NOT NULL` (source primaire KID).

5. **`fix-asset-class.py`** *(à créer)* — table de mapping
   `product_type → asset_class par défaut` :
   ```python
   DEFAULT_ASSET_CLASS = {
       "scpi": "immobilier",
       "opci": "immobilier",
       "crypto": "crypto",
       "obligation": "obligations",
       "livret": "monetaire",
   }
   ```

6. **`fix-html-entities.py`** *(à créer)* — `UPDATE` avec `html.unescape()` sur
   `name` et `management_company` pour les 50 cas restants.

7. **Re-exécuter `recalc-average-perf.py --apply`** — corrige les 60 dérives.

---

## 6. Pipeline recommandé après collecte

```bash
# 1. Audit avant correction
python3 scripts/migrations/audit-data-quality.py --json /tmp/audit-before.json

# 2. Corrections d'unités (à créer)
# python3 scripts/migrations/fix-perf-decimal-all-types.py --apply
# python3 scripts/migrations/fix-vol-saturated.py --apply
# python3 scripts/migrations/fix-aum-currency-local.py --apply
# python3 scripts/migrations/fix-ter-mismatch.py --apply
# python3 scripts/migrations/fix-asset-class.py --apply
# python3 scripts/migrations/fix-html-entities.py --apply

# 3. Recalculs métier (existants)
python3 scripts/migrations/recalc-average-perf.py --apply
python3 scripts/migrations/recalc-track-record.py --apply
python3 scripts/migrations/derive-srri-from-volatility.py --apply
python3 scripts/migrations/set-kid-parsed-at.py --apply --all-data

# 4. Recalc completeness avec la nouvelle formule
python3 scripts/migrations/recalc-completeness-v2.py --per-type --apply

# 5. Audit final
python3 scripts/migrations/audit-data-quality.py --json /tmp/audit-after.json
```

---

## 7. Évolution de la formule dans `scripts/db.py`

`db.compute_completeness` est appelé à chaque `upsert_fund` et `upsert_funds_bulk`.
Pour basculer en formule v2 :

1. Importer `compute_completeness_v2` depuis le script de migration (ou copier la
   fonction dans `db.py`).
2. Modifier `db.compute_completeness` pour dispatcher selon `product_type`.
3. Garder un fallback legacy si `product_type` est absent.

**Recommandation** : ne pas faire le switch tant que les corrections d'unités
(§5) n'ont pas été appliquées, sinon les scores reflètent des données fausses.
