-- Reclassement des fonds mal classés en 'diversifie' (haute confiance) ───────────
-- Contexte : le chantier alpha diversifiés (20260623130000) attribue un benchmark
-- COMPOSITE actions/oblig à TOUT asset_class_broad='diversifie'. Or quelques fonds
-- mono-classe y étaient mal rangés → alpha trompeur (ex. BNP Insticash, fonds
-- MONÉTAIRE, affichait alpha −10,87 vs un 50/50 ; iShares MSCI World, ETF actions
-- de 119 Md€, vs le même 50/50). Volume faible (16) mais visibilité forte : ces
-- intrus sont à très gros encours → tête de toute liste triée par AUM.
--
-- Règles HAUTE CONFIANCE uniquement. Les fonds ACTIONS à category source
-- 'Multi-Actifs' (UniGlobal, DWS Akkumula/Top Dividende/Vermögensbildung…) ne sont
-- PAS touchés ici : aucun signal automatique fiable ne les distingue d'un vrai
-- flexible — la ventilation secteur somme à 1.0 aussi bien pour eux que pour
-- DWS Concept Kaldemorgen (multi-actifs authentique). → curation nommée séparée.
--   M monétaire : nom = insticash / overnight rate / money market / liquidity / €STR…
--   E action    : category_normalized='Actions' (contredit 'diversifie')
--   O obligation: category_normalized='Obligations'
--
-- Effet : asset_class_broad corrigé ; allocation_profile + benchmark + alpha
-- NEUTRALISÉS (NULL), car calculés contre le composite désormais inadapté. Le
-- prochain run td-enricher recompute l'alpha contre le bon benchmark de classe
-- (map_index clé sur asset_class_broad). Conservateur : NULL plutôt que faux.
-- Backup réversible : investissement_funds_classif_backup_20260623.

CREATE TABLE IF NOT EXISTS public.investissement_funds_classif_backup_20260623 (
  isin                  text PRIMARY KEY,
  old_asset_class_broad text,
  old_allocation_profile text,
  old_benchmark_index   text,
  old_benchmark_variant text,
  old_benchmark_is_category boolean,
  old_alpha_1y          numeric,
  old_alpha_3y          numeric,
  old_alpha_5y          numeric,
  new_asset_class_broad text,
  rule                  text
);

WITH tgt AS (
  SELECT isin, 'monetaire'::text AS new_class, 'M'::text AS rule
    FROM public.investissement_funds
   WHERE asset_class_broad = 'diversifie'
     AND name ~* '\m(insticash|overnight\s*rate|money\s*market|mon[ée]taire|liquidity|€str|ester\b|t-?bill|cash\s*fund)\M'
  UNION
  SELECT isin, 'action', 'E'
    FROM public.investissement_funds
   WHERE asset_class_broad = 'diversifie' AND category_normalized = 'Actions'
  UNION
  SELECT isin, 'obligation', 'O'
    FROM public.investissement_funds
   WHERE asset_class_broad = 'diversifie' AND category_normalized = 'Obligations'
)
INSERT INTO public.investissement_funds_classif_backup_20260623
SELECT f.isin, f.asset_class_broad, f.allocation_profile, f.benchmark_index,
       f.benchmark_variant, f.benchmark_is_category, f.alpha_1y, f.alpha_3y, f.alpha_5y,
       t.new_class, t.rule
FROM public.investissement_funds f
JOIN tgt t ON t.isin = f.isin
ON CONFLICT (isin) DO NOTHING;

UPDATE public.investissement_funds f
SET asset_class_broad     = b.new_asset_class_broad,
    allocation_profile    = NULL,
    benchmark_index       = NULL,
    benchmark_variant     = NULL,
    benchmark_is_category = NULL,
    alpha_1y = NULL, alpha_3y = NULL, alpha_5y = NULL
FROM public.investissement_funds_classif_backup_20260623 b
WHERE b.isin = f.isin;

-- Phase B — curation NOMMÉE (ratifiée 23/06) des gros fonds ACTIONS notoires que la
-- source range en 'diversifie'/'Multi-Actifs' sans signal en base : UniGlobal
-- (Union), DWS Akkumula, DWS Top Dividende, DWS Vermögensbildung. 9 parts, alpha
-- composite gonflé (+5,9 à +19,3). Connaissance métier, pas heuristique → liste
-- explicite. Même neutralisation/backup (rule='B').
WITH tgt AS (
  SELECT isin FROM public.investissement_funds
   WHERE asset_class_broad = 'diversifie'
     AND name ~* 'uniglobal|top\s*dividende|verm[oö]gensbildung|akkumula'
)
INSERT INTO public.investissement_funds_classif_backup_20260623
SELECT f.isin, f.asset_class_broad, f.allocation_profile, f.benchmark_index,
       f.benchmark_variant, f.benchmark_is_category, f.alpha_1y, f.alpha_3y, f.alpha_5y,
       'action', 'B'
FROM public.investissement_funds f JOIN tgt t ON t.isin = f.isin
ON CONFLICT (isin) DO NOTHING;

UPDATE public.investissement_funds f
SET asset_class_broad='action', allocation_profile=NULL,
    benchmark_index=NULL, benchmark_variant=NULL, benchmark_is_category=NULL,
    alpha_1y=NULL, alpha_3y=NULL, alpha_5y=NULL
FROM public.investissement_funds_classif_backup_20260623 b
WHERE b.isin = f.isin AND b.rule = 'B';
