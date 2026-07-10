# Moteur d'allocation optimisée (max-Sharpe par contrat)

> Outil : proposer, parmi les fonds **disponibles dans un contrat**, une allocation
> de **4 à 7 supports** offrant le meilleur compromis risque/performance
> (ratio de Sharpe maximal), avec une **répartition cible par classe d'actifs**
> (ex. 60 % actions / 30 % obligations / 10 % crypto), puis **générer une
> présentation** prête à montrer au client. 100 % déterministe — **aucune API
> payante / aucun LLM** dans la chaîne.

## Chaîne de traitement

```
contrat  ──▶ investissement_funds_cgp_ref (fonds du contrat, share-class primaire)
         ──▶ toFundInputs()        mappe classe d'actifs + annualise perfs → fractions
         ──▶ shortlist()           borne les candidats (coût corrélation O(n²))
         ──▶ inv_fund_correlation  RPC SQL dédiée : corrélation hebdo LOCF (fund_prices)
         ──▶ optimizeAllocation()  sélection 4–7 + poids max-Sharpe sous contraintes
         ──▶ buildPresentation()   restitution (objectifs, rôles, justif. par fonds…)
```

API : `GET /api/portfolio/optimize`
- `contract` (requis) : clé « Assureur::Contrat » (cf. `get_contracts_list`).
- `targets` : `actions:60,obligations:30,crypto:10` (répartition cible ; sinon libre).
- `min` / `max` : bornes de cardinalité (défaut 4 / 7).
- `maxSri` : SRI moyen pondéré plafond ; `rf` : taux sans risque en % (défaut 2) ;
  `years` : fenêtre de corrélation (défaut 3) ; `must` : ISIN à inclure d'office ;
  `advisor`, `asOf` : en-tête de la restitution.

Réponse : `{ allocation, presentation, meta }`.

## Modèle : moyenne-variance / max-Sharpe

Choisi car c'est le modèle classique **exploitant le plus de paramètres** demandés :
performances (rendement attendu), volatilité, **corrélation** (covariance), SRI,
diversification.

- **Rendement attendu** μ : perf annualisée (3 A prioritaire, repli 5 A puis 1 A).
- **Risque** : Σ = D·C·D où D = diag(volatilités), C = matrice de corrélation
  (`inv_fund_correlation` / `app/src/lib/correlation.ts`, coefficients identiques).
- **Objectif** : max `S(w) = (μᵀw − rᶠ) / √(wᵀΣw)` (Sharpe), montée de gradient
  projetée, départ déterministe, meilleur point réalisable conservé.
- **Contraintes** : `w ≥ 0`, plafond par fonds, et **somme par classe = cible**
  (répartition imposée). Cardinalité 4–7 gérée à la sélection.
- **Diversification** : nombre effectif de lignes (Herfindahl inverse) +
  corrélation moyenne des paires, remontés dans le résultat.

Garde-fous : classe cible sans fonds → poids redistribué ; plafond par fonds
relevé si une classe a trop peu de supports pour atteindre sa cible ;
dépassement du SRI plafond signalé (note non bloquante).

## Fichiers

| Fichier | Rôle | Tests |
|---|---|---|
| `app/src/lib/correlation.ts` | Corrélation/covariance (fonction dédiée) | `src/test/correlation.test.ts` |
| `app/src/lib/optimizer.ts` | Sélection + max-Sharpe sous contraintes | `src/test/optimizer.test.ts` |
| `app/src/lib/allocationInput.ts` | Ligne DB → `FundInput` (unités, classes) | `src/test/allocationInput.test.ts` |
| `app/src/lib/allocationRationale.ts` | Restitution (objectifs, justif., SRI/SFDR) | `src/test/allocationRationale.test.ts` |
| `app/src/lib/allocationService.ts` | Chaîne DB→optim→restitution partagée (JSON+PDF) | `src/test/allocationService.test.ts` |
| `app/src/lib/AllocationReportPDF.tsx` | Export PDF « présentation client » (react-pdf) | `src/test/allocationReportPdf.test.ts` |
| `app/src/components/portfolio/AllocationReport.tsx` | Restitution à l'écran | `src/test/AllocationReport.component.test.tsx` |
| `app/src/app/api/portfolio/optimize/route.ts` | Route API JSON | — |
| `app/src/app/api/portfolio/optimize/pdf/route.ts` | Route API export PDF | — |
| `supabase/migrations/20260710130000_inv_fund_correlation.sql` | RPC corrélation | — |

Tests : `cd app && npm test` (91 tests dédiés ; 446 au total, verts).
Aperçu du PDF : `PDF_DUMP=1 npx vitest run src/test/allocationReportPdf.test.ts` → `/tmp/allocation-charlie.pdf`.

## Restitution (calquée sur le modèle Métagram / Cardif ELITE)

`buildPresentation()` renvoie une structure directement rendable :
contexte & objectifs · répartition par classe (poids + rôle) · tableau détaillé
(# / fonds / ISIN / catégorie / poids / SRI / SFDR / TER) · **justification par
support** (pourquoi retenu, rôle, justification du poids) · profil de risque
(histogramme SRI pondéré + répartition SFDR) · convictions (piliers) ·
avertissements MIF II.

## Restitution

Deux sorties, un seul chemin de vérité (`allocationService`) :
- **À l'écran** : `<AllocationReport presentation={…} pdfHref={…} />` — en-tête + KPI,
  objectifs, répartition par classe, tableau détaillé, profil SRI/SFDR, justification
  par support, convictions, avertissements.
- **PDF** : `GET /api/portfolio/optimize/pdf?contract=…&targets=…` — document 3 pages
  au format « proposition client » (design system PDF partagé).

## Reste à faire (hors périmètre)

- **Page conteneur** : onglet interactif (sélecteur de contrat + curseurs de cibles)
  qui appelle `/api/portfolio/optimize` et monte `<AllocationReport>`. Non écrit ici
  car non vérifiable sans build applicatif réel (fetch + état client).
- **Export PPTX/DOCX** natif au format Métagram (le PDF couvre déjà le besoin
  « présentation » ; PPTX/DOCX = confort, dépendances supplémentaires).
- **Appliquer la migration** (`inv_fund_correlation`) via la CI/PR — secrets Supabase.
