# Mapping EET → durabilité MiFID (pour Sacha)

**But** : remplir les 3 colonnes MiFID quantitatives restées vides, **depuis les
MÊMES fichiers EET** que tu parses déjà pour `esg_exclusions`. Ces 3 champs sont
des colonnes standard de l'European ESG Template (FinDatEx) — pas besoin de scraper
des annexes PDF (piste épuisée : Morningstar plafonné à ~817 fonds, cf.
`memory/durabilite-mifid-annexe-sfdr`). L'EET est la **source primaire**.

Les colonnes existent déjà en base (migration `20260714…`/schéma actuel) :
`taxonomy_alignment_pct numeric`, `sustainable_investment_pct numeric`,
`pai_considered boolean`, + `sustainability_source text`, `sustainability_computed_at`.

## 1. Correspondance des champs

> Les **codes** EET varient selon la version (v1.1/v1.1.1/v1.2) et le bloc Art. 8
> vs Art. 9. Tu as les fichiers → **matche par libellé** ; les codes ci-dessous sont
> les plus courants, à confirmer contre tes en-têtes.

| Notre colonne | Concept EET (SFDR RTS) | Libellé EET à chercher | Code EET usuel |
|---|---|---|---|
| `sustainable_investment_pct` | Part **minimale d'investissements durables** (art. 2(17)) | *"Minimum proportion of sustainable investments"* | **20510** (parfois 20515 = env., 20520 = social → prendre le **total** 20510) |
| `taxonomy_alignment_pct` | Part **minimale alignée sur la taxinomie UE** | *"Minimum proportion of Taxonomy-aligned investments"* — préférer la variante **hors dette souveraine** (celle affichée dans l'annexe) | **20530** (incl. souverain) / **20540** (excl. souverain → privilégier) |
| `pai_considered` | Prise en compte des **principales incidences négatives (PAI)** | *"Does the product consider Principal Adverse Impacts on sustainability factors?"* | **20440** (Y/N) |

### Nuance Art. 8 vs Art. 9
L'EET sépare parfois les engagements en deux blocs (produit art. 8 → un jeu de
champs, art. 9 → un autre). Règle simple : prends la valeur **renseignée** pour le
fonds (un seul bloc est rempli selon son `sfdr_article`). Si les deux existent,
prends le bloc correspondant à `investissement_funds.sfdr_article`.

## 2. Règles de conversion (identiques à l'esprit de l'enricher annexe)

- **Pourcentages** : l'EET donne souvent une **fraction** (`0.15`) ou un **%**
  (`15`). Normalise : `v = float(x); si v <= 1 : v *= 100`. Borne `0 ≤ v ≤ 100`,
  sinon rejette (NULL). Arrondi 2 décimales.
- **PAI (booléen)** : `Y`/`Yes`/`Oui`/`true`/`1` → `true` ; `N`/`No`/`Non`/`false`/`0`
  → `false` ; vide/`n/a` → NULL (ne pas écrire).
- **Garde-fou plausibilité** : `taxonomy_alignment_pct` est un **sous-ensemble** de
  `sustainable_investment_pct`. Si `taxo > SI` (+ epsilon), **jette la taxo**
  (valeur douteuse) plutôt que de l'écrire — comme dans `sfdr-annex-enricher._sane`.

## 3. Conventions d'écriture (comme pour `esg_exclusions`)

- **Fill-only strict** : n'écris jamais sur une valeur non-nulle existante (ces
  colonnes ont ~200 valeurs déjà posées par l'annexe Morningstar — ne pas écraser).
- **Traçabilité** : sur tout fonds traité, poser
  `sustainability_source = 'eet:<sgp>-<periode>'` (même format que ton
  `esg_exclusions_source`, ex. `eet:pictet-2026-05`) et
  `sustainability_computed_at = now()`.
- Réutilise `update_funds_bulk` (comme pour les exclusions) — 0 upsert destructif,
  ne jamais toucher `sfdr_article`.

## 4. Intégration concrète
C'est **la même boucle** que ton `esg-exclusions-enricher.py` : tu as déjà la ligne
EET par fonds en mémoire au moment d'écrire `esg_exclusions`. Ajoute simplement,
dans le même `row`, les 3 champs ci-dessus (après conversion) quand ils sont
présents et NULL en base. Un seul run couvre les 1 203 fonds déjà chargés (et les
suivants).

## 5. Vérif après chargement (je m'en occupe)
Une fois écrit, je confirme le flux comme pour les exclusions :
`taxonomy_alignment_pct` / `sustainable_investment_pct` / `pai_considered` remontent
dans `investissement_funds_cgp_ref` (moteur) et `inv_funds_search` (screener),
et j'affiche la couverture par SGP + la distribution.
