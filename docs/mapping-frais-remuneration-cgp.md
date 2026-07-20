# Mapping frais & rémunération CGP — le portefeuille comme unité de traçabilité

> Référentiel produit pour le chantier **Frais** de Charlie Investissement.
> Objet : donner une vue exhaustive et opérationnelle de **ce qui coûte au client**
> et de **ce que gagne le cabinet (CGP)** sur un portefeuille donné, pour que l'app
> puisse, à partir d'un portefeuille déposé, déduire le coût client **et** la
> rémunération CGP, et en tirer des métriques de rentabilité par client / par
> portefeuille / par cabinet.
>
> Complément du doc canonique [`mapping-assureurs-contrats-cgp.md`](./mapping-assureurs-contrats-cgp.md)
> (qui décrit assureurs, contrats, plateformes). Ici on décrit **la mécanique des frais
> et de la rémunération**, pas le catalogue. Version 1.

---

## 1. Vision & positionnement

### 1.1 L'idée

Le CGP dépose un portefeuille — **existant** (relevé de situation d'un client déjà
équipé) ou **construit** (allocation qu'il vient de bâtir dans l'app). À partir de là,
l'app calcule deux choses en miroir :

1. **Côté client** — combien ce portefeuille lui coûte, tous frais confondus, ventilés
   par bénéficiaire (assureur, société de gestion, plateforme, cabinet) et projetés
   dans le temps (coût annuel, coût total de détention, effet de compoundage des frais
   sur la performance).
2. **Côté cabinet** — combien ce portefeuille **rapporte au CGP** : la rémunération
   ponctuelle (upfront / commission de souscription) et la rémunération récurrente
   (rétrocessions sur encours), par support et agrégée, avec projection pluriannuelle.

L'unité de compte du produit, c'est **le portefeuille** (rattaché à un client, à un
contrat, à un assureur). C'est là que se joue la traçabilité : « ce client / ce
portefeuille me rapporte X € par an, dont Y récurrent et Z ponctuel ».

### 1.2 Ex-ante (nous) vs ex-post (Sendraise)

[Sendraise](https://sendraise.eu) est la référence à connaître sur ce terrain. Sa
proposition : **agréger les bordereaux de commissions réellement reçus** des partenaires
(assureurs, plateformes, SCPI, PE), les standardiser malgré l'hétérogénéité des formats,
et produire des études — bilan de performance du cabinet, audit & réclamations
(« mes partenaires me versent-ils ce qu'ils me doivent ? »), valorisation M&A. C'est un
**service** (analystes + techno ACE), pas un logiciel : rétrospectif, basé sur le réel
encaissé, orienté détection d'anomalies et pilotage de la rentabilité déjà acquise.

Notre angle est **complémentaire et opposé dans le temps** :

| | Sendraise (ex-post) | Charlie / chantier Frais (ex-ante) |
|---|---|---|
| Donnée d'entrée | Bordereaux reçus (ce qui a été payé) | Portefeuille (positions + contrat) |
| Nature | Rétrospectif, réel encaissé | Prospectif, modélisé/déterministe |
| Question | « Qu'est-ce que j'ai touché, est-ce juste ? » | « Qu'est-ce que ce portefeuille va me rapporter, et combien il coûte au client ? » |
| Moment d'usage | Après coup (mensuel/trimestriel) | Au moment du conseil / de la construction |
| Livrable | Étude, audit, réclamation | Simulation coût client + rému CGP, aide à la décision |

Ce que Sendraise nous apprend, à reprendre :
- **Le CGP raisonne « toutes sources de revenus consolidées »** : AV, capi, PER, CTO/PEA,
  SCPI, Private Equity, **honoraires** de conseil. Pas seulement l'AV.
- **La rémunération a deux natures** qui ne se pilotent pas pareil : le **stock**
  (rétrocessions sur encours, récurrent, ce qui valorise le cabinet) et le **flux**
  (upfronts / souscriptions, ponctuel).
- **Le taux de rétro moyen** (rému / encours) est une métrique de pilotage clé.
- **Le vocabulaire métier réel** des lignes de commission (voir §3.3) : frais de gestion,
  souscription, rachat partiel, versements libres, surcommissions, arbitrages, frais de
  garde, arrérages, dividendes SCPI, frais de mandat, upfronts, reprises, détachements de
  coupons, rétrocessions OPCVM, avances trimestrielles…
- **La finalité pilotage** : rentabilité par client / par conseiller, exposition par
  partenaire, concentration, valorisation du cabinet.

Un jour l'app pourra faire les deux (réconcilier le modélisé ex-ante avec le réel des
bordereaux ex-post → détection d'écarts, comme Sendraise). Pour l'instant, on construit
le socle ex-ante.

---

## 2. La chaîne de valeur des frais : qui prélève quoi, qui reverse à qui

Sur une unité de compte logée dans un contrat d'assurance-vie, **quatre acteurs** se
partagent les frais. Comprendre ce schéma, c'est comprendre tout le reste.

```
                 CLIENT (paie tous les frais, in fine)
                          │
        ┌─────────────────┼──────────────────────────────┐
        │                 │                               │
   ┌────▼─────┐    ┌───────▼────────┐             ┌────────▼────────┐
   │ ASSUREUR │    │ SOCIÉTÉ DE      │             │  PLATEFORME /   │
   │ (contrat)│    │ GESTION (fonds) │             │  GROSSISTE      │
   └────┬─────┘    └───────┬────────┘             └────────┬────────┘
        │                  │                               │
        │ frais de gestion │ frais courants (TER)          │ marge d'inter-
        │ du contrat (UC   │ = frais de gestion            │ médiation (prise
        │ + fonds euros),  │ financière + admin            │ sur les frais de
        │ frais d'entrée,  │ + éventuelle commission       │ gestion contrat)
        │ arbitrage        │ de surperformance             │
        │                  │                               │
        └──── rétrocèdent une part ────►  CGP / CABINET  ◄──┘
                                          (+ honoraires facturés en direct)
```

**Point capital.** Le CGP ne « facture » quasiment jamais ses frais au client
directement (sauf honoraires). Il est rémunéré par **rétrocession** : l'assureur, la
société de gestion et/ou la plateforme lui reversent une **part des frais déjà prélevés
sur le client**. Donc :

- Le client paie un total de frais (le **coût client**).
- Une fraction de ce total « redescend » vers le CGP (la **rému CGP**).
- Le reste est conservé par l'assureur / la société de gestion / la plateforme.

Deux corollaires pour le produit :
1. La rému CGP est **toujours un sous-ensemble du coût client**. On ne peut jamais
   rétrocéder plus que ce qui a été prélevé. (Le simulateur actuel respecte déjà ça :
   la commission upfront est bornée aux frais d'entrée, la rétro est une tranche du TER.)
2. Pour être juste, il faut modéliser **d'où sort chaque euro de rému** : d'un frais
   d'entrée (flux) ou d'un frais de gestion récurrent (stock).

---

## 3. Taxonomie des frais — côté CLIENT (ce que ça coûte)

Sept familles de frais. Pour chacune : l'assiette, qui la prélève, l'ordre de grandeur,
et si elle génère (ou non) de la rému CGP.

### 3.1 Frais d'entrée / droits d'entrée / frais sur versement

| Attribut | Détail |
|---|---|
| **Assiette** | % du versement (à chaque versement, libre ou programmé) |
| **Deux étages** | (a) droits d'entrée du **contrat** (assureur) ; (b) frais d'entrée de l'**UC** (rare en AV, courant en direct/SCPI) |
| **Ordre de grandeur** | Contrat : 0 à 5 % (souvent négocié à 0-3 %). SCPI : 8-12 % (« commission de souscription »). PE : 3-5 % |
| **Nature** | **Flux** (ponctuel, à la souscription/au versement) |
| **Rému CGP** | **Oui** — c'est la principale source d'**upfront** / commission de souscription. Souvent l'essentiel des droits d'entrée redescend au CGP |

### 3.2 Frais de gestion du contrat (assureur)

| Attribut | Détail |
|---|---|
| **Assiette** | % annuel de l'encours, prélevé par l'assureur |
| **Deux compartiments** | (a) frais de gestion sur **UC** (~0,50 à 0,90 %/an) ; (b) frais de gestion sur **fonds euros** (~0,60 à 0,85 %/an, déjà nets dans le taux servi) |
| **Ordre de grandeur** | UC : 0,50-0,90 %/an selon contrat/plateforme |
| **Nature** | **Stock** (récurrent, prélevé chaque année sur l'encours) |
| **Rému CGP** | **Oui, en partie** — une fraction des frais de gestion UC est rétrocédée au CGP (part « distribution »). C'est une des deux briques du récurrent |

### 3.3 Frais courants de l'UC / du fonds (société de gestion) — le TER

| Attribut | Détail |
|---|---|
| **Assiette** | % annuel de l'encours investi dans le fonds, **déjà déduit de la VL** (jamais prélevé « en plus ») |
| **Composition** | frais de gestion financière + frais administratifs + (parfois) commission de mouvement. Mesuré par le **TER** / **ongoing charges** (PRIIPs) |
| **Ordre de grandeur** | ETF : 0,05-0,40 %. OPCVM actions : 1,5-2,5 %. Fonds euros : 0 (le TER est dans le taux servi) |
| **Nature** | **Stock** (récurrent) |
| **Rému CGP** | **Oui, en partie** — la **rétrocession OPCVM** (« trailer fee ») : la société de gestion reverse une part de ses frais de gestion au distributeur. Typiquement ~50 % de la part « commercialisation » du TER, soit ~0,3 à 1,0 %/an pour un OPCVM actif. **Nulle pour un ETF / part clean share** (pas de rétro) |

> ⚠️ Le TER est **déjà dans la VL** : ne jamais le rajouter au coût. Le simulateur actuel
> reconstruit le brut par `r_brut = r_net / (1 − TER)` — convention correcte à conserver.

### 3.4 Frais d'arbitrage

| Attribut | Détail |
|---|---|
| **Assiette** | par arbitrage : % du montant arbitré ou forfait |
| **Ordre de grandeur** | 0 à ~1 % (souvent **gratuit en ligne / illimité** sur les contrats modernes) |
| **Nature** | **Flux** (à l'acte) |
| **Rému CGP** | Variable / marginal ; parfois partagé. À modéliser en option, pas prioritaire |

### 3.5 Frais de gestion sous mandat / gestion pilotée

| Attribut | Détail |
|---|---|
| **Assiette** | % annuel supplémentaire quand le client délègue la gestion |
| **Ordre de grandeur** | +0,20 à +0,90 %/an au-dessus des frais du contrat |
| **Nature** | **Stock** |
| **Rému CGP** | **Oui** — les **frais de mandat** peuvent être une source de rému propre au cabinet (surtout si le CGP est lui-même la société de gestion sous mandat ou co-construit l'allocation) |

### 3.6 Commission de surperformance (performance fee)

| Attribut | Détail |
|---|---|
| **Assiette** | % de la surperformance du fonds au-delà d'un indice/high-water mark |
| **Ordre de grandeur** | 10-20 % de la surperf (souvent avec high-water mark) |
| **Nature** | **Stock conditionnel** (seulement si surperf) |
| **Rému CGP** | Généralement non rétrocédée. À afficher côté coût client, pas côté rému |

### 3.7 Frais de sortie / rachat

| Attribut | Détail |
|---|---|
| **Assiette** | % du montant racheté |
| **Ordre de grandeur** | 0 en AV moderne. SCPI : décote/frais implicites au rachat. PE : quasi-illiquide |
| **Nature** | **Flux** (à la sortie) |
| **Rému CGP** | Rare. À modéliser en option |

### Récap : stock vs flux (la distinction qui structure tout)

| Type de frais | Stock / Flux | Génère rému CGP ? | Brique de rému |
|---|---|---|---|
| Frais d'entrée contrat | Flux | Oui (majeur) | **Upfront** |
| Frais d'entrée UC / souscription SCPI-PE | Flux | Oui (majeur) | **Upfront** |
| Frais de gestion contrat (UC) | Stock | Oui (partiel) | **Rétro sur encours** |
| Frais courants du fonds (TER) | Stock | Oui si part « retail » / non-ETF | **Rétro OPCVM** |
| Frais de mandat / gestion pilotée | Stock | Oui | **Rétro / honoraire mandat** |
| Frais d'arbitrage | Flux | Marginal | — |
| Commission de surperformance | Stock cond. | Non | — |
| Frais de sortie | Flux | Rare | — |

---

## 4. Taxonomie de la rémunération — côté CABINET (ce que ça rapporte)

Ce que gagne le CGP se range en **trois natures**, plus les honoraires.

### 4.1 Upfront / commission de souscription (le flux)

- **Origine** : part des frais d'entrée du contrat + frais de souscription des UC/SCPI/PE.
- **Quand** : à la souscription et à chaque versement.
- **Ordre de grandeur** : AV 0-3 % du versement ; SCPI 8-10 % ; PE 3-5 %.
- **Caractère** : ponctuel, « one-shot ». Fait le chiffre d'affaires immédiat mais **ne
  valorise pas** le cabinet (pas récurrent).

### 4.2 Rétrocessions sur encours (le stock, le « récurrent »)

Deux sous-briques, souvent versées via l'assureur/la plateforme qui centralise :

- **Rétro sur frais de gestion du contrat** : une part des ~0,5-0,9 %/an prélevés par
  l'assureur sur les UC.
- **Rétro OPCVM (trailer fee)** : une part du TER reversée par la société de gestion.
  Nulle sur ETF / clean shares.
- **Ordre de grandeur cumulé** : typiquement **0,3 à 1,0 %/an de l'encours UC**.
- **Caractère** : récurrent, tant que l'encours reste investi. **C'est ce qui valorise
  le cabinet** (un cabinet se vend ~2,5 à 4× son CA récurrent).

### 4.3 Frais de mandat (gestion sous mandat / pilotée)

- Rému propre quand le cabinet gère (ou co-gère) l'allocation. Stock.

### 4.4 Honoraires de conseil (facturés en direct)

- **Hors rétrocession** : facturés directement au client (bilan patrimonial, mission de
  conseil, honoraires au forfait ou au %). Depuis DDA/MIF2 et la tendance « conseil
  indépendant », part croissante et à **consolider avec les rétro** pour la vraie vue du
  CA cabinet (comme le fait Sendraise).

### Ce que le CGP veut voir sur un portefeuille

Pour **un portefeuille donné**, la sortie cible :

```
Portefeuille « M. Durand — Linxea Spirit 2 (Spirica) — 250 000 € »
├── Coût client
│   ├── Frais d'entrée (one-shot) ......... 0 €        (négocié à 0 %)
│   ├── Frais de gestion contrat .......... 1 500 €/an (0,60 %)
│   ├── Frais courants moyens (TER) ....... 2 000 €/an (0,80 % pondéré)
│   ├── Coût total de détention (CTD) ..... 1,40 %/an → 3 500 €/an
│   └── Impact sur la performance (RIY) ... –1,40 pt/an
├── Rémunération cabinet
│   ├── Upfront (souscription) ............ 0 € (droits d'entrée à 0)
│   ├── Rétro sur gestion contrat ......... 750 €/an  (0,30 %)
│   ├── Rétro OPCVM (trailer) ............. 500 €/an  (0,20 % pondéré, ETF exclus)
│   ├── Total récurrent .................. 1 250 €/an (0,50 % de l'encours)
│   └── Projection 5 / 10 / 15 ans ....... 6,4 k / 13,5 k / 21,3 k € (encours composé)
└── Métriques
    ├── Taux de rétro cabinet ............. 0,50 %/an
    ├── Part du coût client captée ........ 36 % (1 250 / 3 500)
    └── Marge nette (après coûts de service) ...
```

---

## 5. Déclinaison par enveloppe / classe d'actifs

La mécanique §2-4 est celle de l'AV. Voici les variantes par enveloppe — utile pour
couvrir « toutes les sources de revenus » comme Sendraise.

| Enveloppe | Frais spécifiques | Rému CGP dominante |
|---|---|---|
| **Assurance-vie (France)** | Entrée + gestion contrat UC/€ + TER + arbitrage | Rétro encours (stock) + upfront |
| **AV Luxembourg** | Idem + frais de dépositaire/banque + ticket élevé | Rétro encours, tickets gros |
| **PER** | Proche AV, frais de gestion + versements | Rétro encours + upfront |
| **Capitalisation** | Idem AV (fiscalité différente) | Rétro encours |
| **CTO / PEA** | Frais de courtage, droits de garde, TER des fonds | Rétro OPCVM (si fonds), courtage (marginal) ; souvent **honoraires** |
| **SCPI** | Commission de souscription 8-12 %, frais de gestion sur loyers | **Upfront élevé** + part sur frais de gestion ; **dividendes/arrérages** |
| **Private Equity** | Frais de souscription 3-5 % + management fee 2 % + carried | Upfront + trailer |
| **Nominatif pur (fonds/actions)** | Frais de gestion, **détachements de coupons/dividendes** | Rétro OPCVM, moins structuré |
| **Honoraires** | Facturation directe | **Honoraire** (hors rétro) |

Vocabulaire des lignes de bordereau (à terme, pour réconcilier) : *frais de gestion,
souscription, rachat partiel/total, versements libres/programmés, surcommissions,
arbitrages (dont programmés), frais de garde, arrérages, dividendes SCPI, frais de
mandat, upfronts, reprises, détachements de coupons, ordres de remplacement,
rétrocessions OPCVM, avances/avances trimestrielles*.

---

## 6. Modèle de données : ce qu'on a, ce qui manque

### 6.1 Déjà en base (voir cartographie code)

- `investissement_funds` : `ter`, `ongoing_charges`, `entry_fee_max`, `exit_fee_max`,
  `performance_fee`, **`retrocession_cgp`** (fraction). → couvre §3.3 et l'assiette de la
  rétro OPCVM.
- `investissement_av_contract_terms` : `frais_entree_pct`, `frais_gestion_uc_pct`,
  `frais_gestion_fonds_euros_pct`, `frais_arbitrage_pct`, + fonds euros, univers, options.
  → couvre §3.1, §3.2, §3.4 au niveau contrat.
- `lib/feeSimulator.ts` : moteur de simulation année/année, deux étages de frais,
  `retroCgp` (tranche du TER) + `commissionUpfront` (tranche des droits d'entrée),
  `repartitionFrais()` (assureur/cabinet/société de gestion), `buildFraisReport()`.
- `lib/av-cost.ts` : **coût total de détention** (CTD) = supports (TER) + contrat.
- `/simulateur` (onglet Frais) : simulateur de rému CGP autonome + export PDF client/cabinet.
- `/portefeuille/analyser` + `/api/releve` : **dépôt d'un portefeuille existant** (relevé
  PDF/Excel/CSV → positions + reconnaissance contrat).

### 6.2 Manques à combler pour la vision « traçabilité par portefeuille »

| Manque | Pourquoi | Piste / état |
|---|---|---|
| **Barème de rému du cabinet** | ~~À créer~~ **FAIT** : `lib/cabinet.ts` (localStorage `charlie_cabinet_settings`) + onglet `/cabinet` `CabinetForm`. Cascade réelle par contrat : `contractFeeShare`, `ucRetroShare`, `entryFeeShare`, `arbitrageFeeShare`, `eurosRetroShare`, `customFees`, `fundOverrides`. Résolveurs `cabinetContract` / `resolveFundRetrocession` | ✅ existant (co-construit avec le chemin « construire ») |
| **Branchement dépôt → moteur de frais** | ~~Le simulateur était autonome~~ **FAIT** : `/portefeuille/analyser` calcule coût client + rému CGP inline via `lib/remuneration.buildRemuneration` (cascade cabinet + repli de place), positions relevé enrichies d'un repli de rétro (`retro`) | ✅ livré 20/07 |
| **Distinction ETF (rétro = 0)** | Un ETF ne rétrocède pas ; la rétro OPCVM ne vise que les parts retail | ✅ `estimateRetroFrac` force `0` sur ETF/passif/indiciel (source unique, partagée avec `estimateRetrocession`) |
| **Frais contrat sourcé pour le CTD** | Le coût client utilise aujourd'hui l'indicatif d'enveloppe (0,8 % AV) faute du vrai `frais_gestion_uc_pct` du contrat reconnu | Résoudre `av_contract_terms.frais_gestion_uc_pct` depuis le contrat reconnu et le passer à `contractTotalCost` (déjà prévu par la signature) |
| **Persistance d'un portefeuille/client** | Tout est éphémère (pas de comptes). Or « métriques par client » suppose de rattacher un portefeuille à un client | Décision produit (projet « no-accounts » — cf. `no-accounts-product-direction`). Piste : stockage **local**/export, pas de compte serveur |
| **Honoraires** | Source de revenu à consolider (Sendraise) | Champ honoraire au forfait/%, saisi par le CGP, additionné à la rému |
| **Agrégation multi-portefeuilles** | Vue cabinet = somme des portefeuilles | Couche d'agrégation, après décision persistance |

---

## 7. Parcours produit cible

```
┌──────────────────────────────────────────────────────────────────────┐
│  1. DÉPÔT DU PORTEFEUILLE                                             │
│     ├─ existant  → /portefeuille/analyser → /api/releve (relevé PDF) │
│     └─ construit → /portefeuille/construire (allocation dans l'app)  │
│              ↓  positions (ISIN + montants/poids) + contrat reconnu   │
├──────────────────────────────────────────────────────────────────────┤
│  2. RÉSOLUTION DU CONTEXTE DE FRAIS                                   │
│     ├─ contrat/assureur → av_contract_terms (frais gestion, entrée)  │
│     ├─ chaque UC        → investissement_funds (TER, retro, type)    │
│     └─ barème cabinet    → cabinet_remuneration_terms (à créer)      │
├──────────────────────────────────────────────────────────────────────┤
│  3. CALCUL (lib/feeSimulator + av-cost)                              │
│     ├─ Coût client : entrée + gestion contrat + TER → CTD, RIY       │
│     ├─ Rému CGP : upfront + rétro gestion + rétro OPCVM (ETF=0)      │
│     └─ Projection 5/10/15 ans (encours composé)                     │
├──────────────────────────────────────────────────────────────────────┤
│  4. RESTITUTION                                                       │
│     ├─ Vue client  : coût, ventilation, impact perf (PDF client)    │
│     ├─ Vue cabinet : rému récurrente + ponctuelle (PDF cabinet)     │
│     └─ Métriques   : taux de rétro, part captée, projection revenus │
├──────────────────────────────────────────────────────────────────────┤
│  5. (V2) PILOTAGE CABINET                                            │
│     └─ Agrégation multi-portefeuilles : CA récurrent, par client,   │
│        par partenaire, concentration, valorisation (façon Sendraise)│
└──────────────────────────────────────────────────────────────────────┘
```

Les étapes 1-4 existent en grande partie (simulateur + analyser). Le travail du chantier
Frais : **fiabiliser le calcul de rému** (barème cabinet, rétro par contrat, ETF=0),
**relier proprement dépôt → calcul** (aujourd'hui le simulateur est autonome), et **poser
les métriques cabinet**.

---

## 8. Métriques cabinet (ce que le CGP veut mesurer)

Par portefeuille, par client, puis agrégées :

| Métrique | Définition | Pourquoi |
|---|---|---|
| **Rému récurrente / an** | Σ rétro encours | Le nerf de la guerre, valorise le cabinet |
| **Rému ponctuelle** | Σ upfronts | CA immédiat |
| **Taux de rétro** | rému récurrente / encours | Comparer clients/contrats, benchmark |
| **Part du coût client captée** | rému / coût client total | Positionnement (transparence DDA) |
| **Coût total de détention (CTD)** | frais annuels tous étages | Argument conseil client |
| **RIY (reduction in yield)** | pts de perf annuelle mangés par les frais | Exigence PRIIPs/DDA |
| **Projection revenus** | rému composée 5/10/15 ans | Vision LTV du client |
| **(V2) Concentration** | % du CA sur top partenaires/clients | Risque, M&A |
| **(V2) Valorisation** | multiple du CA récurrent | Cession/acquisition |

---

## 9. Prochaines étapes (chantier Frais)

1. ~~**Barème de rému cabinet**~~ — ✅ FAIT (`lib/cabinet.ts` + `/cabinet`).
2. ~~**Relier dépôt → calcul**~~ — ✅ FAIT 20/07 : `/portefeuille/analyser` affiche coût
   client + rému CGP via `lib/remuneration.buildRemuneration` (barème cabinet + repli),
   ETF forcés à rétro 0.
3. **Frais contrat sourcé** — résoudre `av_contract_terms.frais_gestion_uc_pct` du contrat
   reconnu pour un CTD exact (au lieu de l'indicatif d'enveloppe), et l'`entryFeeShare`
   contrat pour un upfront exact.
4. **Vue cabinet / métriques agrégées** — dashboard rému (récurrent, ponctuel, taux de
   rétro, projection) au-dessus du portefeuille unique — après décision persistance.
5. **Décision persistance** — rattacher un portefeuille à un client sans compte serveur
   (cf. `no-accounts-product-direction`) : stockage local, export, ou revisite.
6. **Honoraires** — champ de facturation directe, consolidé avec les rétro (Sendraise).
7. **(V2) Agrégation + réconciliation bordereaux** — la vraie convergence avec Sendraise :
   comparer le modélisé (ex-ante) au réel encaissé (ex-post) → détection d'écarts.

---

*Sources : cartographie du code existant (feeSimulator, av-cost, av_contract_terms,
releve), analyse de [sendraise.eu](https://sendraise.eu) (positionnement, vocabulaire
métier des commissions, finalité pilotage), doc canonique
`mapping-assureurs-contrats-cgp.md`. Ordres de grandeur = indicatifs marché 2025-2026,
à fiabiliser par les DIC / conventions de distribution.*
