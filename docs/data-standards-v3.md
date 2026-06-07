# Data Standards v3 — Charlie Investissement

> Conventions de données pour `investissement_funds` et tables associées.
> Mise à jour : 19 mai 2026 (post-migration `field_sources` + AV Lux + share classes).

---

## 1. Conventions générales

### 1.1 Préfixe table
**Toutes les tables du domaine investissement DOIVENT être préfixées `investissement_*`.**

Tables principales :
- `investissement_funds` (table maîtresse, ~22 500 lignes)
- `investissement_fund_prices` (VL historiques)
- `investissement_pipeline_runs` (logs des scrapers)
- `investissement_av_lux_companies` (compagnies AV Lux)

### 1.2 Identifiants
- `isin` (TEXT, PK) : ISIN officiel (FR/LU/IE/...) OU code synthétique (`CRYPTO_BTC`, `SCPI00000XXX`, `FR_LIVRET_A`, `AMF*`, `GFI*`)
- Pas d'auto-increment : la clé primaire est l'ISIN ou son équivalent

---

## 2. Unités numériques

| Champ | Unité | Exemple |
|---|---|---|
| `performance_1y`, `_3y`, `_5y` | **% en valeur absolue** | `12.5` = +12.5%, `-8.4` = -8.4% |
| `volatility_1y`, `_3y` | **% en valeur absolue** | `23.5` = 23.5% |
| `sharpe_1y`, `_3y` | adimensionnel | `1.33`, `-0.91` |
| `max_drawdown_1y`, `_3y` | **% négatif** | `-19.07` = drawdown de 19.07% |
| `ter`, `ongoing_charges` | **fraction décimale** | `0.012` = 1.2% |
| `aum_eur` | **EUR (entier)** | `12345678` = 12 345 678 € |
| `sri`, `srri` | **entier 1-7** | mapping ESMA |
| `sfdr_article` | **entier 6 / 8 / 9** | classification SFDR |
| `inception_date` | ISO date | `2018-06-15` |
| `track_record_years` | float | `7.5` |

### 2.1 Convention SCPI spéciale
Les **SCPI** ont historiquement leur `ongoing_charges` exprimé en pourcentage des **loyers** (10-15% typique), pas en pourcentage de l'AUM comme les UCITS.
**Convention v3** : on convertit en fraction (ex: `0.10` au lieu de `10`).
Le fix appliqué le 19/05 a corrigé 103 SCPI qui étaient stockées comme `12.0` au lieu de `0.12`.

### 2.2 Mapping ESMA SRI ↔ Volatilité 3y
| SRI | Volatilité 3y annualisée (%) |
|---|---|
| 1 | < 0.5% |
| 2 | 0.5% – 2% |
| 3 | 2% – 5% |
| 4 | 5% – 10% |
| 5 | 10% – 15% |
| 6 | 15% – 25% |
| 7 | ≥ 25% |

---

## 3. Devises (ISO 4217 strict)

**Toutes les devises DOIVENT être en code ISO 4217 majeur** (3 lettres, devise principale).
Pas de sous-unités (pence, cents, agorot).

Mapping appliqué (`scripts/migrations/normalize-currency.py`) :
| Variante | → ISO 4217 |
|---|---|
| `GBp` (pence) | `GBP` |
| `GBX` | `GBP` |
| `ZAc` (cents) | `ZAR` |
| `ILA` (agorot) | `ILS` |
| `KWF` | `KWD` |

Si une perf est stockée en EUR mais le `currency` du fonds est USD, c'est le `currency` qui prime — on enregistre toujours les **performances dans la devise du fonds**, pas en EUR.

---

## 4. Traçabilité par champ (`field_sources` JSONB)

### 4.1 Schéma
```jsonb
{
  "ter":            "quantalys",
  "performance_1y": "morningstar",
  "sri":            "kid_pdf",
  "aum_eur":        {"source": "amf-geco", "at": "2026-05-19T08:12:00Z"}
}
```
- Une clé = un nom de colonne snake_case
- Une valeur = source courte (V1) ou objet `{source, at}` (V2 avec timestamp)
- Clé absente = champ NON tracé (utiliser `data_source` legacy comme fallback)

### 4.2 Convention pour les enrichers futurs
**Ne pas écraser `data_source` (legacy)**. À la place :
1. `SELECT field_sources FROM investissement_funds WHERE isin=...`
2. Merger les nouvelles clés
3. `UPDATE ... SET field_sources = $new_field_sources, [...autres colonnes]`

Exemple Python (pattern recommandé) :
```python
def upsert_with_sources(isin: str, data: dict, source: str):
    existing = client.table("investissement_funds") \
        .select("field_sources").eq("isin", isin).execute().data[0]
    fs = existing.get("field_sources") or {}
    for field in data:
        if field != "isin" and data[field] is not None:
            fs[field] = source
    client.table("investissement_funds") \
        .update({**data, "field_sources": fs}) \
        .eq("isin", isin).execute()
```

### 4.3 État de la migration (19/05)
- Migration SQL : appliquée ✓
- Backfill : 22 484 fonds peuplés ✓
- Sources distinctes top : `amf-geco`, `wikidata-yahoo-eu`, `euronext`, `yahoo-finance`, `coingecko`, `quantalys`, `kid_pdf`, `morningstar`, etc.

---

## 5. AV Luxembourg

### 5.1 Table compagnies (`investissement_av_lux_companies`)
20 compagnies AV Lux principales seedées :
Lombard International, OneLife, Sogelife, Wealins, Generali Lux, Cardif Lux Vie, Vitis Life, Baloise Lux, AXA Wealth Europe, Allianz Life Lux, SEB Life International, Swiss Life Lux, Utmost, CNP Lux, Aviva Lux, HSBC Life, Natio Vie, Lalux, Zurich Eurolife, Private Insurer.

### 5.2 Flag éligibilité (`av_lux_eligible` BOOLEAN)
Heuristique conservative appliquée le 19/05 :
- ISIN `LU*` OU `IE*` (UCITS Irlande aussi commercialisés en Lux)
- `product_type` ∈ {etf, opcvm, sicav}
- `currency` ∈ {EUR, USD, GBP, CHF} ou NULL
- `aum_eur ≥ 5_000_000` OU NULL

**2 895 fonds flagés** comme `av_lux_eligible = TRUE`.
Cette heuristique signifie "**probablement éligible**" — la liste exacte dépend du contrat (catalogue UC propre à chaque compagnie).

---

## 6. Classes de parts (`share_class_group_id`)

### 6.1 Définition
Un même fonds OPCVM/ETF peut exister sous plusieurs ISINs représentant ses **classes de parts** différentes :
- Acc (capitalisation) vs Dist (distribution)
- EUR / USD / GBP / CHF / hedged
- A / B / I (institutionnel) / R (retail)

### 6.2 Clustering automatique
Le script `scripts/migrations/cluster-share-classes.py` regroupe les ETF/OPCVM/SICAV ayant :
- Même nom normalisé (sans suffixes class/currency/distribution)
- Même `product_type`
- Même `management_company_normalized`

Chaque cluster reçoit un `share_class_group_id` (18 chars UUID slug) partagé entre les ISINs.

### 6.3 Exclusions
Les noms suivants sont **exclus** du clustering (faux positifs) :
- "Fonds dédié***" (placeholder AMF)
- Noms contenant une année (2018-2099) ou un mois (FCPI millésimés)
- Noms se terminant par un chiffre romain (II, III, ... — millésimes différents)
- "Autocall" (produits structurés datés)

---

## 7. Sociétés de gestion (`management_company_normalized`)

### 7.1 Mapping canonique
Le script `scripts/migrations/normalize-management-company.py` normalise les 854+ variantes vers ~300 entités canoniques principales :

| Variante exemple | → Canonique |
|---|---|
| "AMUNDI ASSET MANAGEMENT" / "Amundi Asset Management" / "AMUNDI" | **Amundi** |
| "BlackRock" / "iShares" / "BlackRock Inc." | **BlackRock** |
| "BNP Paribas Asset Management Europe" / "BNP PARIBAS AM" | **BNP Paribas AM** |
| "CREDIT MUTUEL ASSET MANAGEMENT" / "CM-AM" / "CMCIC" | **Crédit Mutuel AM** |

### 7.2 Convention
- `management_company` : valeur brute (préservée pour audit)
- `management_company_normalized` : nom canonique (préféré pour requêtes / groupage)

---

## 8. Product types autorisés

```
etf, opcvm, sicav, scpi, action, crypto, fonds_euros,
fcpi, fcpr, fct, fip, fps, fpci, obligation, livret, opci
```

---

## 9. Données interdites

- ❌ Performances stockées sous forme de **fraction** au lieu de % (ex: `0.125` au lieu de `12.5`).
- ❌ TER stocké sous forme de **pourcentage** au lieu de fraction (ex: `1.2` au lieu de `0.012`).
- ❌ Devises en **sous-unités** (`GBp`, `ZAc`, `ILA`).
- ❌ Champs `data_source` écrasés sans préservation dans `field_sources`.
- ❌ `data_completeness` écrit en dur sans recalcul (utiliser `db.py:compute_completeness` ou `recalc-completeness-v2.py`).

---

## 10. Documentation associée

- `docs/data-collection-playbook.md` — guide des scrapers (840 lignes)
- `docs/data-sources-fonds-euros.md` — sources fonds euros testées
- `docs/data-sources-scpi.md` — sources SCPI
- `scripts/migrations/migrate-data-source-jsonb.sql` — schéma de la migration
- `scripts/migrations/audit-data-quality-extended.py` — audit complet

---

**Version 3** — Validée par l'audit étendu du 19/05/2026 sur 22 485 fonds.

---

## 11. Addendum v3.1 — Normalisation back-end du 05/06/2026 (35 988 fonds)

### 11.1 Unités de frais — convention durcie
- **Canonique base = fraction** pour `ter` et `ongoing_charges` (`0.018` = 1,8 %). Confirmé.
- Correctif appliqué : **972 lignes** stockées par erreur en pourcent ont été divisées par 100.
  - Non-SCPI : toute valeur `≥ 0.1` (impossible en fraction pour un fonds retail) → `/100`.
  - SCPI : `ongoing_charges` = fraction des loyers (0,10–0,18) ; seules les valeurs `> 1` → `/100`.
  - Backup réversible : table `investissement_funds_units_backup_20260605`.
- **Contraintes CHECK ajoutées** (anti-régression, migration `fees_unit_check_constraints`) :
  `chk_ter_fraction` et `chk_ongoing_fraction` → `ter`/`ongoing_charges ∈ [0, 0.5]`.
  Toute future insertion en pourcent (>0.5) est désormais **rejetée par la base**.

### 11.2 Frontière API = pourcent (règle d'exposition)
La base stocke en fraction ; **toutes les routes Next.js convertissent en % à la frontière**
via `feeFracToPct()` (`app/src/lib/format.ts`, testée). Routes concernées :
`/api/funds`, `/api/funds/[isin]`, `fonds/[isin]/page.tsx`, `/api/matching`,
`/api/fonds/[isin]/similar`, `/api/screener/top-performers`, et `RapportFondsPDF`.
- L'ancien pansement `normTer` (×100 si <0.1) est **supprimé** : il cassait l'affichage SCPI
  (0,18 restait « 0.18 % » au lieu de 18 %).
- ⚠️ Le scoring `scoreTER` (`lib/matching.ts`) attend des **pourcents** (seuils 0,3–2,0) :
  la route matching convertit donc avant `scoreFunds`.

### 11.3 Performances aberrantes
- **5 artefacts** non-action/crypto (OPCVM/FPCI > 300 %/an, ex. +5604 %) → `performance_1y`
  mis à `NULL`. Backup : `investissement_funds_perf_backup_20260605`.
- Les gros mouvements réels (crypto, valeurs tech) sont **conservés** (action/crypto exclus du nettoyage).

### 11.4 Données nouvellement exposées (fiche fonds)
`hedged`, `distributor_france`, `ucits_compliant` (carte Caractéristiques) + `field_sources`
/`data_source` (nouvelle carte **Provenance des données**). `min_subscription_eur` reste vide
(0 ligne) → non exposé tant que non collecté.

### 11.5 Enrichissement dérivé en base — `asset_class_broad`
Dimension **filtrable/affichée** du screener qui n'était couverte qu'à ~44 %.
**+20 256 fonds** classés par mapping déterministe depuis `asset_class` (traçabilité
`field_sources.asset_class_broad = "derived-from-asset_class"`) → couverture **100 %**.
Mapping appliqué :
- `product_type='action'` → `action_individuelle`
- `actions`, `communication` → `action`
- `diversifie`, `multi-actifs` → `diversifie`
- `obligations` → `obligation`
- `matieres_premieres` → `matieres_premieres`
- `alternatif`, `private_equity`, `infrastructure` → `alternatif`

**Limites (nécessitent une source de catégorie externe)** :
`region_normalized` (53 %) et `sector` (26 %) ne sont **pas dérivables** du nom ni par SQL
(les fonds sans région sont majoritairement des actions individuelles sans zone dans le nom ;
une passe par mots-clés ne remonte que 3 fonds).

### 11.6 État de l'enrichissement (05/06/2026) — IN-DB épuisé
- **`compute-metrics`** : `nav250_no_p1y = 0` → toutes les VL disponibles sont déjà calculées en perf/vol. Rien à faire.
- **`classify-from-name`** : 0 fonds à enrichir après correctif (cf. ci-dessous). `management_style` 84 % / `ucits_compliant` 9 % = plafond de l'heuristique par nom.
- **`asset_class_broad`** : 100 % (cf. §11.5).
- Les gaps restants (OPCVM TER 51 %, perf 52 %, région, secteur) exigent de la **donnée externe** (Quantalys/GECO/Morningstar).

**⚠️ Sécurité scrapers — NE PAS lancer les scrapers de seeding sur la base curée.**
`scripts/scrapers/amf-geco-full.py` (et assimilés) appellent `upsert_funds_bulk` →
`upsert(on_conflict="isin")` qui **écrase toutes les colonnes fournies** et **recalcule
`data_completeness` à partir des seuls champs du scraper** (épars). `map_geco_record`
hardcode `currency="EUR"` et `data_source="amf-geco"`. Les lancer en l'état **dégraderait**
la base (devises USD/GBP→EUR, provenance écrasée, complétude effondrée).
→ Pour enrichir sans casse : utiliser `update_funds_bulk` (UPDATE-only) + un merge **fill-only**
des NULL + merge `field_sources` (jamais d'écrasement). Stack scraper validée :
`scrapling + curl_cffi + playwright + browserforge + lxml` dans `scripts/.venv` (Python 3.11).

**Correctif `classify-from-name.py`** : le `SELECT` n'incluait pas `management_style` /
`ucits_compliant` / `per_eligible` → la garde `not f.get(k)` était toujours vraie et le script
**réécrivait** ces champs à chaque run (faux « N mis à jour », gain nul). Corrigé → fill-only idempotent.

### 11.7 Couche d'enrichissement sûre + run GECO fill-only
- **`db.safe_fill_funds(records, source)`** : primitive d'enrichissement non-destructive —
  remplit uniquement les colonnes NULL des fonds existants, merge `field_sources`, ne recalcule
  pas la complétude des existants, insère les nouveaux ISIN. À utiliser pour **tout** futur
  scraper (au lieu de `upsert_funds_bulk`).
- **`scripts/enrichers/geco-safe-enrich.py`** : applique GECO via `safe_fill_funds`.
  Run du 05/06 : 12 804 collectés, 12 757 déjà en base, **+47 nouveaux supports**, 4 champs NULL
  remplis, **0 dégât** (4 125 devises non-EUR préservées — l'upsert destructif les aurait forcées à EUR).
  → GECO confirmé quasi-épuisé contre cette base. Base = **36 035 fonds**.

---

### 11.8 Constat stratégique : le trou de perf OPCVM est STRUCTUREL
Test Boursorama sur les OPCVM sans `performance_1y` → **0 hit perf** même sur les meilleurs
candidats retail. Caractérisation des 13 092 OPCVM sans perf : 93 % sans AUM, 5 724 noms
structurés/datés/dédiés (« AMUNDI 09/19/2019 », « MILLESIMA 2032 »), 1 135 trop récents (<1 an).
**Ce sont massivement des véhicules non-retail** (fonds à formule, dédiés, mandats
institutionnels, monétaires, FPCI mal classés) sans VL/perf publique. Les ~51 % de couverture
perf = **plafond réaliste** de l'univers réellement investable. Brute-force scraping = ROI quasi nul.
→ Le levier n'est pas « plus de perf » mais **mieux exploiter l'univers investable** (= ceux qui
ont une perf : 13 578 OPCVM, déjà à frais 81 % / SRI 100 % / AUM 99 %).

### 11.9 Dérivation secteur + région depuis `category` (gros gain exploitabilité)
La `category` (classification AMF/fournisseur) couvre 94 % des OPCVM investables et encode
asset-class + région ; les « Actions Sectorielles X » désignent le secteur.
`scripts/migrations/derive-sector-region-from-category.sql` (fill-only, idempotent, traçabilité) :
- **`sector` : 13 % → 77 %** sur les OPCVM investables (26 % → 64 % global). Mapping des
  « Actions Sectorielles X » → secteur précis ; diversifiés/géographiques/mixtes → `Multisecteur`
  (valeur honnête qui rend le filtre utilisable) ; obligations/monétaires laissés NULL.
- **`region_normalized`** : déjà à 74 % (plafond — le reste sont des fonds mixtes/flexibles
  sans mandat géographique).
- Le filtre secteur du screener est data-driven (RPC) → `Multisecteur` + secteurs remontent
  automatiquement, **sans changement de code front**.

### 11.10 KID/DICI — catalogue maître amfinesoft EPR (DÉBLOCAGE)
Le portail réglementaire **amfinesoft EPR** (`epr.amfinesoft.com`) héberge les DICI PRIIPs de
quasiment tous les fonds distribués en France. Les URLs sont **constructibles par ISIN** avec une
clé d'accès publique (présente dans les DICI publiés). Plusieurs (distributeur, clé) existent :
- **générique** (catalogue maître) : `/api/v1/download/underlying/kid/{ISIN}/lang/fr?key=xJdkzl5Bq4GWwvPKrtPRSK4a9QfrXe`
- SOGECAP : `/download/SOGECAP/underlying/kid/{ISIN}/lang/fr?key=7pPlB7HoeaCTjsHOsYGA87RfJcmpSQ`
- AXA : `/download/AXA/underlying/kid-security/{ISIN}/lang/fr?key=LKCkPWj3Jd2y8HlRp3QAtQ6Cjz36KB`
- SPIRICA : `/download/SPIRICA/underlying/kid/{ISIN}/lang/fr?key=tldIV1x9…`

`scripts/enrichers/epr-kid-enrich.py` : pour chaque OPCVM/ETF sans kid_url, construit l'URL,
valide le PDF (magic `%PDF`), stocke via `safe_fill_funds` (fill-only). Run 05/06 : **+817 DICI**
sur 16 550 ciblés (**48 % de hit sur les gros fonds, ~5 % global** — la longue traîne kid-null
est dominée par le non-retail : PE/structurés/dédiés/obscurs sans DICI PRIIPs). KID des OPCVM
investables : **65 → 70 %**. Le plafond rejoint celui de la perf (univers retail déjà couvert).

**Sources HS** (ne pas réutiliser) : GECO épuisé (héberge seulement un sous-ensemble),
`kid-url-finder.py` (DuckDuckGo/SGP) périmé, Morningstar hash opaque + IP-block.

### 11.11 Cohérence métriques screener (06/06/2026) — perf annualisée + double-conversion frais

Audit qualité « métriques pas délirantes » pour le screener CGP. Trois bugs corrigés :

1. **Double-conversion des frais (×100)**. La vue `investissement_funds_cgp` faisait `ter*100`
   **et** l'API refaisait `feeFracToPct` → un ETF à 0,07 % s'affichait **7 %**. Fix : la vue
   renvoie désormais la **fraction brute** (`ter`, `ongoing_charges`) ; l'API reste l'unique point
   de conversion (cf. 11.2). Invariant : **DB/vue/RPC = fraction, API = %**.
2. **Colonnes générées `ter_pct`/`ongoing_charges_pct` buggées**. Expression `WHEN ter<0.01 THEN
   ter*100 ELSE ter` → fraction conservée à tort pour 69 % des lignes. Corrigée en `round(ter*100,4)`
   (`ALTER COLUMN … SET EXPRESSION`, PG17). Les RPC `get_top_performers`/`get_similar_funds`/
   `get_fund_detail` n'utilisent plus ces colonnes → passées à `ter`/`ongoing_charges` bruts.
3. **Perf 3y/5y cumulé affiché comme annualisé**. La base stocke 3y/5y en **cumulé** (uniforme,
   toutes sources) ; le contrat type annonçait « annualisé ». Fix : annualisation à l'affichage,
   colonnes brutes intactes (réversible).
   - SQL : helper `inv_annualize(cumul, years)` utilisé dans la vue + les 3 RPC.
   - TS : helper `annualizeCumul(cumulPct, years)` (`lib/format.ts`, testé) dans `funds/[isin]`
     (détail) et `rapport/pdf` (routes lisant la table brute). **Garder les 2 helpers alignés.**
   - Résultat : perf_3y médiane **6,7 %/an**, 56 fonds > 100 %/an (titres spéculatifs réels, conservés).

**Nettoyages** : perfs fonds euros `quantalys-supporteuro` > 10 % nullées (183, un fonds euros
plafonne ~8 %) ; TER synthétique ~4,62 % nullé sur **1 719 actions** (une action n'a pas de frais
courants). TER médian affiché après fix : **1,52 %** (réaliste).

---

### 11.12 Éligibilités & hygiène perf (07/06/2026)

- **PEA — NON dérivable en masse depuis les champs actuels.** Un dry-run d'une règle
  région+asset_class a produit des erreurs dans les deux sens car `region_normalized`/
  `asset_class_broad` sont **bruités** (ex. *Amundi Prime Europe* taggé `usa` ; *Crescent Direct
  Lending LP*, fonds de dette, taggé `action`). Réécrire `pea_eligible` en masse = **risque
  conformité**. Décision : ne PAS mass-flipper. Seul ajout sûr = **signal déclaratif fiable du nom**
  (`name ~* 'PEA'`) → +102 fonds (`field_sources.pea_eligible = "derived-name-pea"`). Pour vraiment
  combler le PEA il faut une **source autoritaire** (KID, liste PEA éditeur), pas une dérivation.
- `pea_eligible` n'a **aucun null** (classification complète true/false), héritée d'un heuristique
  faible — ne pas la traiter comme autoritaire.
- **Hygiène perf par catégorie** : monétaire avec perf > 15 %/an (6) ou cumul 3y > 30 % (8), et
  obligataire avec perf_1y > 50 % (20) → perfs nullées (impossibles). Monétaire max repassé à 4,6 %.
- **Frais : pas de vrai trou.** TER OPCVM 80 %, ETF 93 %. Le « 58 % global » était dilué par les
  actions (sans TER, nullées 06/06) et les **FPS** (1 033 coquilles : 1 % TER, 0 % perf/SRI).

### 11.13 Fiabilisation classification depuis le nom (07/06/2026)

Le nom du fonds est le **signal le plus fiable** (region/asset_class issus des sources sont bruités).
Re-dérivation **haute-précision en SQL** (via MCP, car `.env` locaux = stubs) :

- **Région** : on ne dérive que si le nom contient **exactement un** signal régional (sinon ambigu →
  ignoré). 96 % d'accord avec le stocké (validation). Tokens parasites **nettoyés** avant matching
  (`swiss life`, `russell investments`, `global funds` = gérants/umbrella, pas des régions) ; `euro`
  ajouté comme signal europe (rend les noms umbrella multi-signaux → exclus). **Override interdit
  vers `world`** (signal faible). Résultat : **220 corrigés** (201 overrides + 19 fills), ex.
  *BlackRock Global Funds - China Bond* : `world`→`china`.
- **Asset class** : conflits nom↔stocké corrigés (**366**) — surtout fonds obligataires/dette taggés
  `action` (US Treasuries, Corporate Bonds, Private Debt, Senior Lending) ou `diversifie`. `shares`
  retiré du signal actions (mot de classe de part) ; pluriels `obligations`/`bonds` détectés pour
  exclure les mixtes (ex. *Junon Actions Obligations*).
- **PEA — retrait FP non-actions** : un fonds `obligation`/`monetaire`/`immobilier`/
  `matieres_premieres`/`crypto` ne peut être PEA-éligible → **42 faux positifs** retirés. Combiné au
  fix asset_class, ça assainit les faux « PEA » (fonds obligataires qui étaient taggés action+PEA).

`field_sources` tracent les dérivations : `derived-name-region-v2`, `derived-name-assetclass-v2`,
`derived-assetclass-noneq`, `derived-name-pea`. **Toutes réversibles** (filtrables par field_sources).

### 11.14 QA pré-démo : SCPI non-annualisées + purge TER garbage (07/06/2026)

QA du parcours complet sur l'app déployée (API via MCP Vercel). Deux bugs trouvés et corrigés :

- **SCPI/livret sur-annualisés** : leur perf multi-années est un **taux annuel** (distribution SCPI,
  taux livret), pas du cumulé — l'annualisation v3.2 les compressait (Corum Origin affichait
  1,99 %/an au lieu de **6,06 %**). Fix : helper `inv_annualize_pt(cumul, years, product_type)` (SQL)
  + `annualizeForType()` (TS) qui **excluent `scpi`/`livret`**. Appliqué vue + 3 RPC + routes
  détail/PDF. fonds_euros et obligation restent annualisés (eux sont bien cumulés, vérifié).
- **TER garbage** : ~5 500 OPCVM/ETF avaient un TER **factice en clusters** (677 fonds à 5,04 %,
  482 à 4,83 %, 454 à 5,18 %… valeurs identiques au centième = artefact de parsing amf-geco/cssf).
  Aucun UCITS n'a >4 % de frais courants. **Nullés** (ter/ongoing_charges, `ter > 0.04`) →
  médiane TER 1,10 %, max 4,00 %. Couverture TER OPCVM/ETF 80 %→41 % mais **fiable** (un « — »
  honnête vaut mieux qu'un faux 4,83 %).

### 11.15 Complétude métadonnées dérivées (07/06/2026)

Dérivations in-DB (sans scraper), tracées `field_sources`, réversibles :

- **`track_record_years` recalculé depuis `inception_date`** = `(today - inception)/365.25`.
  Corrige un **plafonnement à 5 ans** (3 112 fonds anciens affichaient « 5 ans » ; ROBECO 1938
  affichait 4,2 → **88,3 ans**) + 5 496 incohérences. Couverture 74 %→92 %, médiane 8,7 ans.
  `inception_date = 1800-01-01` (placeholder, 2 fonds) nullée.
- **`management_style`** comblé (ETF→passif, factor→smart_beta, long/short→alternatif, sinon
  actif) → 100 % sur OPCVM/ETF (le reste = actions/crypto, sans style).
- **`sector`** comblé sur actions/diversifiés sans secteur : mot-clé thématique sinon
  `Multisecteur` → 78 %→81 %. Non appliqué aux obligataires/monétaires (secteur actions non
  pertinent). `field_sources` : `derived-name-style`, `derived-name-sector`, `derived-inception-date`.

NB : `data_completeness` n'a pas été recalculé après la purge TER garbage (§11.14) — les scores
des fonds concernés sont légèrement surévalués mais ≥50 (restent visibles avec un TER « — »).

### 11.16 Référentiel sociétés de gestion — dérivation + consolidation (07/06/2026)

`management_company_normalized` était à ~70 % et **fragmenté** (1 038 valeurs, doublons de casse/
suffixe : « Moneta Am » vs « Moneta AM », « AXA IM » vs « AXA Investment Managers », « Eurazeo »
vs « Eurazeo Global Investor »…). Deux passes via mapping `(regex → canonique)` :

- **Consolidation** : variantes existantes → forme canonique unique (Moneta AM, Dorval AM, AXA IM,
  M&G, Ostrum AM, Swiss Life AM, VanEck, Vontobel, H2O AM, Ardian, Eurazeo, KKR, CVC…).
- **Dérivation depuis le nom** (ancrée au début, fill-only) : ~60 marques (AMs majeurs + PE/
  alternatifs : Amundi, BNP Paribas AM, BlackRock, Schroders, Blackstone, Ares, GTCR, CVC,
  Wellington, Suravenir, Handelsbanken…). Échantillon de contrôle : **100 % corrects**.

Résultat : gestionnaire **ETF 99 % / OPCVM 97 % / SCPI 100 %** (investable). `field_sources` :
`canonical-map-v1` (consolidation), `derived-name-company` (dérivation). Réversible.
Limite : produits structurés (Phoenix/Athena/Autocall) non mappables (l'émetteur n'est pas
dans le nom) — restent sans gestionnaire, ce qui est honnête.

### 11.17 Labels ESG français + limite SFDR (07/06/2026)

- **SFDR — NON fiable, non corrigé.** `sfdr_article=9` est **sur-attribué** (4 525 fonds = 28 %,
  alors que l'Article 9 réel ≈ 3-5 % ; seuls 12-36 % ont un nom ESG). La source est générique
  (amf-geco/absent), pas une classification SFDR autoritaire, et le 8↔9 est invérifiable sans
  prospectus. Comme le PEA (§11.12), **on ne réécrit pas en masse** (sur-classer Art. 9 = risque
  greenwashing). Le label `esg` étant dérivé du sfdr, il ne corrobore pas. → source autoritaire requise.
- **Labels français dérivés du nom** (signal indépendant, fiable) : `isr` (367, label d'État —
  était **absent**), `finansol` (88), `relance` (6) ; `greenfin` (0 nommé). + `esg` ajouté aux
  fonds ISR/Finansol qui le sont par définition. Whitelist d'affichage `CharacteristicsCard`
  étendue (finansol, relance).

### 11.18 Recalcul complétude + sweep qualité final (07/06/2026, pré-lancement public)

- **`data_completeness` recalculé** (formule v2 per-type, répliquée en SQL depuis
  `recalc-completeness-v2.py`) pour refléter purges TER + perfs nullées. Impact honnête :
  univers ≥50 ≈ 23 279 → ~22 900. OPCVM −172 (TER garbage retiré), **fonds_euros 276→93**
  (les 183 quantalys-supporteuro sans taux servi valide sortent — un fonds euros sans taux
  n'est pas exploitable). Pas d'effondrement.
- **Sweep valeurs aberrantes** (univers ≥50) : drawdown/AUM/devise/SRI/Morningstar **tous OK**.
  Nullés : `volatility_1y > 80 %` sur 51 fonds non-leveragés (HSBC Hang Seng 712 %, ETF or 139 %,
  S&P 500 323 % = erreurs ; les ETF 2x/3x préservés) + `sharpe_1y` associé ; `performance_1y > 150 %`
  sur 29 fonds non-leveragés (ETF Corée/Space +230 % = impossible pour un indice).
- Screener par défaut validé : Livret A/PEL, iShares Core MSCI World (TER 0,30 %, 19 %/an, vol 12 %),
  PIMCO Income, Pictet Japan — fonds crédibles, métriques réalistes.

---

**Version 3.1** — Normalisation + exposition + enrichissement (asset_class_broad 100 %, couche fill-only, GECO +47, secteur 13→77 %, KID plafond gratuit), 05/06/2026, 36 035 fonds.
**Version 3.2** — Cohérence métriques screener (perf annualisée, double-conversion frais corrigée, ter_pct régénéré), 06/06/2026.
**Version 3.3** — Éligibilités (PEA additif fiable, non-dérivation documentée) + hygiène perf par catégorie, 07/06/2026.
**Version 3.4** — Fiabilisation classification depuis le nom (région 220, asset_class 366, PEA −42 FP non-actions), 07/06/2026.
**Version 3.5** — QA pré-démo (SCPI non-annualisées, purge TER garbage) + complétude métadonnées (track_record, style, sector, sociétés de gestion 70→97 %), 07/06/2026.
**Version 3.6** — Labels ESG français (ISR/Finansol/Relance) + recalcul complétude v2 + sweep qualité final (vol/perf aberrantes), pré-lancement public, 07/06/2026.
