# Mapping assureurs et contrats — segment CGP français

> Référentiel produit pour Charlie Investissement. Objet : donner une vue exhaustive
> des assureurs français et luxembourgeois utilisés par les CGP, de leurs contrats
> phares et des attributs qui permettent de comparer contrats et assureurs dans l'app.
>
> Millésime des chiffres : **fonds euros et frais = indicatifs 2025**, à re-fiabiliser
> depuis les sources primaires (DIC, conditions générales, extranets) via les scrapers.
> Les faits structurels (groupe, positionnement, univers, seuils Lux) sont stables.
> Version 1.

---

## 1. Mode d'emploi

Ce document sert trois usages. Comprendre **qui décide et où s'orienter** (sections 2 et 8). Fournir à l'app la **grille d'attributs comparables** qui structure la comparaison de contrats et d'assureurs (section 3). Alimenter le **catalogue** assureur par assureur et contrat par contrat (sections 4 à 6).

Distinction à garder en tête en permanence : un **assureur** (porteur de risque) n'est pas un **contrat** (produit), et un contrat n'est accessible à un CGP que s'il est **référencé** dans une convention qu'il détient, le plus souvent via une **plateforme grossiste**. La comparaison pertinente pour un CGP se fait donc au niveau du **contrat**, filtré par ce qu'il distribue réellement.

---

## 2. Les trois couches du marché

| Couche | Rôle | Exemples |
|---|---|---|
| **Compagnie (assureur)** | Porte le risque et l'actif général, émet le contrat, exécute les actes, gère la fiscalité | Generali Vie, Spirica, Suravenir, Swiss Life, Cardif |
| **Plateforme / courtier grossiste** | Agrège plusieurs assureurs, référence les supports, porte le back-office et l'extranet, centralise les rétrocessions | Nortia, UAF Life Patrimoine, Intencial |
| **Contrat** | Le produit souscrit par le client, avec ses frais, son univers, ses options | Himalia, Netlife, Cardif Elite, Assurance Vie Nouvelle Génération |

Un CGP indépendant travaille en architecture ouverte et référence en général 3 à 8 couples assureur/plateforme. Le contrat est mono-assureur, mais le CGP est multi.

---

## 3. La grille d'attributs comparables (ontologie de comparaison)

C'est le schéma que l'app doit porter pour comparer contrats et assureurs. Trois familles.

### 3.1 Attributs du contrat

| Attribut | Définition | Pourquoi il compte |
|---|---|---|
| `enveloppe` | AV France, AV Luxembourg, PER, capitalisation | Détermine fiscalité et cible |
| `porteur` / `assureur` | Compagnie qui émet | Solidité, exécution, fiscalité |
| `distributeur` / `plateforme` | Grossiste qui référence | Accès réel, back-office, extranet |
| `frais_entree` | Droits d'entrée (souvent négociables, 0 à 5 %) | Coût client + upfront CGP |
| `frais_gestion_contrat_uc` | Frais annuels de l'enveloppe sur UC (~0,50 à 0,85 %) | Coût récurrent + rétro CGP |
| `frais_gestion_fonds_euros` | Frais sur le fonds euros (~0,60 %) | Rendement net du fonds euros |
| `frais_arbitrage` | Coût d'un arbitrage (0 à ~1 %, souvent gratuit en ligne) | Coût de gestion active |
| `fonds_euros_taux` | Taux servi (millésime) | Argument de sécurité |
| `fonds_euros_bonus` | Bonus de rendement conditionné à un quota d'UC | Contrainte d'accès au fonds euros |
| `fonds_euros_contrainte_uc` | Quota minimum d'UC pour accéder ou bonifier | Structure l'allocation |
| `garantie_fonds_euros` | Garantie brute ou nette de frais | Sécurité réelle |
| `univers_nb_uc` | Nombre d'unités de compte accessibles | Profondeur de l'offre |
| `univers_classes` | SCPI, SCI, OPCI, private equity, titres vifs, ETF, produits structurés | Capacité à diversifier |
| `gestion_sous_mandat` | Disponibilité et gérants délégataires | Cible clientèle déléguée |
| `options_gestion` | Sécurisation des plus-values, stop-loss, investissement progressif, rééquilibrage | Automatisation |
| `ticket_entree` | Versement initial minimum | Cible (surtout Lux) |
| `versement_min` | Complémentaire / programmé minimum | Accessibilité |
| `service_extranet` | Ergonomie, e-signature, télétransmission, délais back-office | Frein ou accélérateur quotidien |

### 3.2 Attributs de l'assureur

| Attribut | Définition | Pourquoi il compte |
|---|---|---|
| `groupe` | Actionnaire / groupe | Puissance de bilan, pérennité |
| `solvabilite_2` | Ratio de solvabilité | Solidité |
| `notation` | Notation d'agence si disponible | Solidité |
| `ppb` | Provision pour participation aux bénéfices (réserve fonds euros) | Capacité à lisser les taux |
| `encours` | Encours vie total | Poids de marché |
| `positionnement_cgp` | Place réelle sur le canal CGP/courtage | Pertinence pour la cible |

### 3.3 Attributs spécifiques Luxembourg

| Attribut | Définition |
|---|---|
| `triangle_securite` | Ségrégation des actifs assuré / assureur / dépositaire |
| `super_privilege` | Créance de premier rang du souscripteur (au-delà des 70 k€ du FGAP français) |
| `fid` | Fonds interne dédié (mandat géré), seuil d'accès |
| `fas` | Fonds d'assurance spécialisé (titres vifs, non coté), seuil d'accès |
| `multidevise` | Contrat libellé en devises hors euro |
| `credit_lombard` | Avance adossée au contrat |
| `neutralite_fiscale` | Fiscalité du pays de résidence du souscripteur |
| `portabilite` | Conservation en cas d'expatriation |

---

## 4. Assureurs français sur le segment CGP

Classés par importance réelle sur le canal CGP/courtage (pas par encours total, où dominent les bancassureurs Crédit Agricole Assurances, CNP, BPCE Vie).

| Assureur | Groupe | Contrats phares CGP | Fonds euros 2025 (indic.) | Positionnement | Force | Limite |
|---|---|---|---|---|---|---|
| **Generali Vie** (Generali Patrimoine) | Generali | Himalia, Espace Lux (Lux), Xaélidia, PER | 1,90 % à 3,40 % selon quota UC | Leader historique du courtage CGP, univers très large | Profondeur d'offre, PER, notoriété | Frais de gestion élevés en direct (~1 %) |
| **Spirica** | Crédit Agricole Assurances | Assurance Vie Nouvelle Génération, Ancre, Spirica PER (souvent via UAF Life Patrimoine) | Nouvelle Génération ~3,08 % | Champion de l'architecture ouverte (SCPI/SCI, titres vifs, PE) | Univers non coté et immobilier, frais compétitifs | Dépendant de la plateforme pour la distribution |
| **Suravenir** | Crédit Mutuel Arkéa | Contrats Suravenir (courtage et en ligne) | 2,10 % à 3,00 % selon gestion | Année record 2025, forte poussée CGP et courtiers en ligne | Solvabilité élevée, dynamique de collecte | Image historiquement « en ligne » |
| **Swiss Life** | Swiss Life | Swiss Life Strategic Premium, Placement Privilège, Retraite/PER | 1,70 % à 3,05 % (+0,20 pt gestion privée) | Haut de gamme CGP, banque privée | Qualité de gestion, gestion sous mandat | Positionnement premium, tickets plus élevés |
| **Cardif** | BNP Paribas | Cardif Elite, BNP Multiplacements Privilège, Nova Stratégie | ~2,75 % | Puissance de bilan, multi-canal | Solidité, gamme large | Moins « pure CGP » que Generali |
| **Apicil** | Groupe Apicil (mutualiste) | Contrats Intencial, Frontière Efficiente | variable | Monte en puissance, adossé à sa plateforme Intencial | Dynamique, intégration plateforme + OneLife Lux | Part de marché encore en construction |
| **Abeille Vie** (ex-Aviva) | Aéma Groupe | Abeille Épargne Plurielle | variable | Gros stock, réseau courtage historique | Base installée | Modernisation en cours |
| **AXA** (via AXA Thema) | AXA | Contrats distribués via AXA Thema (entité grossiste CGP dédiée) | variable | AXA adresse les CGP par une entité séparée | Marque, solidité | Accès via entité dédiée |
| **AG2R La Mondiale** | AG2R La Mondiale | Vivépargne, Multéo | variable | Présent, plus fort sur le collectif | Solidité | Moins central en AV individuelle CGP |
| **Ageas France** | Ageas | Via CD Partenaires / Sicavonline | variable | Assureur et grossiste intégré | Intégration | Périmètre plus étroit |

Acteurs de niche à connaître : **AFI-ESCA**, **MMA / Covéa**, **Groupama Gan Vie**, **Oradéa Vie** (Société Générale, en repli), **La France Mutualiste**.

### Lecture rapide

**Generali** et **Spirica** sont les deux socles de l'architecture ouverte CGP en France, l'un par la profondeur, l'autre par le non coté. **Suravenir** est le momentum. **Swiss Life** tient le haut de gamme. **Cardif** apporte le bilan. **Apicil** est l'outsider intégré verticalement avec sa plateforme et son assureur luxembourgeois.

---

## 5. Assureurs luxembourgeois

Le Luxembourg n'est pas un marché concurrent, c'est le compartiment haut de gamme du même CGP pour la clientèle patrimoniale et internationale. Arguments transverses : triangle de sécurité, super-privilège, neutralité fiscale, multidevise, FID/FAS, crédit lombard, portabilité.

| Assureur | Groupe | Ticket d'entrée (indic.) | Seuil FID | Seuil FAS | Frais UC plancher | Positionnement |
|---|---|---|---|---|---|---|
| **Utmost Wealth Solutions** (ex-Lombard International) | Utmost (UK) | 250 k€ | 250 k€ | élevé | — | Référence HNWI / family office, 30+ pays, large choix de dépositaires |
| **Cardif Lux Vie** | BNP Paribas | 250 k€ | 250 k€ | ~500 k€ | 0,50 % | Leader, adossé à un bilan bancaire, bon compromis sécurité/rendement |
| **Sogelife** | Société Générale Assurances | 250 k€ | 250 k€ | ~500 k€ | — | ~30 ans de présence, gros acteur |
| **Wealins** | Groupe Foyer | 125 k€ | 125-250 k€ | — | 0,50 % | +10 Md€ AuM, clientèle exigeante et internationale |
| **OneLife** | Groupe Apicil | **50 k€** (le plus bas) | 125 k€ | — | 0,50 % | Ticket le plus accessible, plateforme digitale youroffice, distribué via Intencial |
| **Bâloise Vie Luxembourg** | Bâloise | 100 k€ | 125 k€ | ~250 k€ | — | Accessible, bien référencé CGP |
| **La Mondiale Europartner** | AG2R La Mondiale | 150 k€ | 250 k€ | — | — | Bras luxembourgeois du groupe |
| **Swiss Life (Luxembourg)** | Swiss Life | 250 k€ | 250-500 k€ | ~1 M€ | — | Bon fonds euros + FID, sécurité/rendement |
| **Generali Luxembourg** | Generali | 250 k€ | 250 k€ | ~1 M€ | 0,50 % | Cohérence avec l'offre FR (Espace Lux) |
| **Allianz Life Luxembourg** | Allianz | 250 k€ | 250 k€ | — | — | Solidité, offre dédiée |
| **AXA Wealth Europe** | AXA | 250 k€ | 250 k€ | — | — | Complément Lux du groupe |
| **Vitis Life**, **Natixis Life** | divers | 250 k€ | — | — | — | Acteurs complémentaires |

### Lecture rapide

Pour un patrimoine > 1 M€ ou un profil international, **Utmost** reste la référence. Pour un bon fonds euros couplé à un FID entre 250 et 500 k€, **Swiss Life Lux** et **Cardif Lux Vie**. Pour démarrer accessible, **OneLife** (50 k€) via Intencial, ou **Bâloise** (100 k€).

---

## 6. Plateformes et courtiers grossistes (la couche d'accès)

C'est ici que se décide l'accès réel du CGP aux assureurs. Un branchement plateforme donne accès à plusieurs compagnies d'un coup, donc c'est la couche à cartographier en priorité pour Charlie.

| Plateforme | Groupe | Assureurs / contrats agrégés | Spécificités |
|---|---|---|---|
| **Nortia** | DLPK | 5 assureurs français, 2 luxembourgeois, comptes-titres, SCPI, prévoyance | Marketplace pionnière, 13 Md€ d'encours, ~1 000 CGP actifs |
| **UAF Life Patrimoine** | Spirica (Crédit Agricole Assurances) | Contrats Spirica et partenaires, dont Netlife | Plateforme adossée à Spirica, forte sur l'architecture ouverte |
| **Intencial Patrimoine** | Groupe Apicil | AV France, AV Luxembourg (OneLife), comptes-titres multidevises, SCPI, PE en nominatif pur, PER, crédit lombard | Née de la fusion Intencial + Alpheys (février 2025), offre one-stop-shop |
| **Ageas / CD Partenaires / Sicavonline** | Ageas | Contrats Ageas et sélection | Assureur-grossiste intégré |
| **Sélection 1818** | (banque privée dédiée CGP) | Multi-assureurs | Historique, orienté banque privée |

Note pour l'app : la vraie donnée actionnable est la matrice **contrat → assureur**, filtrée par les conventions du cabinet. Une plateforme référence des contrats portés par des assureurs ; c'est ce lien qu'il faut tenir à jour.

---

## 7. Priorisation pour Charlie (où s'orienter, qui aller chercher en premier)

1. **Les plateformes multi-assureurs d'abord.** Nortia, UAF Life Patrimoine et Intencial. Un branchement plateforme couvre plusieurs compagnies et beaucoup de contrats, donc le meilleur rendement de couverture par unité d'effort.
2. **Les compagnies socles en direct ensuite.** Generali, Spirica, Suravenir, Swiss Life, Cardif. Ce sont les plus référencées sur le canal CGP.
3. **Le Luxembourg via les portes les plus accessibles.** OneLife (via Intencial) et Cardif Lux Vie couvrent une large part des besoins patrimoniaux ; Utmost pour le très haut de gamme.
4. **Toujours prioriser par les contrats réellement distribués par les cabinets pilotes.** La couverture qui compte n'est pas théorique, elle est celle des contrats que Métagram, MBK et les prochains cabinets logent effectivement. Chaque cabinet branché enrichit la matrice pour tous.

---

## 8. Qui décide vraiment

Le **CGP décide** le contrat pour un client donné, mais dans un couloir contraint par quatre choses : les **conventions** qu'il détient (donc les plateformes et assureurs auxquels il a accès), le **profil client** et l'adéquation réglementaire, l'**univers réellement référencé** dans les contrats disponibles, et sa propre **économie** (rétrocessions). La **plateforme décide** ce qu'elle agrège et référence. L'**assureur décide** quels supports il accepte dans chaque contrat, donc la matrice de référencement.

Conséquence produit : l'app n'a de valeur pour le CGP que si elle raisonne dans son couloir réel, c'est-à-dire ses assureurs et ses contrats. Comparer des contrats qu'il ne distribue pas est académique. Comparer, parmi ce qu'il peut loger, lequel est le meilleur pour ce client, est actionnable.

---

## 9. Fiabilité et sources

Les faits structurels (groupes, positionnement, univers, seuils Luxembourg, rôle des plateformes) sont stables et corroborés. Les **taux de fonds euros et les frais sont des ordres de grandeur millésime 2025**, à re-fiabiliser contrat par contrat depuis les DIC et conditions générales via les scrapers, puis à horodater (fraîcheur). Les seuils FID/FAS et tickets luxembourgeois varient par compagnie et par convention, à confirmer au cas par cas.

Sources principales consultées : L'Argus de l'assurance (classements et taux fonds euros 2025), Profession CGP, Generali (tableaux de frais), comparatifs assurance-vie luxembourgeoise (Ramify, Finary, assurancevieluxembourg), sites Nortia, UAF Life Patrimoine et Groupe Apicil pour la couche plateformes.
