# Référencement Assurance-Vie — système & runbook

> Doc de référence du système de référencement UC↔contrat d'assurance-vie.
> Dernière mise à jour : 2026-06-21. Complète `docs/data-collection-playbook.md`
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

**Actifs (job HTTP)** : `av-fr-{allianz,axa,cardif,mutualistes,oradea,spirica,suravenir,swisslife}`,
`av-lux-{apicil-onelife,axa-wealtheurope,baloise,generali,swisslife,utmost,vitislife,wealins}`,
`av-lux-opcvm360 --all` + `--dynamic`. *(Tier 3 : bancassureurs FR ajoutés en parallèle — cf. §8.)*

**Actifs (job navigateur)** : `av-lux-linxea-catalog` (JWT Morningstar via navigateur),
`av-lux-cardif-lux-vie-catalog` (APIs SPA en session).

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
- **Valider sans DB** : `--apply` absent = dry-run (ne touche pas `get_client`) ; sonder
  d'abord avec `curl_cffi`. Creds réels = secrets CI → run `workflow_dispatch` pour le bout-en-bout.

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
