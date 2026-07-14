-- ============================================================================
-- investissement_av_contract_terms — conditions PROPRES au contrat (vague 2)
-- ----------------------------------------------------------------------------
-- Vague 2 du « mapping exhaustif CGP » : les conditions au niveau du CONTRAT
-- (frais d'entrée / gestion UC / gestion fonds euros / arbitrage, taux du fonds
-- euros, options de gestion, univers, gestion sous mandat, ticket, distributeur),
-- que l'éligibilité (investissement_av_lux_eligibility) ne porte pas. Schéma calé
-- sur l'ontologie de docs/mapping-assureurs-contrats-cgp.md §3.1.
--
-- Chaque ligne est AUDITABLE : source_url (DIC / conditions générales / page
-- courtier), as_of (millésime) et confidence ('scraped' extrait d'un DIC officiel,
-- 'curated' saisi à la main, 'indicative' ordre de grandeur). La fiche-contrat
-- n'affiche un champ que s'il est présent, avec sa source et son millésime — rien
-- n'est inventé.
--
-- Clé = `key` = "Assureur::Contrat" (identique à contract_groups_mv.key et aux
-- clés d'éligibilité). get_contract_overview renvoie la meilleure ligne de terms
-- du GROUPE de variantes (prefer scraped, millésime le plus récent).
--
-- RLS + grants révoqués (app = service_role bypass), cohérent avec le durcissement.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.investissement_av_contract_terms (
  key                          text PRIMARY KEY,   -- "Assureur::Contrat"
  company                      text NOT NULL,
  contract                     text NOT NULL,
  -- Frais (%/an ou % ; NULL = non renseigné, pas 0)
  frais_entree_pct             numeric(5,2),
  frais_gestion_uc_pct         numeric(5,2),
  frais_gestion_fonds_euros_pct numeric(5,2),
  frais_arbitrage_pct          numeric(5,2),
  frais_arbitrage_note         text,               -- ex. « gratuit en ligne »
  -- Fonds euros du contrat
  fonds_euros_nom              text,
  fonds_euros_taux_pct         numeric(5,2),
  fonds_euros_annee            int,
  fonds_euros_bonus            text,
  fonds_euros_contrainte_uc    text,               -- quota d'UC pour accès/bonus
  garantie_fonds_euros         text,               -- brute / nette de frais
  -- Univers & gestion
  univers_classes              text[] NOT NULL DEFAULT '{}',
  gestion_sous_mandat          boolean,
  options_gestion              text[] NOT NULL DEFAULT '{}',
  -- Accès
  ticket_entree                text,
  versement_min                text,
  distributeur                 text,               -- plateforme / courtier
  service_extranet             text,
  -- Traçabilité
  source_url                   text,
  as_of                        date,
  confidence                   text NOT NULL DEFAULT 'curated'
                                 CHECK (confidence IN ('scraped', 'curated', 'indicative')),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investissement_av_contract_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investissement_av_contract_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.investissement_av_contract_terms TO service_role;

-- ── Extension get_contract_overview : renvoie `terms` (meilleure ligne du groupe) ──
CREATE OR REPLACE FUNCTION public.get_contract_overview(p_key text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH supports AS (
    SELECT v.isin, v.asset_class_broad, v.region_normalized,
           v.risk_score, v.gestionnaire,
           COALESCE(v.ongoing_charges, v.ter) AS fee
    FROM investissement_funds_cgp_ref v
    WHERE v.is_primary_share_class
      AND v.data_completeness >= 50
      AND v.contracts @> ARRAY[p_key]
  ),
  grp AS (
    SELECT g.company, g.repr_key, g.repr_contract, g.group_key
    FROM investissement_contract_groups_mv g
    WHERE g.key = p_key
    LIMIT 1
  ),
  grp_agg AS (
    SELECT gg.company,
           gg.repr_contract AS contract,
           to_jsonb(array_agg(DISTINCT g2.contract_type ORDER BY g2.contract_type)) AS types,
           bool_and(g2.closed) AS closed,
           COALESCE(
             jsonb_agg(jsonb_build_object('contract', g2.contract, 'key', g2.key)
                       ORDER BY g2.contract) FILTER (WHERE g2.key <> gg.repr_key),
             '[]'::jsonb
           ) AS variants
    FROM grp gg
    JOIN investissement_contract_groups_mv g2 ON g2.group_key = gg.group_key
    GROUP BY gg.company, gg.repr_contract
  )
  SELECT jsonb_build_object(
    'key',      p_key,
    'company',  COALESCE((SELECT company  FROM grp_agg), split_part(p_key, '::', 1)),
    'contract', COALESCE((SELECT contract FROM grp_agg), substr(p_key, position('::' in p_key) + 2)),
    'types',    COALESCE((SELECT types    FROM grp_agg), '["av"]'::jsonb),
    'closed',   COALESCE((SELECT closed   FROM grp_agg), false),
    'variants', COALESCE((SELECT variants FROM grp_agg), '[]'::jsonb),
    'funds',    (SELECT count(*) FROM supports),
    'avg_fee',  (SELECT avg(fee) FROM supports WHERE fee IS NOT NULL),
    'classes',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'n', n) ORDER BY n DESC, label), '[]'::jsonb)
                 FROM (SELECT COALESCE(asset_class_broad, 'non classé') AS label, count(*) AS n
                       FROM supports GROUP BY 1 ORDER BY n DESC LIMIT 8) x),
    'regions',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'n', n) ORDER BY n DESC, label), '[]'::jsonb)
                 FROM (SELECT region_normalized AS label, count(*) AS n
                       FROM supports WHERE region_normalized IS NOT NULL AND region_normalized <> ''
                       GROUP BY 1 ORDER BY n DESC LIMIT 8) x),
    'managers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'n', n) ORDER BY n DESC, label), '[]'::jsonb)
                 FROM (SELECT gestionnaire AS label, count(*) AS n
                       FROM supports WHERE gestionnaire IS NOT NULL AND gestionnaire <> ''
                       GROUP BY 1 ORDER BY n DESC LIMIT 6) x),
    'sri',      (SELECT COALESCE(jsonb_object_agg(risk_score::text, n), '{}'::jsonb)
                 FROM (SELECT risk_score, count(*) AS n
                       FROM supports WHERE risk_score IS NOT NULL GROUP BY 1) x),
    'terms',    (
                 SELECT to_jsonb(t)
                 FROM investissement_av_contract_terms t
                 WHERE t.key IN (
                   SELECT g.key FROM investissement_contract_groups_mv g
                   WHERE g.group_key = (SELECT group_key FROM grp)
                 )
                 ORDER BY (t.confidence = 'scraped') DESC, t.as_of DESC NULLS LAST
                 LIMIT 1
                )
  );
$function$;

COMMIT;
