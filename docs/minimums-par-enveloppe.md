# Minimum investissable par enveloppe — runbook d'allumage

Retour CGP : afficher, sur la fiche fonds, le **minimum de souscription par contrat**
(ex. Eurazeo Private Value Europe 3 = 1 000 € sur Linxea Spirit 2, 100 € sur Avenir 2,
5 000 € sur Zen / Cardif). Le minimum dépend du couple **(support × contrat)**.

Tout le code est sur la branche `fix/pe-share-classes-surfacing`. Voici l'ordre EXACT
pour rendre la donnée visible en prod.

## Modèle

- Table `investissement_av_fund_envelope_terms(isin, key='Compagnie::Contrat',
  min_investment_eur, source_url, as_of, confidence)` — sidecar auditable façon
  `av_contract_terms` (migration `20260723130000`).
- `get_fund_insurers(p_isin)` renvoie, par compagnie, un champ `minimums = {contrat: €}`
  matché sur l'**ISIN exact** (les parts A/C ne se mélangent pas).
- La fiche fonds (`ReferencementCard`) affiche « <contrat> · dès X € » quand connu, et
  dégrade proprement sinon.

## Séquence

1. **Merger la branche dans `main` + déployer** (Vercel). Sans ça, l'affichage n'existe pas.
2. **Appliquer les migrations** (Mathis, dashboard Supabase), dans l'ordre :
   - `20260723120000_pe_share_classes_searchable.sql` — ⚠ répare AUSSI la recherche
     texte cassée en prod + rend le PE trouvable (indépendant des minimums, mais urgent).
   - `20260723130000_av_fund_envelope_minimums.sql` — crée la table + étend `get_fund_insurers`.
   - `20260723130100_seed_fund_envelope_minimums_anchor.sql` — seed CURÉ des cas
     confirmés (EPVE3 parts A/C). **Ces supports sont déjà référencés sur ces contrats**
     → dès cette étape, la fiche de `FR0013301553` (Eurazeo PVE3 C) montre
     « Linxea Spirit 2 · dès 1 000 € », « Linxea Avenir 2 · dès 100 € », « Linxea Zen ·
     dès 5 000 € », et `FR0013301546` (part A) « Cardif Edition Premium · dès 5 000 € ».
     **Aucun scraper requis pour la démo.**
3. **Peupler en masse** (optionnel, pour élargir au-delà des ancres) :
   ```bash
   set -a && source .env && set +a          # creds racine (cf. mémoire av-lux-local-run-recipe)
   /usr/local/bin/python3 scripts/scrapers/av-fund-minimums.py            # dry-run
   /usr/local/bin/python3 scripts/scrapers/av-fund-minimums.py --apply    # écrit + refresh MV
   ```
   Le scraper lit les catalogues Linxea (colonne « Souscription minimum » par
   contrat/catégorie), écrit les **minimums** (toutes les parts matchées) et les
   **liens d'éligibilité** pour les seuls titres résolus SANS ambiguïté, puis
   rafraîchit `investissement_fund_insurers_mv`.

## Limites connues (couverture partielle, itératif)

- **Résolution titre→ISIN** : Linxea nomme le fonds sans préciser la part ; un titre
  ambigu (plusieurs share-classes) reçoit le minimum sur toutes les parts (inoffensif —
  n'affiche que là où le fonds est référencé) mais **aucun lien d'éligibilité** (évite
  un faux référencement). Ces cas relèvent de la **curation** (le seed).
- **URLs Linxea** : le slug de page varie par contrat ; seules 3 pages PE sont validées
  (Spirit 2, Zen, Vie). Étendre = valider l'URL + vérifier que le « minimum dominant »
  extrait correspond bien au ticket de la catégorie.
- **Autres distributeurs / assureurs** : Cardif et Apicil publient des minimums par
  support dans des annexes PDF par fonds (`/DocAnnexeSouscription/{ISIN}.pdf` chez
  Apicil) — non encore scrapées ; à ajouter au coup par coup (curation ou parseur PDF).
- Le minimum **fund-level** `investissement_funds.min_subscription_eur` (0 % rempli)
  reste un concept DIFFÉRENT (ticket en direct/CTO, souvent bien plus élevé) — ne pas
  le confondre avec le minimum par enveloppe.
