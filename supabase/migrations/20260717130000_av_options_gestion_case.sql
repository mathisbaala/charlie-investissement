-- Normalise la casse initiale de chaque élément de options_gestion (text[]) :
-- première lettre en capitale, reste inchangé (même logique que cap() côté UI,
-- pour ne pas casser « Fonds d'assurance spécialisé »). Idempotent.
UPDATE public.investissement_av_contract_terms t SET options_gestion = sub.arr
FROM (
  SELECT key, array_agg(upper(left(e,1)) || substr(e,2) ORDER BY ord) AS arr
  FROM public.investissement_av_contract_terms, unnest(options_gestion) WITH ORDINALITY AS u(e,ord)
  GROUP BY key
) sub
WHERE t.key = sub.key AND t.options_gestion IS NOT NULL AND t.options_gestion <> sub.arr;
