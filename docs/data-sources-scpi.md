# Sources de données SCPI — état au 19/05/2026

Documentation exhaustive de toutes les sources publiques évaluées pour
enrichir les 280 SCPIs présentes dans `investissement_funds` (préfixe ISIN
`SCPI_*`, plus quelques ISINs FR* récupérés depuis GECO real-estate).

Champs prioritaires à enrichir :

| Champ | Couverture initiale | Couverture après Primaliance (19/05/2026) |
|-------|---------------------|--------------------------------------------|
| `performance_1y` | 60% | **64%** (+10) |
| `performance_3y` | 22.5% | 22.5% (inchangé) |
| `performance_5y` | ~17% | **40%** (+64) |
| `ter` / `ongoing_charges` | 0% | **58%** (+103) |
| `aum_eur` | 75% | **77.5%** (+7) |
| `sri` / `srri` | 0% | 0% (non disponible) |
| `inception_date` | 100% | 100% |

**Score data_completeness SCPI** : moyenne **45.6 → 51.6** (+6 pts).

Conventions SCPI :
- **TDVM** (Taux de Distribution sur Valeur de Marché) ≈ `performance_1y`
- **TRI 5 ans** annualisé ≈ `performance_5y` (les SCPIs n'ont quasiment
  jamais de "performance 3 ans" publiée — c'est TRI 5 ans qui est l'équivalent)
- **Frais de gestion** (% des loyers) ≈ `ongoing_charges` (équivalent TER SCPI)
- **TOF** (Taux d'Occupation Financier) — pas de colonne dédiée (info)

---

## 1. Sources fonctionnelles

### 1.1 scpi-lab.com — ✅ exploité depuis 18/05/2026

| Élément | Valeur |
|---------|--------|
| Scraper | `scripts/scrapers/scpi-lab-enricher.py` |
| URL principale | `https://www.scpi-lab.com/scpi/` |
| Type HTML | Statique (table HTML) |
| Champs collectés | `performance_1y` (DVM), `aum_eur` |
| SCPIs trouvées | 135 |
| SCPIs matchées DB | 126 |
| Enrichissements 18/05 | 45 |
| Limites | Pas de TRI, pas de TER, pas de SRI |

Parsing : `<tr>` HTML simple, cellules `<td>`. AUM format `"Tx-YYYY 1 374 M€"`.

### 1.2 primaliance.com — ✅ nouveau, exploité depuis 19/05/2026

| Élément | Valeur |
|---------|--------|
| Scraper | `scripts/scrapers/scpi-primaliance-enricher.py` |
| Sitemap | `https://www.primaliance.com/products/sitemap.xml` |
| Pages détail | `https://www.primaliance.com/scpi-de-rendement/{id}-scpi-{slug}` |
| Type HTML | Statique (Drupal, blocs `.paragraph.category`) |
| Volume | **164 fiches** (133 SCPI rendement/fiscales + 31 OPCI/SCI) |
| SCPIs matchées DB | **148 / 280** (53%, premier passage) |
| User-Agent | Safari 16 sur macOS, rate limit 1.5s |

Sélecteurs CSS utilisés (Drupal field paragraphs) :

| Class CSS | Mapping | Exemple |
|-----------|---------|---------|
| `.paragraph.taux_distribution` | `performance_1y` | `"Taux de distribution 2025 7,98 %"` |
| `.paragraph.tri_5ans` | `performance_5y` | `"Tri 5 ans 2025 -3,00 %"` |
| `.paragraph.tri_10ans` | (info) | `"Tri 10 ans 2025 -0,27 %"` |
| `.paragraph.frais_gestion` | `ongoing_charges` | `"Frais de gestion 11,40 %"` |
| `.paragraph.frais_souscription` | (info) | `"Frais de souscription 5,00 %"` |
| `.paragraph.capitalisation` | `aum_eur` | `"Capitalisation 160,02 M€"` |
| `.paragraph.date_creation` | `inception_date` (YYYY-01-01) | `"Date de création 1976"` |
| `.paragraph.taux_occupation` | (info — TOF) | `"Taux d'occupation 2025 92,49 %"` |
| `.paragraph.valeur_reconstitution` | (info) | `"Valeur de reconstitution 2024 385,51 €"` |
| `.paragraph.dividende_brut/net` | (info) | `"Dividende brut 2025 17,00 €"` |
| `.paragraph.nombre_associes/parts/immeubles` | (info) | — |

**Nom canonique** : extrait du JSON-LD `<script type="application/ld+json">`,
nœud `@type=Product` → `name` (ex: `"IROKO ZEN"`). Plus fiable que le slug d'URL.

**OPCI/SCI bonus** : 31 fiches OPCI/SCI ont un ISIN FR* dans le slug d'URL
(ex: `/sci-de-rendement/270-sci-sofidy-convictions-immobilieres-FR0013466117`),
permettant un matching direct par ISIN sans normalisation.

### 1.3 GECO AMF real-estate — ✅ déjà exploité

| Élément | Valeur |
|---------|--------|
| Scraper | `scripts/scrapers/geco-realestate.py` |
| Volume | 35 SCPIs avec vrais ISINs FR* |
| Champs | ISIN, name, management_company |
| Limites | Peu de SCPIs ont un ISIN dans GECO ; pas de perf/TER |

---

## 2. Sources testées mais inutilisables

### 2.1 Bloquées par IP / Cloudflare

Toutes hébergées sur OVH (213.186.33.x) et bloquent les requêtes Python
même avec User-Agent réaliste : connection timeout (code 000).

| Source | Statut HTTP | Notes |
|--------|-------------|-------|
| `france-scpi.fr` | 000 (connexion refusée) | Bloqué |
| `meilleuresscpi.com` | 000 | Bloqué (même hébergeur) |
| `scpi-rendement.fr` | 000 | Bloqué |
| `toutsurlescpi.com` | 000 | Bloqué |
| `centraldescpi.com` | 000 | Bloqué |
| `bourse.scpi.com` | 000 | Bloqué |
| `mon-immobilier.com/scpi` | 000 | Bloqué |
| `eldorado-immobilier.com/scpi` | 000 | Bloqué |
| `norma-capital.fr` | 000 | Bloqué |
| `paref.com` | 000 | Bloqué |
| `voisin-im.com` | 000 | Bloqué |

**Contournement possible** : utiliser Playwright headless avec stealth, ou
proxy résidentiel français. Non implémenté car trop coûteux pour le ROI.

### 2.2 SPA JavaScript — HTML statique vide

| Source | Statut | Notes |
|--------|--------|-------|
| `aspim.fr` | 200 mais SPA | Pas de contenu dans le HTML initial. Pages `chiffres-cles` chargées en JS. |
| `aspim.fr` bulletins PDF | — | Aucun PDF de bulletin trimestriel accessible directement depuis le HTML public. Seuls 2 PDFs ASPIM trouvés : rapport annuel + étude socio-éco — pas de données SCPI individuelles. |
| `quantalys.com` (déjà testé) | SPA React | 0 résultat en HTML statique |

### 2.3 URLs 404 / ressources inexistantes

| Source | Statut |
|--------|--------|
| `cbanque.com/placement/scpi/` | 404 |
| `cbanque.com/scpi/` | 404 |
| `placement.meilleurtaux.com/placement-immobilier/scpi.html` | 404 |
| `www.meilleurplacement.com/placement/scpi/` | 404 |
| `corum.fr/scpi-eurion` | 404 (URL ancienne) |
| `perial.com/scpi-grand-paris` | 404 |

### 2.4 Sources accessibles mais à faible valeur ajoutée

| Source | Code | SCPIs distinctes | Notes |
|--------|------|------------------|-------|
| `linxea.com/scpi/` | 200 | 6 | Liste très restreinte (Linxea SCPI Box). Pas exhaustif. |
| `selexium.com/scpi` | 200 | 0 fiches détail | Liens vers guides, pas vers fiches SCPI individuelles. |
| `epargnant30.fr` | 200 | 1 (Louve Invest) | Blog, pas un comparatif. |
| `placement.meilleurtaux.com/scpi` | 200 | ~10 | "Meilleures SCPI" sponsorisées Meilleurtaux. Pas de données chiffrées détaillées exposées en HTML. |
| `corum.fr` | 200 | 6 (propres SCPIs Corum) | Données disponibles mais limité aux SCPIs de la SGP. |
| `sofidy.com` | 200 | 4 | SCPIs Sofidy uniquement (Immorente, Efimmo, etc.) |
| `perial.com` | 200 | 4 | SCPIs Perial uniquement |
| `atland-voisin.com` | 200 | 4 | SCPIs Atland Voisin uniquement |
| `primonial.com` | 200 | ~5 | SCPIs Primonial REIM uniquement |
| `nortia.fr` | 200 | 0 | Plate-forme CGP, pas de comparateur public |

**Verdict** : les sites SGP sont exhaustifs pour leurs propres SCPIs mais
chacun ne couvre que 4-6 produits. Pour 200+ SCPIs, ce serait 30-40
scrapers individuels. ROI trop faible vs primaliance.com qui en couvre 133.

---

## 3. Stratégie recommandée

### Priorité 1 (faite mai 2026)
- `scpi-lab.com` → DVM + AUM pour 126 SCPIs

### Priorité 2 (mai 2026, ce livrable) — ✅ exécuté
- `primaliance.com` → TRI 5 ans + frais de gestion + TDVM + AUM pour 148 SCPIs
- **Résultats run --apply du 19/05/2026** :
  - 164 fiches parsées (133 SCPI rendement/fiscales + 31 OPCI/SCI)
  - 148 SCPIs matchées
  - 110 SCPIs effectivement enrichies (au moins 1 champ NULL complété)
  - Détail des champs ajoutés :
    - +103 `ongoing_charges` (équivalent TER SCPI)
    - +64 `performance_5y` (TRI 5 ans annualisé)
    - +10 `performance_1y` (TDVM)
    - +7 `aum_eur`
    - +0 `inception_date` (déjà 100% rempli)

### Priorité 3 (non implémenté)
- **Sites SGP individuels** pour les SCPIs non couvertes par Primaliance :
  cibles spécifiques (ex: SCPIs du portefeuille top 30). Effort élevé,
  gain limité (max 30-50 SCPIs supplémentaires).
- **Playwright + proxy FR** pour débloquer france-scpi.fr et meilleuresscpi.com.
  Coûts non triviaux ; à considérer si la couverture <60% reste un blocker.
- **Bulletins trimestriels ASPIM** : seraient idéaux pour TRI/DVM
  historiques mais pas accessibles publiquement en PDF direct.

### Limites structurelles
- **SRI/SRRI** : indicateur graphique dans les KIDs PRIIPS, non extractible
  hors LLM/OCR. Aucune source publique en texte brut.
- **performance_3y SCPI** : n'existe pas réellement dans la communication
  SCPI — les sociétés publient TDVM (1Y), TRI 5 ans, TRI 10 ans. Mapper
  TRI 5 ans → `performance_5y` est la bonne stratégie.
- **kid_parsed_at SCPI** : aucune SCPI ne publie de KID PRIIPS (réglementé
  pour fonds, pas pour SCPIs). À marquer N/A par convention si besoin.

---

## 4. Inventaire fichiers

| Fichier | Rôle |
|---------|------|
| `scripts/scrapers/scpi-full-scraper.py` | Ancien scraper france-scpi.fr (bloqué) |
| `scripts/scrapers/scpi-lab-enricher.py` | scpi-lab.com → DVM + AUM ✅ |
| `scripts/scrapers/scpi-primaliance-enricher.py` | primaliance.com → TRI5Y + TER + TDVM + AUM ✅ |
| `scripts/scrapers/aspim-scpi.py` | ASPIM seed (table `investissement_scpi_metrics`) |
| `scripts/scrapers/geco-realestate.py` | GECO AMF SCPI/OPCI ISINs ✅ |
| `scripts/scrapers/scpi-seed-extended.py` | Seed étendu des 280 SCPIs |
