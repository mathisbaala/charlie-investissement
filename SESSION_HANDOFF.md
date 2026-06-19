# 📋 Session Handoff — 19 juin 2026

> Journée dense : **24 commits** poussés sur `main` (auto-déploy Vercel). Sprints DDA
> (alpha vs indice, durabilité, look-through), rafraîchissements de données planifiés,
> nettoyage de l'univers, et surtout : **analyse de DICI remise en service + rapport
> de fonds design + durcissement des coûts IA**.
>
> Doc précédente (19 mai) archivée dans `docs/bilans/`.

---

## 🎯 Ce qui a été livré aujourd'hui (par chantier)

### 1. Analyse de DICI + rapport de fonds design  *(chantier principal de fin de journée)*
- **Bug racine résolu** : la clé `ANTHROPIC_API_KEY` en prod était **invalide** (`401 invalid x-api-key`) → toutes les fonctionnalités IA tombaient (DICI, chat, recherche NLP). Clé remplacée dans Vercel + redéployée → **tout refonctionne**.
- **Erreurs honnêtes** : l'UI affichait « DICI invalide » pour *toute* panne. Désormais distinction `422 unreadable` (document) vs `503 ai_unavailable` (service/clé) ; la recherche NLP ne retombe plus silencieusement sur `{}` sans trace.
- **Rapport DICI design** (`/documents`) : upload PDF → `DiciReport` (hero, KPI, objectif, **scénarios de performance KID** en barres dégradées, jauge SRI, frais, risques) **+ enrichissement « données de marché »** du fonds rattaché en base (courbe VL `NavChart`, sous-jacents géo/secteur `CompositionCard`, volatilité/Sharpe/drawdown). Extraction enrichie (scénarios + coûts).
- Commits : `a0a2bb6` (rapport), `b3b6e0c` (coûts IA, ci-dessous).

### 2. Durcissement des coûts IA  *(site public → ne pas vider les tokens)*
- **Plafond GLOBAL journalier** (toutes IP) en plus du plafond par IP → mur dur contre une attaque distribuée. Env `AI_GLOBAL_DAY_LIMIT` (**prod = 60**, cible ~20 €/mois).
- **IP de comptage non usurpable** : `x-real-ip` / `x-vercel-forwarded-for` d'abord (le 1er maillon de `x-forwarded-for` était spoofable et contournait le quota).
- **Garde taille PDF** (`DICI_MAX_BYTES`, défaut 3 Mo) + validation magie `%PDF` **avant** tout appel modèle (un PDF de 600 pages = facture énorme).
- RPC `inv_ai_rate_limit` étendue (`p_global_day_limit`), rétro-compatible.

### 3. Benchmark / Alpha vs indice / Perf nette  *(sprint 1 DDA)*
- Généralisation du calcul d'écart fonds/indice **au-delà des ETF** : catalogue d'indices + règles d'affectation en base, `alpha_*` et `benchmark_perf_*` par fenêtres, `benchmark_is_category` (indice exact vs indice de catégorie). Perf nette de frais de contrat (`PerfNetteCard`).
- **Indices obligataires + actions euro** ajoutés (proxies ETF accumulants) → alpha obligataire 0→1609, monétaire 0→137 ; proxies HY/EM dédiés + exclusion des hybrides + plafond d'alpha resserré (±10 %/an oblig vs ±30 actions).
- Fixes : `is_category` réservé aux vrais trackers ; doublon d'affichage « Indice indice net TR » sur la fiche.
- Commits : `f2cb1be`, `fde325b`, `6f88120`, `9a8a255`, `3f27bf4`.

### 4. Recueil DDA / durabilité  *(sprint 2)*
- SFDR + labels officiels (ISR/Greenfin/Finansol), carte fiche `DurabiliteCard`, filtre screener (jsonb `@>`), préférence profil « labellisé », colonnes MiFID (taxonomie / inv. durable / PAI) enrichies en fond. Commit `c234f5f`.

### 5. Look-through portefeuille  *(sprint 3)*
- Section « Exposition agrégée » inline sous la comparaison (≤4 fonds équipondérés) → géo/secteur agrégés + détection de doublons. Sourcing des compositions priorisé par référencement. Commits `1d6e2c6`, `ea4aa6d`, `1504a1b`.

### 6. Données & fraîcheur (rafraîchissements planifiés)
- **Crypto** : refresh hebdo (CoinGecko en `requests`) — `93a2832`.
- **Fonds euros** : refresh annuel, fenêtre d'années **dynamique** (fini le figé 2022-2024) — `f560e92`.
- **SCPI** : métriques trimestrielles (Primaliance en `requests`/`parsel`, fini `scrapling` qui cassait en CI) + **prix de part** affiché sur la fiche — `bff5daf`, `4fe2761`, `7d86f58`.
- **OPCVM étrangers** : perfs Morningstar EMEA en refresh mensuel (~706 fonds LU/IE sans autre source) — `8fe54ad`.
- **GECO (OPCVM FR)** : couverture **hebdo complète** (~10,7k) + **cache ISIN→idInterne** (≈3× moins d'appels AMF) + dédup des dates avant upsert — `b06dfb4`, `d2bccde`, `35948fb`.

### 7. Classification & nettoyage de l'univers
- Reclassement **~6 233 véhicules** mal classés `opcvm` : 5 479 → `fps` (PE/alternatifs), 754 → `structuré` (nouveau type, exclu du screener) — `0113129`.
- Garde **OpenFIGI** : reclasser les titres vifs (actions/REIT) ingérés en `opcvm` — `f2f183b`.

### 8. CI / sécurité / infra
- Credentials Morningstar EMEA → **secrets** (plus en dur) + bump `actions/checkout@v5` / `setup-python@v6` (Node 20 EOL) — `cfbc72a`.
- Groupe de concurrence dédié pour la garde de classification (évitait l'annulation de runs) — `c60e0ed`.

---

## ✅ Problèmes résolus aujourd'hui

| Problème | État |
|---|---|
| Clé Anthropic invalide en prod → toute l'IA KO | **Résolu** (clé remplacée, déployée, vérifiée) |
| Analyse DICI non fonctionnelle | **Résolu** (parse + rattachement + rapport, vérifié bout en bout en prod) |
| Erreur IA masquée en « DICI invalide » | **Résolu** (422 vs 503, messages dédiés) |
| Site public exposé au drainage de tokens | **Résolu** (plafond global + cap PDF + IP non usurpable) |
| Alphas obligataires aberrants (NAV cassées, proxies trop loin) | **Résolu** (proxies dédiés, plafonds, td-enricher autoritaire) |
| Doublon « Indice indice net TR » sur la fiche | **Résolu** |
| Faux TER SCPI / overflow prix de part | **Résolu** |
| Dates dupliquées dans la série GECO (upsert) | **Résolu** |
| Fonds euros figés sur 2022-2024 | **Résolu** (fenêtre dynamique) |
| ~6 233 PE/structurés gonflant le screener | **Résolu** (reclassés fps/structuré) |

---

## 🟢 État opérationnel actuel (prod)

- **Frontend** : Next.js 16 sur Vercel, auto-déploy au push `main`. Domaine `charlie-investissement.vercel.app`.
- **IA opérationnelle** sur 4 routes (`/api/parse`, `/api/dici/parse`, `/api/chat`, `/api/parse-profile`) — clé valide, vérifié 200 partout.
- **DICI live** : upload → rapport design + enrichissement marché. Vérifié end-to-end (upload navigateur réel) sans erreur console.
- **Garde-fous coût actifs** : par IP (`AI_HOUR_LIMIT`/`AI_DAY_LIMIT` = 25/25), GLOBAL (`AI_GLOBAL_DAY_LIMIT` = 60), taille PDF (`DICI_MAX_BYTES` = 3 Mo), validation `%PDF`. Tous réglables via env Vercel (redeploy requis).
- **Modèles** : extraction DICI + recherche/profil sur **Haiku 4.5** (cheap) ; chat sur **Sonnet 4.6**.
- Logs serveur Vercel : 0 erreur depuis le fix clé.

---

## ⚠️ Pièges à éviter (à jour)

1. **Clé Anthropic** : la régénérer dans un **Workspace avec spend limit mensuelle** (Console) = seul plafond dur garanti au centime. ACTION en attente (voir prochains chantiers).
2. **Recalcul td-enricher** (benchmark/alpha) : relancer **APRÈS** le code `map_index` final, sinon alphas obsolètes (cf. mémoire `alpha-bonds-euro-indices`).
3. **Scrapers en seeding** : NE PAS les lancer en mode upsert global (destructif). Les enrichers sont fill-only ; les refreshs ciblent des colonnes précises.
4. **`.env` locaux = stubs** : vérif locale = `tsc` + `vitest` (pas de build complet, pas d'appel DB/IA réel). Credentials réels = env Vercel.
5. **Rate-limit fail-open** : une panne de comptage laisse passer (on ne casse pas le produit) → le plafond Anthropic reste le filet ultime.
6. **Morningstar EMEA** : credentials en secrets CI ; 1 worker (blocage IP).
7. **Vue cgp** : le screener exclut `action`/`crypto`/`fps`/`structuré` (sinon offre sur-annoncée).

---

## 🚧 Prochains chantiers (pour repartir)

- **[ACTION utilisateur]** Faire tourner la clé Anthropic exposée + la recréer dans un Workspace avec spend limit 20 €.
- **SCPI prix de part** : source unique = scrape Primaliance (pas d'API) → couverture à étendre.
- **Actions individuelles** : 0 prix en base (pas de source câblée).
- **Look-through** : couverture compositions ~3 % → faire monter via le gap-fill mensuel `ft-enricher --fill-breakdowns --by-referencing`.
- **Sécurité Supabase** : activer la *leaked-password protection* (dashboard) — dernier point du durcissement.
- **Presets d'accès rapide CGP** : proposés mais EN ATTENTE (mode collecte) — ne pas re-proposer sans signal.
- **Audit PEA large** : heuristique d'éligibilité par le nom (pas de source officielle).

---

## 📚 Documentation

- `SESSION_HANDOFF.md` ← ce fichier (état courant)
- `docs/bilans/bilan-2026-06-19.md` ← bilan daté du jour
- `docs/SCRAPER_MAP.md` ← carte des sources + **rafraîchissements planifiés** (section juin 2026)
- `docs/kid-parsing-runbook.md` ← parsing KID en masse + renvoi rapport DICI live
- `docs/data-standards-v3.md` ← conventions de données
- Mémoire projet (`~/.claude/.../memory/`) : `dici-report`, `ai-rate-limit`, `alpha-bonds-euro-indices`, `scheduled-refresh`, `data-freshness-volets`, etc.
