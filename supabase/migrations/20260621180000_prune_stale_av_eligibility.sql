-- inv_prune_stale_av_eligibility — purge des liens d'éligibilité AV périmés (Tier 4).
--
-- Problème : investissement_av_lux_eligibility est upsert-only → quand un assureur
-- retire une UC d'un contrat, le lien (isin, contract_name) reste indéfiniment et
-- sur-annonce l'offre. On le « délistе » par fraîcheur du scrape.
--
-- SÛRETÉ (pour un outil CGP, un faux négatif — masquer une UC valide — est PIRE
-- qu'un lien un peu périmé) :
--   • on ne purge QUE les contrats encore activement scrapés (max_s récent),
--   • on ne supprime QU'un lien non revu depuis ≥ p_stale_days (défaut 100 j ≈
--     ≥1 cycle trimestriel manqué → délistage CONFIRMÉ, jamais une variance d'un
--     seul scrape),
--   • garde anti-scraper-cassé : si le contrat est majoritairement périmé
--     (fresh < p_min_fresh_frac × total), on NE purge PAS et on le signale.
-- Dry-run par défaut (p_apply=false) : renvoie le rapport sans rien supprimer.

DROP FUNCTION IF EXISTS inv_prune_stale_av_eligibility(boolean,int,int,numeric);

CREATE OR REPLACE FUNCTION inv_prune_stale_av_eligibility(
  p_apply boolean DEFAULT false,
  p_recent_days int DEFAULT 2,
  p_stale_days int DEFAULT 100,
  p_min_fresh_frac numeric DEFAULT 0.5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_catalog'
AS $$
DECLARE
  v_deleted int := 0; v_row int := 0;
  v_contracts_pruned int := 0; v_contracts_skipped int := 0;
  v_skipped jsonb := '[]'::jsonb; r record;
BEGIN
  FOR r IN
    WITH m AS (
      SELECT company_name, contract_name, max(scraped_at) AS max_s, count(*) AS total
      FROM investissement_av_lux_eligibility GROUP BY 1,2
    ),
    f AS (
      SELECT e.company_name, e.contract_name,
             count(*) FILTER (WHERE e.scraped_at >= now() - make_interval(days => p_stale_days)) AS fresh,
             count(*) FILTER (WHERE e.scraped_at <  now() - make_interval(days => p_stale_days)) AS stale
      FROM investissement_av_lux_eligibility e JOIN m USING (company_name, contract_name)
      GROUP BY 1,2
    )
    SELECT m.company_name, m.contract_name, m.total, f.fresh, f.stale
    FROM m JOIN f USING (company_name, contract_name)
    WHERE m.max_s >= now() - make_interval(days => p_recent_days)
      AND f.stale > 0
  LOOP
    IF r.fresh < p_min_fresh_frac * r.total THEN
      v_contracts_skipped := v_contracts_skipped + 1;
      v_skipped := v_skipped || jsonb_build_object('company', r.company_name, 'contract', r.contract_name,
        'fresh', r.fresh, 'stale', r.stale, 'total', r.total);
      CONTINUE;
    END IF;
    IF p_apply THEN
      DELETE FROM investissement_av_lux_eligibility e
      WHERE e.company_name = r.company_name AND e.contract_name = r.contract_name
        AND e.scraped_at < now() - make_interval(days => p_stale_days);
      GET DIAGNOSTICS v_row = ROW_COUNT;
      v_deleted := v_deleted + v_row;
    ELSE
      v_deleted := v_deleted + r.stale;
    END IF;
    v_contracts_pruned := v_contracts_pruned + 1;
  END LOOP;

  RETURN jsonb_build_object('applied', p_apply, 'stale_days', p_stale_days,
    'links_pruned', v_deleted, 'contracts_pruned', v_contracts_pruned,
    'contracts_skipped_partial', v_contracts_skipped, 'skipped_detail', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION inv_prune_stale_av_eligibility(boolean,int,int,numeric) FROM anon, authenticated;
