# Charlie Investissement

Base de données financières pour CGPs indépendants français (~36 000 instruments :
OPCVM, ETF, SCPI, actions, crypto, livrets, fonds euros) **+ application web** de
recherche, analyse et aide au conseil.

## Structure

```
app/            Application Next.js 16 (front + API routes) — déployée sur Vercel
scripts/        Scripts Python — scrapers, enrichisseurs, bilan
docs/           Documentation et handoff notes
data/           Données traitées (raw/ exclu du git)
```

## Application web (`app/`)

Déployée sur Vercel (auto-deploy au push `main`). Domaine principal : `www.charliewealth.fr` (l'apex `charliewealth.fr` redirige en 308 ; `charlie-investissement.vercel.app` reste actif).
Fonctionnalités principales :

- **Screener** : recherche multi-critères + tri + recherche en langage naturel (Claude).
- **Fiche fonds** : perfs, risque (SRI), frais, **alpha vs indice & perf nette**, durabilité
  (SFDR / labels), composition (sous-jacents), référencement assureurs.
- **Comparaison + look-through** : exposition agrégée géo/secteur d'un portefeuille, doublons.
- **Profil client** → pré-filtrage du screener.
- **Documents (`/documents`)** : dépôt d'un DICI/KID → **rapport de fonds design** (scénarios,
  frais, sous-jacents) — voir `docs/kid-parsing-runbook.md` et la mémoire `dici-report`.
- **Chat IA** actionnable (tool use sur les vraies données).

Garde-fous IA (site public) : rate-limit par IP + plafond global journalier + cap taille PDF.
Détails dans `SESSION_HANDOFF.md` et la mémoire `ai-rate-limit`.

Tests app : `cd app && npm test` (vitest). Vérif type : `npx tsc --noEmit`.
Note : les `.env` locaux sont des stubs ; pas de build/DB/IA réel en local.

## Setup

```bash
pip install -r scripts/requirements.txt
python3 scripts/bilan-daily.py   # état de la base
```

## Base de données

Supabase — voir `.env` (non versionné).
