# Anti-scraping — P2 : Vercel WAF / Bot Management (guide console)

> Couche **infra**, au-dessus des couches applicatives déjà en place. Config
> console Vercel, **zéro code**. C'est toi qui cliques (je n'ai pas d'outil pour
> piloter le WAF). ~15-20 min. Réversible à tout moment.

## Ce qui est déjà fait (couches applicatives, code)

| Couche | Quoi | Où |
|---|---|---|
| 1 — Rate-limit | Plafonds par IP (minute + heure) sur les endpoints data | `lib/rateLimit.ts` → `dataRateLimit()` |
| 1 — Cap pagination | Offset profond → page vide sans requête DB | `api/funds/route.ts` → `MAX_OFFSET` |
| 2 — Filtre anti-bot | 403 sur UA non-navigateur (curl, python-requests, scrapy…) | `lib/rateLimit.ts` → `botGuard()` |
| Verrou base | `anon` n'a aucun accès aux tables `investissement_*` | migration `20260629140000` |

Ces couches arrêtent le scraping **paresseux** (scripts naïfs) et **bornent** le
soutenu. Le WAF ci-dessous arrête le scraping **déterminé** (UA usurpé, IP
tournantes, navigateurs headless) — ce que le code seul ne peut pas voir.

## Réglages env utiles (Vercel → Settings → Environment Variables)

Tunables sans redéploiement de code (un redeploy Vercel suffit) :

- `BOT_FILTER_ENABLED` = `0` pour couper le filtre UA (debug). Défaut : actif.
- `BOT_UA_EXTRA` = signatures supplémentaires, ex. `headlesschrome,acme-bot`.
  (On NE met PAS `headlesschrome` par défaut pour ne pas bloquer les moniteurs
  légitimes / outils de QA ; à ajouter ici si tu veux durcir.)
- `DATA_MIN_LIMIT` / `DATA_HOUR_LIMIT` : plafonds rate-limit data (défaut 100/min,
  1800/h). Baisser si tu veux serrer la vis.
- `DATA_MAX_OFFSET` : profondeur de pagination autorisée (défaut 5000).

## P2 — Étapes console Vercel

### 1. Activer le WAF / Firewall
Vercel → projet **charlie-investissement** → onglet **Firewall** (ou **Security**).
- Le **Vercel Firewall** (règles WAF) est dispo sur le plan actuel (inclut un
  socle managé). **Bot Management** avancé peut nécessiter Pro/Enterprise — vérifier
  le bandeau d'upsell le cas échéant.

### 2. Attack Challenge Mode (le bouton « panic »)
- **Firewall → Attack Challenge Mode → Enable.**
- Effet : chaque visiteur passe un challenge JS/preuve-de-travail transparent
  avant d'atteindre l'app. Tue les bots sans navigateur réel.
- ⚠️ Ajoute une micro-latence au 1er chargement + peut gêner de vrais outils.
  **À garder OFF en temps normal, ON en cas d'attaque active.**

### 3. Règles WAF ciblées sur les endpoints data (le cœur du P2)
Firewall → **Rules → Add Rule**. Créer 2-3 règles :

**Règle A — Rate-limit infra sur l'API data** (double le rate-limit applicatif au
niveau edge, avant même d'atteindre la fonction) :
- If `Request Path` *starts with* `/api/funds` OR `/api/fonds`
- Then **Rate Limit** : ex. 120 req / 1 min par IP → **Action : Challenge** (ou Deny).

**Règle B — Bloquer les UA d'outils** (filet edge en plus de `botGuard`) :
- If `Request Path` *starts with* `/api/`
- And `User-Agent` *matches* `(?i)(python-requests|curl|scrapy|wget|go-http-client|httpx|okhttp)`
- Then **Deny** (403).

**Règle C — (optionnel) Restreindre par origine** :
- If `Request Path` *starts with* `/api/funds`
- And `Referer` *does not contain* `charliewealth.fr`
- Then **Challenge**.
- ⚠️ Tester d'abord en **Log** (pas Deny) : certains navigateurs/proxys
  n'envoient pas de Referer → risque de faux positifs.

### 4. Toujours commencer en mode observation
Chaque règle Vercel peut être posée en **action `Log`** avant `Deny`/`Challenge`.
- Poser les règles en **Log** pendant 24-48 h.
- Consulter **Firewall → Observability** : volume touché, IP/UA, faux positifs.
- Basculer en `Deny`/`Challenge` une fois sûr que les vrais utilisateurs ne sont
  pas pris.

## Garde-fous (ne pas se tirer une balle dans le pied)

- **Ne jamais** poser une règle `Deny` large directement en prod sans passe `Log`.
- **Exclure** les chemins SEO/preview : ne cibler que `/api/*` (les crawlers
  Google/LinkedIn visent le HTML des pages, pas l'API → ne pas les toucher).
- Garder `BOT_FILTER_ENABLED` activable à `0` comme issue de secours si une règle
  applicative gêne un usage légitime.

## Ce qui reste hors périmètre (à arbitrer si un jour besoin)
- **Cloudflare en frontal** (cran au-dessus, mais change l'archi DNS/proxy).
- **Signature de requête SPA** (header secret signé) : robuste mais fragile à
  maintenir et copiable depuis l'onglet réseau — faible gain vs WAF.
- **Fingerprinting comportemental** (détection par cadence de navigation) : lourd,
  réservé à un vrai problème d'abus avéré.
