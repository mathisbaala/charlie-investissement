# Charlie Investissement

Base de données financières pour CGPs indépendants français. 35 988 instruments (OPCVM, ETF, SCPI, actions, crypto, livrets, fonds euros).

## Structure

```
scripts/        Scripts Python — scrapers, enrichisseurs, bilan
docs/           Documentation et handoff notes
data/           Données traitées (raw/ exclu du git)
```

## Setup

```bash
pip install -r scripts/requirements.txt
python3 scripts/bilan-daily.py   # état de la base
```

## Base de données

Supabase — voir `.env` (non versionné).
