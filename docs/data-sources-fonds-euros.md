# Sources de données — Fonds en euros (assurance-vie française)

> Cartographie exhaustive des sources publiques pour enrichir les 50 fonds en
> euros de `investissement_funds` (ISINs synthétiques préfixés `FE_*`).
>
> Dernière mise à jour : 19 mai 2026
> Scraper opérationnel : [`scripts/scrapers/fonds-euros-enricher.py`](../scripts/scrapers/fonds-euros-enricher.py)

## 1. Contexte

Les **fonds en euros** sont les supports à capital garanti des contrats
d'assurance-vie français. Contrairement aux OPCVM ou ETF :

- Ils n'ont **pas d'ISIN officiel** (on utilise un identifiant synthétique `FE_<assureur>`).
- Ils ne sont pas listés sur Morningstar, Quantalys, Boursorama, JustETF.
- Le seul "prix" est le taux annuel servi (PB — Participation aux Bénéfices)
  publié rétrospectivement par l'assureur en début d'année N+1.

**Conséquence** : les sources classiques de fonds (Yahoo, Boursorama, AMF GECO,
Morningstar) sont toutes inutilisables ici.

## 2. Données cibles

| Champ DB              | Données souhaitées                                                  |
|-----------------------|---------------------------------------------------------------------|
| `performance_1y`      | Taux servi pour la dernière année close (2025 servi en début 2026)  |
| `performance_3y`      | Cumul composé 2022 + 2023 + 2024                                    |
| `performance_5y`      | Cumul composé 2020 → 2024                                           |
| `aum_eur`             | Encours du fonds (capitalisation)                                   |
| `historique annuel`   | Taux 2018 → 2025 (utile pour graphiques)                            |

## 3. Sources testées — Résultats

### 3.1 goodvalueformoney.eu (GVFM) — SOURCE PRINCIPALE

URL : <https://www.goodvalueformoney.eu/documentation/tableau-de-suivi-du-rendement-des-fonds-en-euros>

| Critère                | Résultat                                                          |
|------------------------|-------------------------------------------------------------------|
| Accessible (HTTP 200)  | OUI                                                               |
| HTML statique          | OUI (~2,5 Mo, aucun JS requis)                                    |
| User-Agent suffit      | OUI (`Mozilla/5.0 ... Chrome/121`)                                |
| Couverture             | **139 fonds en euros uniques**, données 2018-2025                 |
| Champs disponibles     | Taux servi par année, type (classique/dynamique/immobilier/...)   |
| AUM disponible         | NON (seulement les taux)                                          |
| Granularité            | Par contrat ET par fonds sous-jacent                              |

**Structure HTML** : pseudo-document Word exporté en HTML, sans tables `<table>`.
Le pattern d'extraction utilisé est :

```text
(Nom du contrat (Assureur)) Fonds <FundName> (fonds en euros <type>)
  Taux servi en YYYY : X,XX %
  Taux servi en YYYY-1 : X,XX %
  ...
```

Le parser :

1. Strip HTML → texte brut.
2. Trouve tous les marqueurs `(fonds en euros <type>)` (1236 occurrences ;
   ~140 fonds uniques après déduplication).
3. Pour chaque marqueur : remonte 200 caractères pour le nom, descend
   1500 caractères pour les `Taux servi en YYYY : X,XX %`.
4. Déduplique par nom (garde le record avec le plus d'années renseignées).

**Caveat sur l'extraction des noms** :
- Le parser strip les accents (`Sécurité` → `S curit`, `général` → `g n ral`).
  Toutes les comparaisons côté code utilisent les chaînes sans accents pour
  rester cohérent.
- Les lignes "En gestion libre : X,XX %" vs "En mandat d'arbitrage : Y,YY %"
  produisent des chaînes ambiguës (`"X,XX % Y,YY %"`). Le parser skip les
  valeurs contenant un espace+chiffre.
- Les fonds avec 2 taux pour la même année (ex. Suravenir Rendement gestion
  libre + mandat) sont dédupliqués vers le plus complet.

**Mapping ISIN → GVFM** : effectué à la main pour les 50 fonds (voir
`ISIN_TO_GVFM` dans le scraper). Une heuristique automatique donnerait trop
de faux positifs sur le nom générique "Actif général" (~30 fonds différents).

### 3.2 Sources tentées et inutilisables

| Source                                     | Statut              | Raison                                                                                |
|--------------------------------------------|---------------------|---------------------------------------------------------------------------------------|
| `goodvalueformoney.eu/classements`         | HTTP 404            | URL inexistante                                                                       |
| `meilleurtaux.com/.../fonds-euros.html`    | HTTP 404            | URL hardcodée morte                                                                   |
| `linxea.com/fonds-euros/`                  | HTTP 404            | URL morte (page principale OK mais sans données chiffrées)                            |
| `assurance-vie.com`                        | DNS fail            | Domaine inaccessible                                                                  |
| `bonsplansargent.com`                      | DNS fail            | Domaine inaccessible                                                                  |
| `france-assureurs.fr`                      | DNS fail            | Domaine inaccessible                                                                  |
| `lesfurets.com/.../fonds-euros`            | HTTP 403            | Anti-bot Cloudflare                                                                   |
| `cbanque.com/placement/...`                | HTTP 404            | URLs mortes                                                                           |
| `lerevenu.com/.../fonds-euros`             | HTTP 404            | URL morte (page existe mais path différent + SPA)                                     |
| `meilleurplacement.com/...`                | HTTP 404            | URL morte                                                                             |
| `boursorama.com/patrimoine/...`            | HTTP 404            | URL morte (Boursorama ne couvre pas les fonds euros)                                  |
| `placement-direct.fr/fonds-euros`          | HTTP 404 ; SPA      | Page React, données chargées en JS                                                    |
| `spirica.fr/contrats/fonds-en-euros`       | HTTP 404            | URL morte                                                                             |
| `suravenir.fr/nos-fonds-en-euros`          | HTTP 404            | URL morte                                                                             |
| `acpr.banque-france.fr`                    | HTTP 200            | Pages institutionnelles, aucune donnée par fonds                                      |
| `banque-france.fr/.../assurance-vie`       | HTTP 200            | Statistiques agrégées du marché, pas par fonds                                        |
| Wikipedia (fonds individuels)              | HTTP 404            | Aucun fonds en euros n'a sa propre page Wikipedia                                     |
| Wikipedia (assureurs : CNP, Predica, ...)  | HTTP 200            | Donne l'encours **groupe** (262 Md€ pour Predica), pas par fonds                      |

### 3.3 Pourquoi l'AUM par fonds est impossible publiquement

Les assureurs publient l'encours **total** de leur portefeuille d'assurance-vie
dans leurs rapports annuels et "données clés" (chiffres consolidés). Mais :

- L'encours **par fonds en euros** n'est pas une donnée publique réglementaire.
- L'ACPR publie des données agrégées (marché entier, ~1 600 Md€ en 2024) mais
  pas par fonds.
- France Assureurs (ex-FFA) a un site régulièrement inaccessible et n'expose
  pas non plus les encours par fonds.
- Les newsletters GVFM ("réserves des fonds en euros") parlent de consommation
  de réserves en M€ pour ~15 assureurs majeurs, mais pas d'AUM.
- Les rapports SFCR (Solvabilité II) des compagnies d'assurance contiennent
  parfois la décomposition, mais en PDF non-structuré, sans nom de fonds
  cohérent, et seulement pour les ~30 plus gros assureurs.

**Conclusion** : sans accès payant à un fournisseur de données spécialisé
(Argus de l'Assurance, L'Argus Pro, Optimind Winter), l'AUM par fonds en
euros n'est pas atteignable.

### 3.4 Pistes payantes ou bloquées (non retenues)

- **Argus de l'Assurance** : tableau exhaustif des fonds + AUM, mais abonnement payant.
- **Linxea / Placement-direct** : ont les données mais pages SPA React.
  Playwright pourrait débloquer ces sources mais hors scope (mission demande
  HTML statique uniquement).
- **Rapports SFCR Solvabilité II** : PDFs non-structurés, parsing LLM coûteux,
  faible ROI (10-15 fonds extractibles pour 30+ heures de travail).

## 4. Stratégie d'enrichissement retenue

```text
┌────────────────────────────────────┐
│ goodvalueformoney.eu (GVFM)        │
│ /tableau-de-suivi-du-rendement-... │
└─────────────┬──────────────────────┘
              │ HTTP GET (~2.5 Mo)
              ▼
┌────────────────────────────────────┐
│ Parser HTML → texte                │
│ Regex : "(fonds en euros TYPE)"    │
│         "Taux servi en YYYY : X %" │
└─────────────┬──────────────────────┘
              │ 139 fonds uniques
              ▼
┌────────────────────────────────────┐
│ Mapping ISIN_TO_GVFM (table fixe)  │
│ 41 fonds mappés / 9 sans match     │
└─────────────┬──────────────────────┘
              │
              ▼
┌────────────────────────────────────┐
│ Calcul perf_3y = compose(22,23,24) │
│ Calcul perf_5y = compose(20→24)    │
└─────────────┬──────────────────────┘
              │ UPDATE investissement_funds
              ▼
              Supabase
```

## 5. Résultats de l'exécution (19/05/2026)

| Métrique                              | Avant       | Après          |
|---------------------------------------|-------------|----------------|
| Total fonds_euros                     | 50          | 50             |
| Avec `performance_1y`                 | 50          | 50             |
| Avec `performance_3y`                 | **0**       | **41**         |
| Avec `performance_5y`                 | 0           | **34**         |
| Score `data_completeness` moyen       | ~28-36      | **83.5**       |
| Fonds avec score ≥ 80                 | 0 / 50      | **41 / 50**    |

### Fonds enrichis (41)

```text
✓ FE_GENERALI      p3y=7.82%  p5y=10.04%  ← eurossima
✓ FE_SPIRICA       p3y=8.68%  p5y=12.07%  ← actif général spirica
✓ FE_SWISSLIFE     p3y=5.39%  p5y=7.62%
✓ FE_SURAVENIR     p3y=7.27%  p5y=--      ← Suravenir Opportunités 2 (dynamique)
✓ FE_SURAVENIR_R   p3y=7.27%              ← Suravenir Rendement 2
✓ FE_CARDIF        p3y=9.29%  p5y=13.37%
✓ FE_AXA           p3y=8.99%  p5y=12.62%
✓ FE_ALLIANZ       p3y=6.89%  p5y=10.56%
✓ FE_GMF           p3y=8.63%  p5y=11.15%
✓ FE_MAAF          p3y=5.65%  p5y=7.30%
✓ FE_SOGECAP       p3y=8.21%  p5y=10.82%
✓ FE_PREDICA       p3y=7.95%  p5y=10.56%
✓ FE_PREDICA_GC    p3y=7.95%  p5y=10.56%  ← même fonds sous-jacent
✓ FE_LCL_VIE       p3y=7.95%  p5y=10.56%  ← LCL distribue Predica
✓ FE_UAF_LIFE      p3y=7.95%  p5y=10.56%  ← UAF Life (CA filière)
✓ FE_CNP           p3y=7.83%  p5y=9.52%
✓ FE_PACIFIC       p3y=7.42%  p5y=9.26%
✓ FE_MGEN          p3y=7.42%  p5y=9.26%
✓ FE_PALATINE      p3y=7.42%  p5y=9.26%
✓ FE_TUTELARE      p3y=7.42%  p5y=9.26%
✓ FE_MACSF         p3y=5.51%  p5y=8.05%
✓ FE_AG2R          p3y=4.87%  p5y=6.36%
✓ FE_MACIF         p3y=7.16%  p5y=9.75%
✓ FE_MIF           p3y=7.06%  p5y=9.97%
✓ FE_PLACEMENT_D   p3y=6.64%
✓ FE_BOURSO        p3y=7.82%  p5y=10.04%  ← Generali Eurossima
✓ FE_GOODVEST      p3y=4.98%  p5y=6.67%   ← SwissLife
✓ FE_YOMONI        p3y=6.64%
✓ FE_MMA           p3y=7.64%  p5y=10.02%
✓ FE_NALO          p3y=7.82%  p5y=10.04%  ← Generali
✓ FE_ASSURANCEVIE  p3y=6.64%
✓ FE_APICIL        p3y=3.44%  p5y=6.35%
✓ FE_RAMIFY        p3y=7.82%  p5y=10.04%  ← Generali
✓ FE_FRANCE_MUT    p3y=6.79%  p5y=9.26%
✓ FE_GAN           p3y=5.65%  p5y=7.30%   ← Nuances Sécurité
✓ FE_LINXEA        p3y=8.68%  p5y=12.07%  ← Spirica
✓ FE_MNEF          p3y=5.12%  p5y=6.65%   ← Harmonie Mutuelle
✓ FE_PRIMONIAL     p3y=4.45%  p5y=9.74%   ← Sécurité Pierre Euro (immobilier)
✓ FE_FORTUNEO      p3y=6.64%
✓ FE_SWISSLIFE_P   p3y=4.98%  p5y=6.67%
✓ FE_AVIVA         p3y=5.99%               ← Abeille Euro
```

### Fonds non enrichis (9)

Aucune correspondance fiable dans GVFM. Ces fonds sont soit :

- des mutuelles spécialisées (Garance — transport, MNT — fonctions publiques),
- des assureurs régionaux ou non-cotés (SMAVIE BTP, March Vie, Activa),
- des fonds non suivis par GVFM (Novalis Taitbout, Vauban, Capital Vie, CARAC).

```text
✗ FE_CARAC         (CARAC Fonds Euros)             — pas dans GVFM
✗ FE_GARANCE       (Garance Fonds Euros)            — mutuelle transport
✗ FE_MNT           (MNT Fonds Euros)                — fonctions publiques
✗ FE_NOVALIS       (Novalis Taitbout Fonds Euros)   — IP retraite
✗ FE_VAUBAN        (Vauban Humanis Fonds Euros)     — IP retraite
✗ FE_SMAVIE        (SMAVIE BTP Fonds Euros)         — bâtiment
✗ FE_MARCH_VIE     (March Vie Fonds Euros)          — assureur niche
✗ FE_ACTIVA        (Activa Fonds Euros)             — mutuelle niche
✗ FE_CAPITAL_VIE   (Capital Vie Fonds Euros)        — assureur niche
```

## 6. Maintenance et exécution

### Run manuel

```bash
# Dry-run (affiche ce qui serait écrit)
python3 scripts/scrapers/fonds-euros-enricher.py

# Apply (écrit dans Supabase)
python3 scripts/scrapers/fonds-euros-enricher.py --apply
```

### Fréquence recommandée

Les fonds en euros publient leurs taux **une fois par an** en janvier-février
(taux servi pour l'année écoulée). Re-run recommandé :

- **Mi-février** chaque année (capture des nouveaux taux N-1).
- **Sur ajout d'un nouveau fonds** au seed (re-mapper manuellement
  `ISIN_TO_GVFM`).

### Surveillance

GVFM est un site stable (en ligne depuis 2010+). Si le scraper retourne 0
fonds extraits :

1. Vérifier l'URL : un slug différent peut être utilisé.
2. Vérifier la présence des markers `(fonds en euros classique)` dans le HTML.
3. Si le format change radicalement (passage à un SPA), basculer sur
   Playwright pour rendu JS (hors scope actuel).

## 7. Pistes futures (non implémentées)

| Piste                                                            | Effort   | Gain        | Priorité |
|------------------------------------------------------------------|----------|-------------|----------|
| Étendre `ISIN_TO_GVFM` après recherche manuelle des 9 manquants  | 1-2 h    | +5-9 p3y    | basse    |
| AUM via Linxea / Placement-direct avec Playwright                | 4-6 h    | partiel     | basse    |
| AUM via parsing PDF rapports SFCR Solvabilité II                 | 20-30 h  | ~10 fonds   | non      |
| Taux 2026 (publié début 2027) — incrémentation annuelle          | 30 min   | +1 année    | annuelle |
