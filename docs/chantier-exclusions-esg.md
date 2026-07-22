# Chantier « Politiques d'exclusion ESG » — passation données (pour Joseph)

> **À qui s'adresse ce document** : Joseph (partie data/fonds) et son Claude.
> **Objectif** : que chaque fonds de la base porte sa politique d'exclusion
> déclarée (fossiles, tabac, armes, jeux d'argent, alcool), pour que le moteur
> d'allocation puisse générer des portefeuilles **conformes aux exclusions du
> client** sur données réglementaires — pas sur des mots-clés de nom de fonds.
> Ce document donne le contexte, l'état exact au 20/07/2026, et les instructions
> opérationnelles précises (commandes, règles, vérifications).

---

## 1. Contexte — ce qui existe déjà (ne PAS re-développer)

La chaîne complète est en place et testée bout à bout :

```
Annexe SFDR précontractuelle (PDF réglementaire, template RTS)
        │  scripts/enrichers/sfdr-annex-enricher.py  (parsing exclusions)
        ▼
labels du fonds : tags normalisés  excl-fossiles / excl-tabac / excl-armes /
                                   excl-jeux / excl-alcool
        │  (colonne `labels` de investissement_funds, exposée par les vues
        │   investissement_funds_cgp / _cgp_ref — AUCUNE migration nécessaire)
        ▼
Moteur d'allocation (app/src/lib/allocationService.ts + profileToConstraints.ts)
  · mode STRICT : si le client exclut un thème, ne garde que les fonds qui
    DÉCLARENT cette exclusion (classes non exposées exemptées : monétaire,
    fonds euros, immobilier, crypto), avec garde anti-portefeuille-dégénéré
  · repli automatique : pas assez de fonds déclarants dans le contrat →
    filtre par « mandat » (secteur normalisé + mots-clés du nom), jamais assoupli
  · en bout de chaîne, une revue IA (Z.AI GLM 5.2) sert de filet de sécurité
```

**Comment l'enricher extrait** : la plupart des `kid_url` Morningstar
(`documenttype=299` = KID) servent AUSSI l'annexe SFDR en swappant
`documenttype=398`. Le parsing ne tague un thème que si le mot-clé (pétrole,
tabac, armes, casino…) apparaît à ±260 caractères d'un **marqueur d'exclusion**
(« exclut », « interdit », « liste noire », « zéro tolérance »…) — une simple
mention (ex. tableau d'indicateurs PAI) ne suffit pas. Cas particulier : un
fonds qui n'exclut que les armes *controversées* (obligation légale française)
n'est **pas** taggé `excl-armes`.

**Les tags sont protégés** : `populate-screener-labels.py` préserve les
`excl-*` via `PRESERVED_LABELS` (déjà fait). L'écriture de l'enricher est
**additive stricte** (fusion, ne retire jamais un label).

---

## 2. État au 20/07/2026 — les chiffres qui comptent

| Segment | Fonds |
|---|---:|
| Base totale | 49 711 |
| Art. 8/9 (ont une annexe SFDR quelque part) | 9 177 |
| Art. 8/9 avec annexe **accessible via Morningstar** (kid_url documenttype=299) | **817** |
| → déjà drainés et taggés quand l'annexe déclare des exclusions | ~800 traités, **~185 taggés** (79 % des annexes *lisibles* déclarent des exclusions) |
| Art. 6 (pas d'annexe SFDR — hors périmètre déclaratif) | 24 288 |
| `sfdr_article` inconnu (pool potentiel d'art. 8/9 cachés) | 16 246 |

Couverture actuelle par thème : fossiles 179 · tabac 152 · armes 58 · jeux 26 · alcool 8.

**Lecture** : le canal Morningstar est quasi épuisé. Le levier n'est plus de
relancer l'enricher, mais d'**élargir l'accès aux annexes** des ~8 360 art. 8/9
restants, et de **classifier les 16 246 fonds au SFDR inconnu** (ceux qui se
révèlent art. 8/9 rejoignent le gisement).

---

## 3. Les 3 chantiers, par ordre de levier

### Chantier A — Résolveurs d'annexes supplémentaires (le gros levier, ~8 360 fonds)

Le canal actuel (`annex_url()` dans `sfdr-annex-enricher.py`) ne sait dériver
l'annexe QUE depuis un kid_url Morningstar `documenttype=299`. Il faut ajouter
d'autres résolveurs, dans l'ordre de rendement attendu :

1. **Registre EPR PRIIPs de l'AMF** (`epr.amfinesoft.com`) — déjà identifié
   comme repli dans la docstring de l'enricher, non câblé. C'est le registre
   officiel français : couverture large des fonds FR. Le repo a déjà un
   enricher qui parle à l'EPR : `scripts/enrichers/epr-kid-enrich.py` —
   s'inspirer de sa façon de résoudre ISIN → documents, et regarder si l'EPR
   expose l'annexe SFDR en plus du DIC.
2. **fundinfo / fundsquare** — `scripts/scrapers/fetch-ter-fundinfo.py` montre
   comment le repo interroge fundinfo ; leurs pages documents listent souvent
   « Informations développement durable » (= l'annexe).
3. **Sites des sociétés de gestion** — en dernier recours, par gestionnaire
   majeur (Amundi, BNP AM, Carmignac…), sur le modèle des scrapers
   `issuer-*` existants.

**Comment l'intégrer proprement** : garder UN SEUL enricher
(`sfdr-annex-enricher.py`) et faire de `annex_url()` une chaîne de résolveurs
(Morningstar → EPR → fundinfo). Le reste du pipeline (téléchargement, parsing,
écriture fill-only, marqueurs d'idempotence) ne change PAS.

### Chantier B — Classifier les 16 246 fonds au SFDR inconnu

Chaque fonds reclassé art. 8/9 rejoint le gisement du chantier A. Outils
existants : `scripts/enrichers/sfdr-enricher.py` (KID), et l'article SFDR
figure souvent dans le nom/les documents. **Règle absolue : fill-only — ne
jamais écraser un `sfdr_article` non nul.**

### Chantier C (plus tard, optionnel) — Contrôle par les inventaires

Les tables `investissement_fund_holdings` / `_sectors` / `_geos` existent déjà
(workflows `holdings-drain*`). Un contrôle a posteriori « top holdings vs
listes d'exclusion » (détecter TotalEnergies, Rheinmetall… dans un fonds taggé
compliant) ferait une deuxième ceinture. Ne pas commencer par ça : 10× l'effort
du chantier A pour affiner ce qu'il couvre déjà à ~90 %.

---

## 4. Mode opératoire (à donner tel quel à Claude)

### Prérequis

- Repo `screenerv2`, branche `main` à jour.
- `.env` À LA RACINE du repo avec `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  (les enrichers lisent via `scripts/db.py`).
- Python 3.11+ avec `requests`, `pdfplumber`, `supabase` (déjà OK si les autres
  enrichers tournent).

### Commandes de référence

```bash
# 1. TOUJOURS commencer par un PoC (n'écrit RIEN, affiche ce qui serait extrait)
python3 scripts/enrichers/sfdr-annex-enricher.py --poc --limit 12 --redo

# 2. Écriture par tranches (idempotent : re-lancer reprend où ça s'est arrêté)
python3 scripts/enrichers/sfdr-annex-enricher.py --apply --redo --limit 500

# Variante : ne traiter que les fonds référencés dans au moins un contrat
# (priorité produit — c'est ce que le moteur d'allocation sert aux CGP)
python3 scripts/enrichers/sfdr-annex-enricher.py --apply --redo --referenced-only

# Un seul ISIN (debug d'un résolveur)
python3 scripts/enrichers/sfdr-annex-enricher.py --apply --isin FR0000000000
```

Flags : `--redo` = repasser les fonds déjà examinés par l'enricher mais sans
tag `excl-*` (nécessaire car l'extraction d'exclusions est plus récente que le
premier drain DDA) ; sans `--redo`, seuls les fonds jamais examinés sont pris.

Cadence : ~1,2 s/fonds (politesse 0,4 s incluse — **ne pas la réduire**).
Aussi lançable via GitHub Actions : workflow `sfdr-refresh.yml`
(hebdo mardi 04:00 UTC + déclenchement manuel avec `limit`).

### Règles NON négociables (déjà dans le code — les préserver)

1. **Fill-only strict** : jamais d'écrasement d'une valeur non nulle ;
   les labels se FUSIONNENT (additif), jamais de remplacement.
2. **Ne jamais toucher `sfdr_article`** depuis cet enricher.
3. **Interdiction de l'API Morningstar** `sal-service`/`ecint` non authentifiée
   pour ce chantier : uniquement des téléchargements de documents statiques.
4. Un thème n'est taggé QUE si mot-clé + marqueur d'exclusion à proximité
   (précision > rappel : un faux « exclut les fossiles » est pire qu'un
   manque, car le moteur promet la conformité au CGP).
5. Tout nouveau tag doit être dans le vocabulaire fermé :
   `excl-fossiles`, `excl-tabac`, `excl-armes`, `excl-jeux`, `excl-alcool`.
   (Si on en ajoute un — ex. `excl-charbon` — il faut AUSSI l'ajouter à
   `PRESERVED_LABELS` dans `scripts/migrations/populate-screener-labels.py`
   et au mapping `EXCLUSION_TO_POLICY_TAG` dans
   `app/src/lib/profileToConstraints.ts`.)

### Vérifications après chaque tranche

```bash
# Compter les taggés par thème (REST Supabase, clé service role)
curl -s -G "$SUPABASE_URL/rest/v1/investissement_funds_cgp_ref" \
  --data-urlencode 'select=isin' --data-urlencode 'labels=cs.["excl-fossiles"]' \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Prefer: count=exact" -H "Range: 0-0" -D - -o /dev/null | grep -i content-range
```

Contrôle qualité par échantillon : prendre 5 fonds fraîchement taggés, ouvrir
leur annexe (l'URL est affichée en mode `--poc`), vérifier à l'œil que
l'exclusion est bien déclarée. Viser ~0 faux positif.

### Test d'impact produit (la finalité)

```bash
# Le moteur doit passer en « mode strict » quand la couverture du contrat suffit :
curl -s "http://localhost:3000/api/portfolio/optimize?contract=Linxea%3A%3ALinxea+Avenir+2&targets=actions%3A70%2Cobligations%3A30&exclusions=fossiles" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print([n for n in d['allocation']['notes'] if 'xclusions' in n])"
# Attendu : « Exclusions du client appliquées en mode strict : … »
# (sinon : « Trop peu de fonds à politique d'exclusion déclarée … » = couverture insuffisante)
```

---

## 5. Définition de « terminé »

- [ ] Chaque fonds art. 8/9 de la base a été examiné par l'enricher
      (marqueur `sustainability_source` posé), via au moins un résolveur d'annexe.
- [ ] Les fonds au `sfdr_article` inconnu ont été classifiés (chantier B),
      et les nouveaux art. 8/9 examinés à leur tour.
- [ ] Sur les principaux contrats (Linxea, Cardif, Swiss Life…), une génération
      avec exclusions passe en « mode strict » (test §4).
- [ ] Zéro faux positif sur les contrôles par échantillon.

Questions produit / moteur : Sacha. Le moteur, ses tests (789 verts) et la
revue IA sont finis côté app — ce chantier est 100 % données.
