-- Clôture chantier ETF↔OPCVM + durcissement RLS (2e vague), 2026-06-20.
-- Appliquée en prod via apply_migration (close_etf_opcvm_and_rls_internal_tables_20260620).

-- 1. Reclasser le seul vrai ETF mal classé en opcvm (iShares JP Morgan ESG $ EM
--    Bond UCITS ETF — nom collé « ETFEURHAcc » qui échappait au \metf\M).
--    Les 14 autres opcvm avec « ETF » dans le nom sont des fonds-de-fonds /
--    allocations légitimes ; OpenFIGI confirme 0 ETP parmi les opcvm typés.
--    Ancienne valeur : product_type='opcvm'.
UPDATE investissement_funds
SET product_type = 'etf'
WHERE isin = 'IE00BKP5L730' AND product_type = 'opcvm';

-- 2. Activer RLS (sans policy → anon/authenticated bloqués, service_role bypasse)
--    sur tables internes/backups exposées à PostgREST. Aucune n'est lue par l'app
--    Next (grep vide) ; seules les pipelines (service_role) y accèdent.
ALTER TABLE public.qa_backup_corp_reclass_20260619       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_backup_opcvm_reclass_20260619      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_backup_feq_perf_20260619           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investissement_geco_share_map         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investissement_figi_security_type     ENABLE ROW LEVEL SECURITY;
