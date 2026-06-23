-- Démasquage des PERFS à source externe directe (sans série de prix locale) ─────
-- Contexte : la garde de fraîcheur du 23/06 (`inv_prices_stale`, migration
-- 20260623120000) masque toutes les métriques dérivées d'un opcvm/etf/crypto dès
-- que la série de prix locale est absente/périmée/minuscule. Son but : ne plus
-- afficher une perf FOSSILE calculée chez nous sur 2 points morts (ex. -79 %).
--
-- Effet de bord (faux positif) : ~860 OPCVM étrangers (LU/IE) — dont ~510 primaires
-- ≥50 M€ — n'ont JAMAIS eu de série de prix locale. Leur perf n'est donc PAS un
-- fossile maison : elle vient d'une source externe DIRECTE (régulateur AMF GECO,
-- catalogues assureurs, Morningstar EMEA) qui publie un nombre officiel. La garde
-- les masquait à tort. Un contre-contrôle Bloomberg les CONFIRMERAIT (moyenne
-- +14,9 %/1 an, saines), à l'inverse des fossiles qu'elle vise.
--
-- Décision (23/06) : démasquer UNIQUEMENT les 3 perfs (1/3/5 ans) — pas vol/
-- sharpe/drawdown/alpha/average, dont la provenance reste incertaine pour ces
-- fonds — quand TOUTES les conditions sont réunies :
--   (a) aucune série de prix LOCALE (cov.last_price_date IS NULL) → la perf ne
--       PEUT PAS être un fossile maison, elle est forcément externe ;
--   (b) fonds activement maintenu (updated_at > current_date − 150) → un fonds
--       abandonné (délisté) se re-masque tout seul après ~5 mois ;
--   (c) valeur SAINE, bornée par métrique (écarte les ~5 aberrantes résiduelles) :
--         perf_1y ∈ [−60, 200], perf_3y cumulé ∈ [−90, 1000], perf_5y ∈ [−95, 1000].
-- Le vrai cas fossile (série locale PRÉSENTE mais morte >45 j / minuscule <8 pts)
-- reste masqué : `__ext_fresh` exige `last_price_date IS NULL`, pas une série morte.
--
-- Pourquoi pas un gate sur la provenance (field_sources->>'performance_1y') :
-- vérifié en base, 382/498 cibles n'ont AUCUNE provenance estampillée, et là où
-- elle l'est c'est `amf-geco`/`boursorama`, pas une source unique exploitable.
-- Le signal STRUCTUREL « pas de série locale » est, lui, fiable et exhaustif.
--
-- Périmètre/risque : on n'affaiblit PAS la garde sur les fossiles maison (série
-- présente). On démasque ~880 perfs externes saines (≈510 primaires ≥50 M€).
-- Colonnes/noms/ordre/types inchangés → cgp_ref & inv_funds_search (héritage par
-- SELECT *) intacts. Miroir TS : aucun (la garde est 100 % SQL ; le front lit la vue).

CREATE OR REPLACE VIEW investissement_funds_cgp AS
 SELECT isin,
    name,
    product_type,
    asset_class_broad,
    asset_class,
    category_normalized,
    region_normalized,
    sector,
    management_style,
    management_company_normalized AS gestionnaire,
    aum_eur,
    currency,
    inception_date,
    track_record_years,
    ter,
    ongoing_charges,
    entry_fee_max,
    exit_fee_max,
    performance_fee,
    retrocession_cgp,
    holding_period_years,
    -- Perfs : masquées si la garde est active SAUF pour une perf externe fraîche
    -- ET saine (borne par métrique). Démasquage par colonne → un 3 ans aberrant
    -- ne traîne pas un 1 an sain, et inversement.
    (CASE WHEN __stale AND NOT (__ext_fresh AND performance_1y >= -60  AND performance_1y <= 200)
          THEN NULL ELSE performance_1y END)::numeric(8,4) AS performance_1y,
    CASE WHEN __stale AND NOT (__ext_fresh AND performance_3y >= -90  AND performance_3y <= 1000)
         THEN NULL ELSE inv_annualize_pt(performance_3y, 3::numeric, product_type) END AS performance_3y,
    CASE WHEN __stale AND NOT (__ext_fresh AND performance_5y >= -95  AND performance_5y <= 1000)
         THEN NULL ELSE inv_annualize_pt(performance_5y, 5::numeric, product_type) END AS performance_5y,
    -- Le reste des métriques dérivées garde la règle d'origine (jamais démasqué) :
    -- provenance non garantie pour les fonds sans série.
    (CASE WHEN __stale THEN NULL ELSE average_performance END)::numeric(8,4) AS average_performance,
    (CASE WHEN __stale THEN NULL ELSE volatility_1y END)::numeric(8,4) AS volatility_1y,
    (CASE WHEN __stale THEN NULL ELSE volatility_3y END)::numeric(8,4) AS volatility_3y,
    (CASE WHEN __stale THEN NULL ELSE sharpe_1y END)::numeric(8,4) AS sharpe_1y,
    (CASE WHEN __stale THEN NULL ELSE sharpe_3y END)::numeric(8,4) AS sharpe_3y,
    (CASE WHEN __stale THEN NULL ELSE max_drawdown_1y END)::numeric(8,4) AS max_drawdown_1y,
    (CASE WHEN __stale THEN NULL ELSE max_drawdown_3y END)::numeric(8,4) AS max_drawdown_3y,
    sri AS risk_score,
    sfdr_article,
    labels,
    pea_eligible,
    pea_pme_eligible,
    per_eligible,
    av_fr_eligible,
    av_lux_eligible,
    cto_eligible,
    ucits_compliant,
    is_institutional,
    CASE
        WHEN is_institutional IS FALSE OR is_institutional IS NULL THEN true
        ELSE false
    END AS accessible_retail,
    hedged,
    morningstar_rating,
    share_class_group_id,
    kid_url,
    kid_parsed_at,
    data_completeness,
    data_source,
    field_sources,
    updated_at,
    is_primary_share_class,
    tickers,
    tickers_search,
    allocation_profile,
    benchmark_index,
    benchmark_variant,
    benchmark_is_category,
    (CASE WHEN __stale THEN NULL ELSE alpha_1y END)::numeric(8,4) AS alpha_1y,
    (CASE WHEN __stale THEN NULL ELSE alpha_3y END)::numeric(8,4) AS alpha_3y,
    (CASE WHEN __stale THEN NULL ELSE alpha_5y END)::numeric(8,4) AS alpha_5y
   FROM (
     SELECT f.*,
            public.inv_prices_stale(cov.last_price_date, cov.n_points, f.product_type) AS __stale,
            -- Perf externe « démasquable » : aucune série locale (donc pas un
            -- fossile maison) ET fonds encore maintenu. La sanité par borne est
            -- appliquée colonne par colonne ci-dessus.
            (cov.last_price_date IS NULL AND f.updated_at > (current_date - 150)) AS __ext_fresh
       FROM investissement_funds f
       LEFT JOIN investissement_fund_price_coverage cov ON cov.isin = f.isin
   ) f;
