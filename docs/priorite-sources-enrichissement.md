# Priorité des sources d'enrichissement

But : lever l'ambiguïté « qui gagne quand plusieurs sources écrivent la même
donnée ? ». Aujourd'hui l'écriture est en **`upsert` last-write-wins** sur la clé
naturelle (ex. `investissement_fund_prices(isin, price_date)`), donc c'est
**l'ordre d'exécution des crons** qui tranche — implicite et fragile. Ce document
fixe la priorité *cible*. Tant qu'elle n'est pas codée dans les enrichers, elle
sert de convention de revue.

## Prix / VL (`investissement_fund_prices`)

| Rang | Source | Périmètre | Cron |
|------|--------|-----------|------|
| 1 | **GECO (AMF)** | OPCVM FR (source quasi-primaire) | weekly + geco-nav |
| 2 | **Financial Times** | OPCVM étrangers (LU/IE), rotation top-4000 | weekly / monthly |
| 3 | **JustETF** | ETF (filet + AUM/TER) | weekly |
| — | Yahoo | dépannage indices/ETF only | ponctuel |

Règle : une VL GECO du même `price_date` ne doit **jamais** être écrasée par FT.
Convention d'implémentation recommandée : écrire par ordre de rang **croissant**
et passer les enrichers de rang > 1 en `--fill-only` (n'écrit que si trou).

## Composition / holdings (`investissement_fund_holdings`, `_geos`, `_sectors`)

| Rang | Source | Périmètre |
|------|--------|-----------|
| 1 | **Émetteurs** (iShares/Amundi/Xtrackers/Invesco) | ETF de la maison — constituants intégraux |
| 2 | **Morningstar EMEA** | OPCVM (couverture large, y.c. non-notés) |
| 3 | **Financial Times** | ventilation géo/secteur de repli |
| 4 | **JustETF** | ETF sans données émetteur |

Règle : ne pas mélanger deux sources pour un même fonds. La source la mieux
classée **disponible** prend tout ; les rangs inférieurs sont `fill-only`.

## Frais / SRI / SFDR

| Champ | Source faisant autorité | Repli |
|-------|-------------------------|-------|
| TER / frais entrée-sortie / SRI / période détention | **KID/DICI PRIIPs** (légal) | Morningstar EMEA, JustETF |
| Article SFDR + PAI | **Annexe précontractuelle SFDR** | KID (moins fiable) |
| Frais de contrat AV/PER | **DIC + grille tarifaire distributeur** | — |

Le KID fait autorité légale : ses champs ne sont jamais écrasés par une source
secondaire (les enrichers frais tournent en `fill-only`).

## À faire (dette technique)

- [ ] Matérialiser ces rangs dans les enrichers (passer les sources secondaires
  en `--fill-only` explicite plutôt que de compter sur l'ordre des crons).
- [ ] Journaliser la source retenue par champ (`field_sources`) pour tracer les
  divergences au lieu de les subir silencieusement.
