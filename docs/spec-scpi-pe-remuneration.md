# Spec — Modèle minimal SCPI + PE dans le calculateur de rémunération CGP

> **Statut : DÉFRICHAGE — à valider, NON implémenté.** Plan mis de côté le 21/07/2026.
> Aucun code n'a été écrit. Ce document capture le périmètre et le câblage pour une
> reprise ultérieure. Les décisions produit clés sont actées (voir §0) ; les **taux
> par défaut (§2) restent à valider par Mathis** avant tout codage.

## 0. Décisions produit actées (21/07)

1. **Barème** : champs **typés par famille** sur `CabinetContract` (pas de `customFees` générique).
2. **Périmètre** : les **deux** parcours — `/portefeuille/analyser` (relevé déposé) ET `construire` (moteur `buildRemuneration` partagé).
3. **Sous-type SCPI** : **défaut « classique »** (upfront élevé, récurrent 0) + **toggle CGP par ligne** pour basculer en « sans frais ».

## 1. Contexte & problème

Le calculateur de rému cabinet (`lib/remuneration.ts` / `buildRemuneration`, affiché par
`RemunerationSummary` sur `/portefeuille/analyser` et `construire`) est **AV-only** : chaque
ligne ne porte qu'une rétro **récurrente**, et le seul flux **ponctuel** est `entryOnce`
(frais d'entrée du contrat, niveau portefeuille). Dès qu'un client détient de la SCPI ou du
PE, le « revenu cabinet » affiché est **incomplet** (commission de souscription ignorée).

Le référentiel de place (doc de travail « Frais & rétrocessions du CGP français », inspiré
Sendraise) pousse à en faire un **calculateur de revenu**, pas un calculateur AV : « un
calculateur mono-assurance rate les deux tiers du sujet économique du cabinet ».

**Contrainte données** : les familles sont classées en base (`investissement_funds.product_type` :
434 scpi, 3860 fpci, 430 fcpr, 355 fip, 335 fcpi, 73 opci) MAIS leurs frais spécifiques y sont
quasi absents (2/434 SCPI ont un frais d'entrée). → Le modèle repose sur des **défauts de place
par famille + saisie/surcharge CGP**, pas sur la base.

## 2. Taux par défaut (À VALIDER)

| Famille | Upfront (rétro CGP) | Récurrent (rétro CGP) | Source référentiel |
|---|---|---|---|
| SCPI classique | **5 %** du souscrit | **0** | rétro CGP 3-7 % du souscrit ; récurrent nul |
| SCPI sans frais (toggle) | **1 %** | **0,5 %/an** | upfront 0-2 % ; récurrent 0,3-0,7 %/an |
| PE (fcpr/fpci/fcpi/fip) | **3 %** de l'engagement | **0,7 %/an** | upfront ~½ des droits (2-5 %) ; récurrent 0,5-0,9 %/an |
| OPCI | comme SCPI classique | — | à confirmer |

## 3. État actuel du câblage (vérifié, `fichier:ligne`)

| Élément | Où | État |
|---|---|---|
| Moteur rému | `lib/remuneration.ts:137` `buildRemuneration` | Récurrent par ligne + `entryOnce` unique (contrat). Aucun one-shot par ligne. |
| One-shot actuel | `lib/remuneration.ts:200` | `entryOnce = convention.entryFeeShare × totalAmount` |
| `RemuHolding` | `lib/remuneration.ts:68` | `{ isin, name, amount, terFrac, retroFallbackFrac }` — **pas de `product_type`** |
| `RemuLine` | `lib/remuneration.ts:124` | `{ isin, name, amount, retroFrac, retroAnnual, sourced }` — pas d'upfront |
| Holdings ANALYSER | `components/existant/AnalyseExistant.tsx:470` | `product_type` consommé en amont (`/api/releve:243`) pour la rétro, **pas propagé** au holding |
| Holdings CONSTRUIRE | `components/portfolio/StudioResults.tsx:236` | issus de `shownLines` (optimiseur) : `ter`, `retrocession` — pas de `product_type` |
| Univers CONSTRUIRE | `lib/sampleUniverse.ts:11` | contient déjà SCPI (Primovie) + PE (Altaroc) |
| Détection famille | `lib/allocationInput.ts:46` `PRODUCT_MAP` | `scpi/opci→immobilier`, `fcpr/private_equity→alternatif` |
| Affichage | `components/portfolio/RemunerationSummary.tsx:46-98` | KPI (récurrent, taux rétro, CTD, part captée) + tableau (Support/Montant/Rétro/Rému/an) |
| Barème | `lib/cabinet.ts:33` `CabinetContract` | `customFees:{label,rate}` = mort ; `eurosRetroShare` etc. typés |
| Repli ETF-aware | `lib/remuneration.ts:37` `estimateRetroFrac` / `:55` `retroFallbackFrac` | ETF/passif → rétro 0 (principe à répliquer : SCPI classique → récurrent 0) |

## 4. Changement proposé

### 4.1 Données — barème (`lib/cabinet.ts`)
Ajouter à `CabinetContract` 4 champs typés (fractions, `null` = défaut de place) :
```ts
scpiUpfrontShare: number | null;   // rétro CGP one-shot sur souscription SCPI (frac. du souscrit)
scpiRecurringShare: number | null; // rétro CGP récurrente SCPI (frac./an) — surtout SCPI sans frais
peUpfrontShare: number | null;     // rétro CGP one-shot sur engagement PE
peRecurringShare: number | null;   // rétro CGP récurrente PE (frac./an)
```
`customFees` reste en place (legacy, non touché — retrait = hors périmètre). Mettre à jour
`emptyContract`, `normalizeContract`, `hasAnyConvention`. Carte de saisie dans `CabinetForm`.

### 4.2 Défauts de place (`lib/remuneration.ts`, table en dur — cf §2)

### 4.3 Détection famille (`lib/remuneration.ts`, nouveau helper)
```ts
function assetFamily(productType): 'scpi' | 'pe' | null
// scpi, opci → 'scpi' ; fcpr, fpci, fcpi, fip, private_equity → 'pe' ; sinon null
```

### 4.4 Moteur (`lib/remuneration.ts`)
- `RemuHolding` gagne `productType: string | null` + `scpiNoFee?: boolean` (toggle, défaut `false`).
- `RemuLine` gagne `upfrontOnce: number`.
- `Remuneration` gagne `upfrontPerLineTotal: number` ; `revenuPonctuelTotal += upfrontPerLineTotal`.
- Par ligne, si `assetFamily != null` :
  - `upfrontFrac = conventionRate ?? défaut(famille, sous-profil)` → `upfrontOnce = upfrontFrac × amount`
  - `recurringFrac = conventionRate ?? défaut` (SCPI classique → 0) → `retroAnnual = recurringFrac × amount`
  - la cascade AV (`resolveFundRetrocession`) ne s'applique **pas** aux lignes SCPI/PE (anti double-compte).
  - si `family = null` : comportement actuel **strictement inchangé**.

### 4.5 Câblage des holdings
- ANALYSER (`AnalyseExistant.tsx:470`) : propager `product_type` (déjà renvoyé par `/api/releve`, à
  exposer dans `ReleveApiPosition`) dans le `RemuHolding`.
- CONSTRUIRE (`StudioResults.tsx:236`) : propager `product_type` depuis `shownLines`
  (à faire remonter par l'optimiseur/univers).

### 4.6 UI (`RemunerationSummary.tsx`)
- Tableau par ligne : nouvelle colonne **« Commission souscription »** (`upfrontOnce` pour SCPI/PE,
  « — » sinon) + toggle « sans frais » sur les lignes SCPI.
- Synthèse ponctuelle : inclure `upfrontPerLineTotal` dans le « revenu ponctuel ».

## 5. Critères d'acceptation
1. SCPI classique 50 000 € (aucune convention) → `upfrontOnce = 2 500 €` (5 %), `retroAnnual = 0 €`.
2. SCPI togglée « sans frais » 50 000 € → `upfrontOnce = 500 €` (1 %), `retroAnnual = 250 €/an` (0,5 %).
3. PE 100 000 € → `upfrontOnce = 3 000 €` (3 %), `retroAnnual = 700 €/an` (0,7 %).
4. Convention `scpiUpfrontShare = 0,06` **surcharge** le défaut → 3 000 € sur 50 000 €.
5. OPCVM/ETF/action → **strictement inchangé** (aucune régression sur les tests frais + rému existants).
6. `revenuPonctuelTotal = entryOnce + Σ upfrontOnce` (identité vérifiée).
7. Les 2 parcours (analyser, construire) affichent le même revenu pour le même portefeuille mixte.
8. `tsc` propre, tests verts.

## 6. Testing plan
| Couche | Quoi | Nb |
|---|---|---|
| Unit | `assetFamily()` mapping | +3 |
| Unit | `buildRemuneration` SCPI classique / sans-frais / PE / override convention / OPCVM non-régression | +5 |
| Unit | `revenuPonctuelTotal` = entryOnce + Σ upfront | +1 |
| Intégration | relevé mixte (OPCVM+SCPI+PE) → RemuHolding avec product_type | +1 |

## 7. Files reference
| Fichier | Changement |
|---|---|
| `lib/cabinet.ts` | +4 champs typés, emptyContract/normalize/hasAnyConvention |
| `lib/remuneration.ts` | défauts, `assetFamily`, `RemuHolding.productType/scpiNoFee`, `RemuLine.upfrontOnce`, `Remuneration.upfrontPerLineTotal`, logique par ligne |
| `lib/releve.ts` + `api/releve/route.ts` | exposer `product_type` dans `ReleveApiPosition` |
| `components/existant/AnalyseExistant.tsx:470` | propager product_type + toggle SCPI |
| `components/portfolio/StudioResults.tsx:236` | propager product_type |
| `components/portfolio/RemunerationSummary.tsx` | colonne commission souscription + toggle + synthèse |
| `components/cabinet/CabinetForm.tsx` | saisie SCPI/PE |
| `test/remuneration.test.ts` | régressions |

## 8. Hors périmètre (v1)
PE engagé vs appelé (engagé = montant) ; démembrement SCPI ; grilles dégressives ; retrait de
`customFees` ; le simulateur AV (`feeSimulator.ts`) reste AV — au mieux un flag « SCPI non
modélisée ici » si déposée dans `/simulateur` (note, pas codé v1) ; agrégation multi-clients
(déjà abandonnée, cf. décision no-accounts).

## 9. Rollback & risques
- Champs additifs, moteur pur testé. Rollback = revert du commit (aucune migration DB ; barème
  localStorage rétro-compatible via `normalizeContract`).
- **Risque n°1** : inventer du récurrent sur une SCPI classique (elle n'en verse pas) — même
  piège que les ETF, traité par le défaut « récurrent 0 ».
- **Risque n°2** : le vide de données — le CGP doit saisir/valider ses taux ; d'où les défauts de
  place pré-remplis et honnêtes.

## 10. Effort
~1 chantier : 2h barème+form · 3h moteur+défauts · 2h câblage holdings (2 parcours) · 2h UI ·
2h tests. **~11h humain / ~30-45 min CC.**

## 11. À trancher avant implémentation
1. Les **taux par défaut** du §2 (5 % / 1 %+0,5 % / 3 %+0,7 %).
2. OPCI = SCPI classique, ou profil propre ?
3. Faut-il un flag visuel « SCPI non modélisée » dans le simulateur AV, ou on l'ignore en v1 ?
