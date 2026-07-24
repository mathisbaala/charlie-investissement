-- Minimum investissable PAR ENVELOPPE (fonds × contrat) ──────────────────────
-- Retour CGP : « avoir les minimums investissables par enveloppe » — ex. Eurazeo
-- Private Value Europe 3 = 1 000 € sur Linxea Spirit 2 (Spirica), mais 100 € sur
-- Linxea Avenir 2 (Suravenir) et 5 000 € sur Cardif. Le minimum dépend du COUPLE
-- (support, contrat) — ni du fonds seul (min_subscription_eur, colonne fund-level
-- vide) ni de l'assureur seul. On modélise donc une table sidecar keyée
-- (isin, key='Compagnie::Contrat'), calquée sur investissement_av_contract_terms
-- (même motif source_url / as_of / confidence, même posture sécu : RLS active sans
-- policy → accès seulement via RPC SECURITY DEFINER). Alimentée par le scraper
-- scripts/scrapers/av-fund-minimums.py (catalogues distributeurs type Linxea, où le
-- minimum par support est publié en colonne « Souscription minimum »).

CREATE TABLE IF NOT EXISTS public.investissement_av_fund_envelope_terms (
  isin               text NOT NULL,
  key                text NOT NULL,             -- 'Compagnie::Contrat' (même format que l'éligibilité / contract_groups_mv)
  min_investment_eur numeric,                   -- euros ; NULL = non renseigné (jamais 0)
  source_url         text,
  as_of              date,
  confidence         text NOT NULL DEFAULT 'curated'
                       CHECK (confidence IN ('scraped', 'curated', 'indicative')),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (isin, key)
);

COMMENT ON TABLE public.investissement_av_fund_envelope_terms IS
  'Minimum de souscription d''un SUPPORT dans un CONTRAT donné (fonds × enveloppe). Keyé (isin, « Compagnie::Contrat »). Distinct du minimum fund-level (min_subscription_eur) et du minimum d''ouverture du contrat (av_contract_terms.ticket_entree).';

ALTER TABLE public.investissement_av_fund_envelope_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investissement_av_fund_envelope_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.investissement_av_fund_envelope_terms TO service_role;

-- ── get_fund_insurers : ajoute `minimums` par compagnie ──────────────────────
-- Non cassant : on conserve {company, contracts:text[]} et on AJOUTE
-- minimums = { "Nom contrat": <euros> } (uniquement les contrats où le minimum de
-- CE support est connu). Le minimum est matché sur l'ISIN EXACT (pas propagé au
-- groupe de share-classes) : les parts A/C d'un même FCPR ont des minimums et des
-- contrats distincts, on ne les mélange donc jamais.
CREATE OR REPLACE FUNCTION public.get_fund_insurers(p_isin text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH ref AS (
    SELECT isin, insurers, contracts
    FROM investissement_funds_cgp_ref
    WHERE isin = p_isin
    LIMIT 1
  ),
  comp AS (
    SELECT unnest(insurers) AS company FROM ref
  ),
  ctr AS (
    SELECT split_part(u, '::', 1)              AS company,
           substr(u, position('::' in u) + 2)  AS contract
    FROM ref, unnest(contracts) AS u
  ),
  mins AS (
    SELECT split_part(t.key, '::', 1)              AS company,
           substr(t.key, position('::' in t.key) + 2) AS contract,
           t.min_investment_eur
    FROM investissement_av_fund_envelope_terms t
    WHERE t.isin = (SELECT isin FROM ref)
      AND t.min_investment_eur IS NOT NULL
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('company', c.company, 'contracts', t.contracts, 'minimums', m.minimums)
      ORDER BY c.company
    ),
    '[]'::jsonb
  )
  FROM comp c
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT ctr.contract ORDER BY ctr.contract)
             FILTER (WHERE ctr.contract IS NOT NULL) AS contracts
    FROM ctr WHERE ctr.company = c.company
  ) t ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(mins.contract, mins.min_investment_eur) AS minimums
    FROM mins WHERE mins.company = c.company
  ) m ON true;
$function$;

REVOKE ALL ON FUNCTION public.get_fund_insurers(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fund_insurers(text) TO service_role;
