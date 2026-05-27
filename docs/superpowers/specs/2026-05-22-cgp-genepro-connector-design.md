# Design — Connecteur CGP Generali Genepro (Sprint 1)
_Date : 2026-05-22_

## Contexte

Charlie est une plateforme SaaS multi-tenant pour CGP français. Chaque cabinet CGP
gère un portefeuille de clients investis sur des contrats d'assurance-vie. Ce sprint
construit le premier connecteur d'ingestion de données de portefeuille client : Generali
Patrimoine via son extranet Genepro.

## Décision d'architecture

**Import manuel PDF/CSV** pour le sprint 1.
Le CGP exporte ses relevés de situation depuis Genepro et les uploade dans Charlie.
L'automatisation (scraping Genepro) est reportée au sprint 2 — elle nécessite une
gestion de credentials et de session browser qui complexifie inutilement le premier cycle.

## Schéma de données (4 nouvelles tables Supabase)

```
cgp_clients         — un client par CGP
cgp_contracts       — un contrat AV par client
cgp_positions       — positions par contrat × date de relevé
cgp_transactions    — mouvements (versements, rachats, arbitrages)
```

Chaque `cgp_positions.isin` se joint à `investissement_funds.isin` pour hériter
du TER, SRI, SFDR, performance, asset_class sans duplication.

## Périmètre du parser Genepro

Input : PDF "Relevé de situation" Generali Patrimoine (format standard Genepro).
Extraction :
- En-tête : nom client, N° contrat, date de valorisation, valeur totale
- Table positions : libellé, ISIN, nb parts, VL, valeur €, %
- Table transactions : date, type, support, montant

## Fichiers produits

- `scripts/migrations/create-cgp-tables.sql`
- `scripts/parsers/genepro_parser.py`
- `scripts/importers/genepro-import.py`

## Critères de succès

- Un PDF Genepro importé avec `--apply` insère les lignes dans les 4 tables
- Chaque position est joignable à `investissement_funds` via ISIN
- Dry-run affiche un aperçu sans écrire
- Import idempotent (réimporter le même fichier ne duplique pas)

## Suite (sprint 2)

Réplication du pattern sur BNP Cardif (Finagora), Suravenir, Spirica.
Automatisation scraping Genepro avec session Playwright + credentials chiffrés.
