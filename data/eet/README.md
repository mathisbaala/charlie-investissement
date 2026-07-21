# Dépôt des fichiers EET (European ESG Template)

Déposer ici les fichiers EET (CSV/XLSX, standard FinDatEx) publiés par les
sociétés de gestion, puis lancer :

```bash
python3 scripts/scrapers/esg-exclusions-enricher.py --dir data/eet/            # dry-run
python3 scripts/scrapers/esg-exclusions-enricher.py --dir data/eet/ --apply
```

Le parseur détecte les colonnes par MOTIFS d'en-tête (robuste aux versions
V1.0/V1.1.x du template) : ISIN + champs d'exclusion (tobacco, controversial
weapons, thermal coal/fossil, nuclear, gambling, alcohol, UNGC…). Il alimente
`investissement_funds.esg_exclusions` (fill-only : fonds existants, sans
écraser — `--overwrite` pour rafraîchir une nouvelle période).

## Où trouver les fichiers

L'EET n'a pas de point de diffusion central public — chaque SGP publie le sien :

- **Pages « informations de durabilité » / SFDR** des sites SGP (souvent un lien
  « EET » ou « European ESG Template » dans la doc réglementaire du fonds).
- **Schroders** publie ses EET/EPT/EMT en libre accès (page « European ESG
  Template data » du site pro).
- **fundinfo.com** (FE fundinfo) : plateforme de diffusion des EET de nombreuses
  SGP (recherche par ISIN).
- **fundkis.com/disclose/fr/ampere/eet** : diffusion EET au format Club Ampère
  (SGP françaises) — page rendue en JS, télécharger via navigateur.
- **BVI** (bvi.de) : modèles et docs de référence du template (pas de données).

Nommer les fichiers `<sgp>-<période>.csv` (ex. `amundi-2026-06.csv`) et passer
`--source <sgp> --as-of <YYYY-MM-DD>` pour tracer la provenance.
