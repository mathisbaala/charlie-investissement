# Spec — Onglet « Analyse de l'existant » (import de relevés + moteur de recommandations)

> Statut : **backlog, prêt à chiffrer** — rédigé le 2026-07-16.
> Inspiration : Addepar « Alts Data Management » (ingestion de documents) +
> philosophie conseil (diagnostics ciblés, PAS de refonte globale).
> Prérequis déjà en place : référencement UC↔contrat (861 contrats, 56 assureurs,
> ~380k liens — cf. `docs/av-referencing.md`) et briques analytiques du moteur
> d'allocation (`app/src/lib/{optimizer,correlation,lookthrough,allocationRationale}.ts`,
> RPC `inv_portfolio_analyze`, `inv_fund_correlation`).

## 1. Problème

Quand un client arrive chez un CGP, son patrimoine existant (AV, PER, capi,
PEA) doit être ressaisi ligne à ligne pour être analysé. C'est long, source
d'erreurs, et en pratique rarement fait : le conseiller travaille sur la
collecte nouvelle et n'objective jamais l'existant. Or l'information est déjà
dans un document normalisé que le client possède : le **relevé de situation**
annuel de chaque assureur (nom du contrat + tableau des positions avec ISIN,
parts, valeurs).

## 2. Vision produit

Un onglet **« Analyse de l'existant »** :

1. Le CGP dépose en vrac les PDF des relevés du client (multi-contrats,
   multi-assureurs).
2. Charlie extrait les positions, reconnaît chaque contrat, et assemble le
   patrimoine consolidé.
3. L'outil produit la **même synthèse que l'onglet allocation** (répartitions
   géo/secteur/classe via look-through, risque, frais) **plus** ce que seul
   l'existant permet : frais réels payés, doublons inter-contrats, exposition
   consolidée.
4. Un volet **« Recommandations »** liste des conseils CIBLÉS, chacun illustré
   et actionnable — jamais une réallocation globale (§5).
5. Restitution : compte rendu PDF client aux couleurs du cabinet (réutilise la
   chaîne PDF existante).

## 3. Parcours V1 (périmètre proposé)

- **Import** : dépôt de 1..n PDF. Extraction texte (`pdftotext -layout`,
  repli pdfplumber ; OCR hors V1 — les scans sont rejetés avec message clair).
- **Extraction des positions** : par INVARIANTS, pas par mise en page (leçon
  du scraper Utmost) — regex ISIN + clé Luhn (réutiliser `_av_pdf_common`
  côté pipeline si besoin d'un pré-traitement serveur, sinon port TS), montant/
  parts capturés sur la même ligne, libellé en best-effort.
- **Reconnaissance du contrat** : détection assureur+contrat dans l'en-tête du
  relevé, puis **validation croisée par le référencement** : les ISIN extraits
  doivent appartenir majoritairement à l'univers du contrat détecté
  (`investissement_av_lux_eligibility`). Score de couverture affiché ; en
  dessous d'un seuil → le CGP choisit le contrat dans une liste (les 861).
- **Lignes sans ISIN** : fonds euros (rattachement via le catalogue `FE_*` par
  assureur/contrat), fonds internes dédiés → ligne « non analysable » conservée
  dans les totaux mais exclue des diagnostics.
- **Écran de validation** : tableau des lignes reconnues/ambiguës/rejetées,
  édition manuelle, puis validation → création du portefeuille consolidé.
- **Assureurs V1** (formats de relevés à couvrir en premier, par poids CGP) :
  Cardif, Predica/CA, SwissLife, Suravenir, Spirica. Les autres passent par la
  saisie assistée (autocomplete ISIN existant).
- **RGPD** : traitement éphémère du PDF (jamais stocké), seules les positions
  validées sont conservées.

## 4. Synthèse consolidée (réutilisation directe)

Tout existe déjà, appelé sur le portefeuille consolidé multi-contrats :

| Élément | Brique existante |
|---|---|
| Répartition classe/géo/secteur (look-through) | `weightedExposure`, `topSlices` |
| Ratios portefeuille (perf annualisée, volatilité, Sharpe, max drawdown) + courbe historique vs benchmark | RPC `inv_portfolio_analyze` (+ benchmark ratios) |
| Frais moyens pondérés des UC | `weightedTer` |
| Frais du contrat + rétrocessions par UC | données référencement (Doc_Perf/annexes : taux collectés pour CAAR, Conservateur, Sogécap…) + `av_contract_terms` |
| Profil de risque effectif | `sriDistribution`, `profileFromSri` |
| Durabilité | `sfdrDistribution` |

## 5. Le moteur de recommandations (cœur de la spec)

**Principe directeur (décision produit)** : le portefeuille existant a été
construit pour des raisons qui appartiennent au client et à son histoire — on
ne le refait PAS passer par l'optimiseur pour tout remplacer. Chaque brique
analytique du moteur d'allocation est retournée en **diagnostic** :
constat chiffré → illustration → recommandation minimale → impact estimé.
Les recommandations sont triées par impact, limitées (max ~5 affichées), et
chaque suggestion de remplacement est **contrainte à l'univers référencé du
même contrat** (pas de « achetez X » si X n'est pas disponible dans le
contrat — c'est le différenciant permis par le mapping).

| # | Diagnostic | Brique réutilisée | Seuil de déclenchement (à calibrer) | Illustration | Recommandation type |
|---|---|---|---|---|---|
| R1 | **Fonds sur-corrélés** | `inv_fund_correlation(_robust)`, `averagePairwiseCorrelation`, `buildCorrelationMatrix` | paire > 0,90 ou moyenne > 0,75 | **matrice de corrélation** (heatmap) avec paires en rouge | « Ces 3 fonds évoluent quasi à l'identique — en remplacer un par [2-3 candidats décorrélés éligibles au contrat] » |
| R2 | **Doublons de sous-jacents** | `findOverlaps` (holdings look-through) | même sous-jacent > X % via ≥ 2 lignes | barres des recouvrements | « Apple pèse 9 % via 3 fonds différents — redondance sans diversification » |
| R3 | **Concentration géo/sectorielle** | `weightedExposure` vs bornes du profil | zone > 60 %, secteur > 35 % | camembert avec la tranche en surbrillance | « 68 % US consolidé — voici des candidats Europe/EM éligibles » |
| R4 | **Lignes chères à alternative comparable** | `weightedTer` + TER par ligne + rétrocessions ; `selectionScore` pour les candidats | TER ligne > médiane catégorie + 0,5 pt ET alternative dans le contrat | tableau frais actuels vs alternative, coût cumulé 10 ans en € | « Ce fonds actions monde à 2,1 % a un équivalent à 0,4 % dans le même contrat — ~X € économisés sur 10 ans » |
| R5 | **Sous-performance persistante vs indice** | alpha/benchmark_perf (td-enricher) + `inv_portfolio_analyze` benchmark | alpha < 0 sur 3 ans ET 5 ans | courbe fonds vs indice | « Sous-performance durable de son indice — alternative indicielle éligible » |
| R6 | **Inadéquation au profil de risque** | `sriDistribution` vs profil client (si renseigné) | SRI pondéré ≷ profil ± 1 | jauge SRI portefeuille vs cible | « Portefeuille SRI 5 pour un profil équilibré (3-4) — pistes de dérisquage partiel » |
| R7 | **Trou de diversification structurelle** | `diversifiedScore`, `GEO_COVER_BONUS`, classes présentes | classe absente vs allocation type du profil | damier classes présentes/absentes | « Aucune poche obligataire/immobilière — candidats éligibles » |
| R8 | **Poche fonds euros** | part fonds euros + taux servis (catalogue FE) | < plancher ou > plafond selon profil | historique des taux servis du fonds euros du contrat | « 85 % fonds euros à 2,1 % pour un horizon 15 ans — coût d'opportunité chiffré » |
| R9 | **Risque portefeuille** | volatilité/max drawdown/Sharpe (RPC analyze) | drawdown historique > seuil du profil | courbe drawdown | pédagogie + renvoi vers R1/R3/R6 |
| R10 | **Frais du contrat lui-même** | `av_contract_terms` + comparaison marché | frais gestion contrat > médiane + 0,3 pt | positionnement vs distribution marché | « Le contrat est cher en soi — les arbitrages internes ne suffiront pas, envisager un transfert (PER) / nouveau contrat » |

**Format d'une recommandation (uniforme)** : titre, constat chiffré, pourquoi
c'est un problème (1 phrase pédagogique — réutiliser le ton de
`fundRationale`/`roleSentence`), illustration, 2-3 candidats de remplacement
*éligibles au contrat* (avec leur delta frais/corrélation), bouton « voir dans
le screener ». Le CGP coche celles qu'il retient → elles s'insèrent dans le
compte rendu PDF.

**Passerelle allocation (secondaire)** : un bouton discret « simuler une
réallocation complète » envoie vers le studio pré-rempli — mais ce n'est PAS
le chemin principal ; le chemin principal est la liste de conseils.

## 6. Hors périmètre V1

- OCR des relevés scannés (V2 ; rejet propre en V1).
- Import automatique récurrent (connexions extranet assureurs) — V3+.
- Multi-clients / suivi dans le temps des recommandations acceptées.
- Comptes-titres/PEA bancaires (relevés courtiers — formats très différents).
- Recommandation fiscale (transfert Fourgous, PER individuel vs assurance…) —
  on chiffre le coût, on ne conseille pas fiscalement.

## 7. Risques & parades

| Risque | Parade |
|---|---|
| Hétérogénéité/évolution des formats de relevés | extraction par invariants ISIN, pas par layout ; couverture par assureur testée sur corpus réel ; taux de reconnaissance affiché |
| Contrat absent du référencement | fallback saisie assistée + le trou alimente le backlog scraping (le référencement couvre déjà ~99 % des contrats ≥ 100 UC, cf. sweep) |
| Recommandations perçues comme « boîte noire » | chaque conseil = constat chiffré + illustration + seuils documentés ; jamais de score opaque |
| Effet « tout rouge » anxiogène | max ~5 recommandations triées par impact ; seuils conservateurs |
| Conformité (conseil en investissement) | formulation « pistes à étudier », validation humaine obligatoire, traçabilité des seuils dans le PDF |

## 8. Métriques de succès

- ≥ 90 % des lignes reconnues automatiquement sur le corpus V1 (5 assureurs).
- Temps « dépôt PDF → synthèse » < 2 min.
- ≥ 1 recommandation retenue par le CGP dans > 50 % des analyses.
- Le compte rendu PDF « existant » devient le 2ᵉ document le plus généré.
