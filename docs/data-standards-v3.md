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

---

**Version 3.1** — Normalisation back-end + exposition + enrichissement asset_class_broad, 05/06/2026, 35 988 fonds.
