-- ============================================================================
-- Perf : retirer le COALESCE qui désactivait l'index GIN du référencement
-- ----------------------------------------------------------------------------
-- La vue investissement_funds_cgp_ref exposait
--   COALESCE(m.insurers,  '{}') AS insurers
--   COALESCE(m.contracts, '{}') AS contracts
-- Le COALESCE enveloppe la colonne indexée → le planificateur ne peut PAS
-- utiliser les index GIN i_fund_insurers_mv_{insurers,contracts} : un filtre
-- screener `contracts && {…}` / `@> {…}` retombait en double Seq Scan
-- (matview + investissement_funds), ~3,8 s à froid sur un gros contrat.
--
-- Pour un filtre POSITIF (overlaps / contains), NULL s'évalue à NULL donc les
-- fonds non référencés sont déjà écartés — le COALESCE n'apportait rien au
-- filtrage, seulement un `[]` à l'affichage. Or le contrat Fund type déjà
-- `insurers/contracts: string[] | null` et tous les consommateurs sont
-- null-safe (InsurerChips `insurers ?? []`, FilterPanel `f.contracts ?? []`,
-- ReferencementCard `fund.insurers ?? []`). On renvoie donc directement la
-- colonne ; le LEFT JOIN + filtre `m.contracts @> {…}` bascule alors sur
-- Bitmap Index Scan (GIN) + Nested Loop via PK (plan vérifié).
--
-- CREATE OR REPLACE VIEW : mêmes noms/types/ordre de colonnes (text[] inchangé),
-- seule l'expression change → pas de drop, la dépendance reste intacte.
-- ============================================================================

CREATE OR REPLACE VIEW investissement_funds_cgp_ref AS
SELECT c.isin, c.name, c.product_type, c.asset_class_broad, c.asset_class,
    c.category_normalized, c.region_normalized, c.sector, c.management_style,
    c.gestionnaire, c.aum_eur, c.currency, c.inception_date, c.track_record_years,
    c.ter, c.ongoing_charges, c.entry_fee_max, c.exit_fee_max, c.performance_fee,
    c.retrocession_cgp, c.holding_period_years, c.performance_1y, c.performance_3y,
    c.performance_5y, c.average_performance, c.volatility_1y, c.volatility_3y,
    c.sharpe_1y, c.sharpe_3y, c.max_drawdown_1y, c.max_drawdown_3y, c.risk_score,
    c.sfdr_article, c.labels, c.pea_eligible, c.pea_pme_eligible, c.per_eligible,
    c.av_fr_eligible, c.av_lux_eligible, c.cto_eligible, c.ucits_compliant,
    c.is_institutional, c.accessible_retail, c.hedged, c.morningstar_rating,
    c.share_class_group_id, c.kid_url, c.kid_parsed_at, c.data_completeness,
    c.data_source, c.field_sources, c.updated_at,
    m.insurers  AS insurers,
    m.contracts AS contracts,
    c.is_primary_share_class
   FROM investissement_funds_cgp c
     LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin;

GRANT SELECT ON investissement_funds_cgp_ref TO anon, authenticated, service_role;
