-- CORRECTIF de la migration 20260629140000 : son REVOKE ALL ON ALL TABLES FROM
-- anon avait une portée trop large et a frappé 3 tables d'apps sœurs Charlie
-- (hors univers investissement) qui ont des policies anon LÉGITIMES :
--   - charlie_dossier            : policy ALL public USING(true)/WITH CHECK(true)
--   - waitlist                   : policy INSERT public
--   - waitlist_survey_responses  : policy INSERT public
-- On restaure les grants anon que ces policies impliquent (DML uniquement,
-- PAS de TRUNCATE qui contourne la RLS). Les 4 tables screener_* gardent leur
-- état révoqué : elles ont une policy deny_all (qual=false) → fermées par design.
-- L'anti-scraping reste intact : aucune table investissement_* n'est re-grantée.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.charlie_dossier TO anon;
GRANT INSERT ON public.waitlist TO anon;
GRANT INSERT ON public.waitlist_survey_responses TO anon;

-- INSERT sur waitlist_survey_responses a besoin de sa séquence d'identité.
GRANT USAGE, SELECT ON SEQUENCE public.waitlist_survey_responses_id_seq TO anon;
