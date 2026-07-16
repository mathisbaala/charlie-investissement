# Référencement Assurance-Vie — système & runbook

> Doc de référence du système de référencement UC↔contrat d'assurance-vie.
> Dernière mise à jour : 2026-07-16. Complète `docs/data-collection-playbook.md`
> (collecte de fonds) et `docs/tier3-missing-insurers-spec.md` (extension assureurs).

## 1. À quoi ça sert

Pour chaque contrat d'assurance-vie, savoir quelles **unités de compte (UC)** y sont
disponibles. C'est le socle du parcours CGP : filtrer le screener par assureur/contrat,
afficher l'offre d'un contrat sur `/assureurs`, et le look-through par contrat.

**Couverture au 2026-06-21** : ~250 300 liens / ~10 700 UC / 436 contrats / 32 assureurs
(99 % rafraîchis le jour même).

## 2. Modèle de données

| Objet | Rôle |
|-------|------|
| `investissement_av_lux_eligibility` | 1 ligne = 1 UC dispo sur 1 contrat. Colonnes : `isin`, `company_name` (assureur), `contract_name`, `source_url`, `scraped_at`. Conflit upsert : `(isin, contract_name)`. |
| `investissement_fund_insurers_mv` | Matview : par fonds, union des assureurs/contrats, **propagée à toutes les share-classes** (lue sur la primaire). Reconstruite par `inv_refresh_fund_insurers_mv()`. |
| Vue `investissement_funds_cgp_ref` | Expose `insurers[]`/`contracts[]` au screener. |
| Fonctions `get_insurers_list` / `get_contracts_list` / `get_fund_insurers` | Lues par l'UI. Filtrent `is_primary_share_class`, `data_completeness >= 50`, excluent `action/crypto/fps/structuré`. |

**Conventions** : scrapers **éligibilité-only / fill-only** (n'écrivent que l'éligibilité,
pour des ISIN **déjà** en base ; n'écrasent jamais perfs/frais). Toujours `scraped_at=now()`
(alimente le délistage Tier 4). Nom d'assureur **autoritaire** (pas de doublon/variante).

## 3. Orchestration (cadence trimestrielle)

| Workflow | Orchestrateur | Contenu |
|----------|---------------|---------|
| `av-refresh.yml` (12 jan/avr/juil/oct 05:00 UTC) | `scripts/cron/av-catalog-refresh.py` | Scrapers HTTP/PDF + opcvm360 `--all`/`--dynamic` + **prune Tier 4** + refresh matview |
| `av-refresh-browser.yml` (12 … 06:00 UTC) | `scripts/cron/av-catalog-refresh-browser.py` | Scrapers **navigateur** (Linxea JWT, Cardif Lux Vie SPA) — installe Playwright+chromium |

Garde-fous : chaque étape **non-fatale** + bornée par `STEP_TIMEOUT` (anti-hang) ;
**alerte issue** si une étape casse ; groupe de concurrence `data-refresh` (pas de
chevauchement). Décalé du refresh SCPI (le 5).

## 4. Inventaire des scrapers

**Actifs (job HTTP)** : `av-fr-{allianz,axa,cardif,generali,mutualistes,garance,monceau,asac-fapes,bpce,prepar-vie,afi-esca,oradea,sogecap,conservateur,spirica,suravenir,swisslife}`
(oradea RESSUSCITÉ 16/07 : le portail a déménagé sur `priips.sogecap.com/priips/oradea.html`, granulaire par contrat),
`av-lux-{afi-esca,allianz,apicil-onelife,axa-wealtheurope,baloise,cnp,generali,sogelife,swisslife,utmost,vitislife,wealins}`,
`av-lux-opcvm360 --all` + `--dynamic`. *(Tier 3 : bancassureurs FR ajoutés en parallèle — cf. §8.)*

**Actifs (job navigateur)** : `av-lux-linxea-catalog` (JWT Morningstar via navigateur),
`av-lux-cardif-lux-vie-catalog` (APIs SPA en session),
`av-lux-cali-europe-catalog` (grid DevExpress my-calie.com, API cliente `ExpandAll`/`GotoPage`).

**Extension AV Lux LPS France (16/07/2026)** — sources par assureur :

| Assureur (`company_name`) | Scraper | Source | Contrats |
|---|---|---|---|
| CNP Luxembourg | `av-lux-cnp-catalog` | Quantalys Easypack `cnplux-ezp.quantalys.com` (porte JS + DataTables, listes PAR contrat, `agrement=FR`) | 9 (CNP One Lux/Capi, Saint Honoré Innovation, Aster One, Vertuo, Alyses) — ~2 277 ISIN |
| Sogelife | `av-lux-sogelife-catalog` | ZIP PRIIPS `doc.sogelife.com/priips/<code>.zip` — ISIN lus dans les NOMS de fichiers DIS (`S_<ISIN>_…pdf`) via le répertoire central du ZIP (requêtes Range, ~100 Ko au lieu de 230 Mo) | 5 (Personal Multisupports ×2, Private Selection, Target FR ×2) — ~1 001 ISIN |
| CALI Europe | `av-lux-cali-europe-catalog` 🖥 | Portail PRIIPS `my-calie.com/FO.PRIIPS` (jeton `pct` de session via l'iframe SearchKid ; navigateur requis) | 4 (CALIE Life Excellence/Patrimony 2+ (F), vie+capi) — ~286 ISIN |
| Allianz Life Luxembourg | `av-lux-allianz-catalog` | Portail PRIIPS `life.allianz.lu/priips/` — POST `p=<code>&lang=fr`, page ~16 Mo régexée sur `data-isin` | 2 (Exclusive Invest France `085`, Global Invest Evolution France `092`) — ~172 ISIN |
| AFI ESCA Luxembourg | `av-lux-afi-esca-catalog` | PDF « Liste-QLCQ-FRANCE loi PACTE » (annuel, URL découverte sur `afi-esca.lu/infos-tarification-france/`) | Quality Life + Cap Quality — ~129 ISIN. ≠ « Afi Esca » (entité FR) |
| Utmost Luxembourg S.A. | `av-lux-utmost-catalog` | **Migré PDF → API REST WP** `utmostgroup.com/wp-json/wp/v2/fund?fund-list-code=<id>` (slug 2626 = Liberté). Ex-Lombard International (renommé 11/2025) | Liberté — 66 ISIN externes (les « ~800 UC » incluent FID/FAS non publiés) |
| Zurich Eurolife | — | **Hors périmètre** : uniquement retraite/prévoyance collective B2B en France ; le portefeuille patrimonial a été cédé à Lombard en 2016 | — |

**Hors job (redondants/inopérants, données seedées)** :
- `linxea-av-catalog` — URLs comparateur Linxea mortes ; **redondant** (Linxea couvert par `av-lux-linxea-catalog`).
- `av-lux-lmep-easypack` — quantalys (anti-bot, pendait 2 h → exclu).
- `av-lux-ag2r-catalog` — opcvm360 403 ; **redondant** (AG2R couvert via opcvm360 `--dynamic` contrat 633).

## 5. opcvm360 — découverte dynamique (le levier)

`av-lux-opcvm360-catalog.py --dynamic` interroge l'API `/licontracts?iframeKey=<KEY>` :
liste de contrats **avec le nom d'assureur autoritaire** (`insurerName`), puis
`/instrs-iframes?licontracts=<id>&iframeKey=<KEY>` → fonds. Fini les « Assureur inconnu ».
Débloque 8 contrats nommés (Generali Vie, AG2R, Spirica, APICIL, Suravenir, La France
Mutualiste — gammes Meilleurtaux/MonFinancier). **Levier** : d'autres `iframeKey`
(une par distributeur) débloqueraient d'autres assureurs (cf. tier3 spec).

## 6. Délistage des liens périmés (Tier 4)

`inv_prune_stale_av_eligibility(p_apply, p_recent_days=2, p_stale_days=100, p_min_fresh_frac=0.5)`
(migration `20260621180000`) + enricher `prune-stale-av-eligibility.py`, en fin
d'orchestrateur (avant la matview). Le modèle est upsert-only → un lien reste quand
l'assureur retire l'UC. **Conservateur** (un faux négatif est pire qu'un lien vieux
pour un CGP) :
- ne purge que les contrats **encore activement scrapés** ;
- ne supprime qu'un lien **non revu depuis ≥100 j** (≥1 cycle manqué = délistage
  **confirmé**, jamais une variance d'un seul scrape) ;
- **garde anti-scraper-cassé** : pas de purge si le contrat est majoritairement périmé
  (signalé à la place).

## 7. Pile technique & pièges

- **HTTP** : `requests` ; **anti-bot** : `curl_cffi` (`impersonate="chrome"`, léger, en CI) ;
  **parsing** : `parsel` ; **PDF** : `pdftotext` (`poppler-utils`, installé par le workflow) ;
  **navigateur** (dernier recours) : Playwright+chromium, **workflow dédié uniquement**.
- ⚠️ **NE PAS** réintroduire `scrapling` (retiré du CI — embarque un navigateur). Les 4
  ex-scrapling ont été migrés vers `curl_cffi+parsel` le 21/06.
- ⚠️ **Postgres 21000** « ON CONFLICT … cannot affect row a second time » : **dédupliquer
  `(isin, contract_name)` avant l'upsert batch** (cf. `av-fr-spirica-catalog.py` `seen_keys`).
- ⚠️ **Sources bloquantes** (quantalys, opcvm360-direct) : toujours `timeout=` ; le
  `STEP_TIMEOUT` est le filet (incident lmep : hang 2 h).
- 🔴 **Blocage IP datacenter en CI** : certains hôtes assureurs filtrent les IP des runners
  GitHub Actions alors qu'ils répondent depuis une IP résidentielle. Symptômes : page anti-bot
  servie en **HTTP 200** (→ 0 lien découvert, aucune erreur) ou **timeout TCP `curl (28)`**.
  Constaté sur **Abeille** (`abeille-assurances.fr`) et **MAAF** (`maaf.fr`) ; à surveiller pour
  MMA/GMF (`cap.mma.fr`/`cleerly.fr`). Contournement = **seed manuel depuis une session locale**
  via le MCP Supabase (non automatisable à distance : un cron tourne aussi sur IP datacenter).
  Détail + procédure dans `docs/tier3-missing-insurers-spec.md` §0.bis.
- ⚠️ **Noms d'assureur** : prendre le nom autoritaire de la source → évite « Assureur
  inconnu » et les doublons d'accent.
- 🔴 **`contract_name` DOIT différer de `company_name`** : la matview
  `investissement_fund_insurers_mv` construit `contracts[]` avec
  `FILTER (contract_name <> company_name)`. Un scraper qui écrit le nom de
  l'assureur comme nom de contrat rend l'offre INVISIBLE dans
  `get_contracts_list`/`/assureurs` alors que l'assureur apparaît dans
  `get_insurers_list` et que le run CI est `success` (le compteur
  `records_processed` ne couvre que l'upsert des fonds). Deux fois le même bug :
  Generali Lux (migration `20260710120000`) et Swiss Life Lux (`20260715120000`,
  1 242 liens invisibles pendant ~2 mois). Convention : suffixer
  « … Univers Global » quand la source n'a pas de per-contrat public.
- **Valider sans DB** : `--apply` absent = dry-run (ne touche pas `get_client`) ; sonder
  d'abord avec `curl_cffi`. Creds réels = secrets CI → run `workflow_dispatch` pour le bout-en-bout.

## 7bis. Proxy résidentiel (contournement blocage IP datacenter CI)

> **STATUT (21/06/2026) : code en place mais NON ACTIVÉ — différé volontairement.**
> Le mécanisme ci-dessous est mergé et **dormant** (aucun secret `AV_PROXY_URL` posé →
> connexion directe, comportement inchangé). Jugé non prioritaire ; à activer plus tard
> (souscrire un proxy + poser le secret, ou self-hosted runner). En attendant, Abeille &
> MAAF restent re-seedés manuellement chaque trimestre (cf. agent #1). Rien à défaire :
> le code est sans effet tant qu'il n'est pas activé.

**Problème** : certains hôtes assureurs FR bloquent les **IP datacenter de GitHub
Actions** (anti-bot DataDome / drop TCP) — vérifié 21/06 sur `maaf.fr` (timeout) et
Abeille (page anti-bot servie en 200 vide). Le code des scrapers est correct (marche
depuis une IP résidentielle) mais le run CI rend 0 → péremption silencieuse à terme.
Hôtes suspects/concernés : `maaf.fr`, Abeille, `cap.mma.fr`/`cleerly.fr` (Covéa),
`quantalys.com` (LMEP).

**Mécanisme (en place, DORMANT par défaut)** :
- Couche HTTP partagée `_av_pdf_common.make_session(use_proxy=...)` + paramètre
  `run_eligibility(..., use_proxy=...)`. Si `use_proxy=True` **et** la variable d'env
  `AV_PROXY_URL` est posée → la session curl_cffi route via le proxy. Sinon → connexion
  directe (zéro changement). Activé sur les scrapers ciblés : **MAAF, Abeille, MMA, GMF,
  LMEP** (les autres restent en direct pour ne pas dépendre d'un proxy qui pourrait être
  instable). `av-refresh.yml` expose `AV_PROXY_URL: ${{ secrets.AV_PROXY_URL }}`.
- Format : `http://user:pass@host:port` (ou `socks5h://user:pass@host:port`).

**Activer (voie 1 — proxy, recommandée, zéro infra)** :
1. Souscrire un **proxy résidentiel** (offres FR utiles ; ex. Bright Data, Oxylabs,
   IPRoyal, Smartproxy — choix utilisateur, coût mensuel/au Go).
2. `gh secret set AV_PROXY_URL --body 'http://USER:PASS@HOST:PORT'` (repo
   `mathisbaala/charlie-investissement`).
3. Lancer `av-refresh.yml` en `workflow_dispatch` → vérifier que MAAF/Abeille/MMA/GMF/LMEP
   écrivent (logs « ↻ proxy résidentiel actif » + lignes éligibilité > 0).
   Bande passante : les fetchs PDF sont petits (~Mo) ; LMEP pagine ~3119 lignes JSON.

**Activer (voie 2 — self-hosted runner, sans proxy, sans coût/Go)** :
- Enregistrer un runner sur une machine à IP résidentielle (Settings → Actions → Runners,
  label ex. `residential`), puis basculer le `runs-on:` du job `av-refresh.yml` (et
  `av-refresh-browser.yml`) de `ubuntu-latest` vers `[self-hosted, residential]`. Aucun
  `AV_PROXY_URL` requis (l'IP du runner EST résidentielle). Le code proxy reste dormant.
- ⚠️ La machine doit être allumée à l'heure du cron (12 jan/avr/juil/oct) ou utiliser
  `workflow_dispatch` à la demande.

**Note navigateur** : `av-refresh-browser.yml` (Playwright, Linxea/Cardif) n'est PAS
encore câblé au proxy (la config proxy de Playwright diffère — `--proxy-server` au lancement
du navigateur). À faire si ces hôtes se bloquent aussi en CI ; sinon la voie 2 (runner) les
couvre nativement.

## 8. Historique des travaux (juin 2026)

- **Refresh planifié** câblé (les catalogues étaient seedés une fois, jamais rafraîchis).
- Robustesse : `STEP_TIMEOUT` (anti-hang lmep/quantalys), poppler-utils, tri sur preuve DB,
  dédup Spirica (21000).
- **Migration 4 scrapers scrapling → curl_cffi+parsel** (wealins fonctionnel ; 3 autres ont
  un bloqueur navigateur/URL, pas scrapling).
- **Workflow Playwright dédié** (Linxea + Cardif Lux Vie).
- **opcvm360 `--dynamic`** (Generali Vie réel 999, AG2R 334…).
- **Tier 1 hygiène** : 20 stubs `manual:user-tobam` purgés (backup `investissement_av_eligibility_tobam_backup_20260621`, RLS).
- **Tier 4 délistage** (RPC + enricher conservateurs).
- **Tier 3** (bancassureurs FR : CNP, Predica, Abeille, Groupama/Gan, MACSF, MAAF, ACM) —
  cf. `docs/tier3-missing-insurers-spec.md`. **Validé bout-en-bout en CI le 21/06** : 7/7 assureurs
  live (~2 504 fonds, 65 contrats) ; 5/7 écrits par le job, Abeille+MAAF seedés manuellement
  (IP CI bloquée → re-seed manuel trimestriel, cf. gotcha §7).

## 8bis. Extension AV Lux LPS France (juillet 2026)

- **Bugfix Swiss Life Luxembourg** : 1 242 liens présents en base mais contrat
  invisible (`contract_name = company_name`, cf. gotcha §7). Scraper corrigé
  (`Swiss Life Luxembourg Univers Global`) + migration `20260715120000`.
- **5 nouveaux assureurs LPS France** (détail §4) : CNP Luxembourg, Sogelife,
  CALI Europe 🖥, Allianz Life Luxembourg, AFI ESCA Luxembourg — sources
  vérifiées par sondes le 16/07, dry-runs OK (~3 900 ISIN bruts cumulés).
- **Utmost** : entité ex-Lombard renommée Utmost Luxembourg S.A. (rachat Utmost
  clôturé 30/12/2024, rebrand 11/2025) ; scraper migré du PDF fonds-externes
  vers l'API REST WordPress d'utmostgroup.com (taxonomie `fund-list-code`).
  Les FID/FAS sur mesure ne sont pas énumérables publiquement (« ~800 UC »
  marketing → 66 ISIN externes référençables).
- **Zurich Eurolife : hors périmètre** (B2B collectif only en France ; SFCR 2025).
- **Seed compagnies corrigé** : l'entrée CALI_EUROPE confondait CALI Europe
  (Crédit Agricole) et Cardif Lux Vie (BNP) — scindée en deux ; ajout
  AFI_ESCA_LUX ; noms Utmost/CNP mis à jour.

## 8ter. Extension AV France (16/07/2026) — Sogécap, Le Conservateur, Oradéa

- **Sogécap** (`av-fr-sogecap-catalog`) : portail PRIIPS statique
  `priips.sogecap.com/priips/sogecap.html` — 1 requête = tout l'arbre contrat →
  supports (`cdproduit`/`cdisine`), 10 contrats (~415 ISIN : Séquoia, Ébène ±capi,
  Érable Essentiel, Sogécapi, gamme SG Gestion Privée). Sans anti-bot, régénéré
  quotidiennement. DIS/KID par support via l'API AMFINE `epr.amfinesoft.com`
  (clé embarquée dans la page).
- **Oradéa Vie ressuscité** : la « décommission » du 13/07 était en fait un
  déménagement sur la même infra Sogécap (`…/priips/oradea.html`, repéré via la
  CSP du portail). Désormais **granulaire par contrat** (8 produits, ~1 119
  ISIN dont Oradéa Multisupport). L'ancien agrégat « Oradéa Vie (gamme
  courtage) » (916 lignes) a été purgé au profit du per-contrat.
- **Le Conservateur** (`av-fr-conservateur-catalog`) : PDF « Tableau
  d'information UC » loi PACTE par code produit (M40 = Hélios Patrimoine/Capi,
  M41 = Épargne Retraite PER, M42 = Privilège/Capi Privilège), ~54 ISIN.
  ⚠ millésime : URL résolue via `wp-json/wp/v2/media?search=Tableau-d-information`
  en triant sur le suffixe `-MMAA.pdf` du nom de fichier (PAS sur la date
  d'upload WP — une vieille édition peut être re-téléversée après la neuve).
- **Restes FR documentés** : Matmut Vie & Neuflize Vie (aucune source publique,
  quarantaine 15/07 maintenue) ; Mutavie/MIF/SMAvie/Milleis (marginaux en UC).

## 8quater. Mapping PER (16/07/2026)

Le type `per` est déduit du NOM de contrat (regex `retraite|per|perin|pero|perp|
madelin`, migration `20260611270000`) — nommer les contrats en conséquence
(ex. « PER Assurance Perspective », pas « Perspective » seul). Couverture
passée de 53 contrats / 17 assureurs à **87 contrats / 24 assureurs** :

| Assureur (`company_name`) | Scraper | Source | Contrats |
|---|---|---|---|
| Crédit Agricole Assurances Retraite | `av-fr-caar-catalog` | ca-assurances-retraite.com (FRPS ex-Predica, clone WP de predica.com — WP REST → PDF) | PER Assurance Perspective, LCL Retraite PER (~303 ISIN) |
| CNP Retraite | `av-fr-cnp-dic-catalog` | **API JSON publique `dic.cnp.fr/wkd-web/kid-webapi`** (sans anti-bot ; couvre aussi Nuances/EasyVie → pourrait remplacer les PDF d'av-fr-cnp-catalog) | Cachemire PER (LBP), PER CE (BPCE) (~172 ISIN) |
| AG2R La Mondiale | `av-fr-lmp-easypack` | Easypack Quantalys FRANCE `ag2rlm-easypack.quantalys.com/LMPEasypack` (jumeau du LMEP lux ; endpoint `/Recherche/Data`, per-bassin). ⚠ 1 042 bassins au total : seuls les ~41 retraite/PER sont câblés — le stock AV/capi France du groupe est une extension possible (élargir BASSIN_RE) | 41 contrats (Excellie Retraite GB ~1 351 UC = univers du PER Enedia, Prestige Retraite, Ambition Retraite…) (~2 535 ISIN) |
| MMA Vie / GMF Vie | `av-fr-covea-easypack` | Portails Quantalys par marque `infos-supports-investissement-{mma,gmf}.quantalys.com` (payload DataTables minimal + `id_contrat`). Couvre aussi les AV (MMA Multisupports id 1 = 44 UC > cap.mma.fr ; GMF Multéo id 1) → piste pour remplacer cleerly.fr | MMA PER Avenir, MMA Signature PER, PER Cadencéo (~164 ISIN) |
| Generali Retraite | `av-fr-generali-catalog` (étendu) | Annexe financière PDF gestion libre (hébergée meilleursper.com ; repli moniwan.fr) | Le PER Generali Patrimoine (~1 091 ISIN) |
| Sogécap | `av-fr-sogecap-catalog` (étendu) | Doc_Perf loi PACTE (contrat hors portail PRIIPS, URL découverte sur la page index) | PER Acacia (68 ISIN) |

Restes PER documentés : **Matla** (PER Boursorama, assuré Oradéa Vie — aucune
annexe publique trouvée, CG sans ISIN) ; e-PER Generali (table JS Altaprofits,
sous-univers probable du PER GPat) ; Préfon (produit à points, hors UC) ;
Monaliza Retraite Optimale (lancement 2025, à surveiller).

## 8quinquies. Mapping capitalisation (16/07/2026)

La plupart des contrats capi partagent l'annexe de leur jumeau vie et étaient
déjà captés (147 entrées / 22 assureurs à l'audit). Compléments :
- **AG2R La Mondiale** : `av-fr-lmp-easypack` étendu aux ~214 bassins
  CAPITALISATION de La Mondiale Partenaire (stock patrimonial courtage, fermés
  inclus — 1818 Partenaires Capi Opus 1 ~1 139 UC, gammes Anjou/Aster/Excellie
  Capi…). Les variantes à univers identique sont regroupées par contract_groups.
- **Generali Vie** : contrat « Himalia Capitalisation » ajouté (même annexe
  qu'Himalia, ~1 773 ISIN).
- **AFI ESCA Luxembourg** : « Cap Quality » renommé « Cap Quality
  (capitalisation) » (scraper + base) — sans le mot-clé, la détection de type
  (`capitalisation|\mcapi` sur le nom) le classait `av`.
- **Sans objet** (pas d'offre capi individuelle notable) : mutuelles
  (MAIF/MACIF/GMF/MAAF/Garance/Carac…), entités retraite (CAAR, CNP Retraite,
  Generali Retraite), assureurs lux à univers global (déjà couverts par nature).
- **Chez Joseph** : APICIL Intencial (Liberalys Capitalisation…).
