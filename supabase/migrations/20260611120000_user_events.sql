-- Télémétrie produit (Couche 1, côté serveur) : journal d'événements d'usage pour
-- savoir ce que les utilisateurs consultent et cherchent réellement — fonds les plus
-- vus, recherches/mots-clés les plus tapés, filtres les plus utilisés.
--
-- Capté UNIQUEMENT côté serveur (dans les routes API, via `after()` Next 16 → latence
-- nulle, fail-open). Aucun script client, aucune donnée personnelle : l'identité du
-- visiteur est pseudonymisée par un hash SHA-256(IP + sel) tronqué (cf. lib/analytics.ts).
-- Le hash sert seulement à compter des visiteurs distincts ; il n'est pas réversible
-- en IP sans le sel, et l'IP brute n'est jamais stockée.

CREATE TABLE IF NOT EXISTS public.investissement_user_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  event_type   text NOT NULL,         -- 'search' | 'search_nl' | 'fund_view' | 'matching' | 'chat' | 'dici'
  path         text,                  -- chemin de la route appelée
  isin         text,                  -- fonds concerné (fund_view, dici matché)
  query        text,                  -- texte de recherche libre / mots-clés (search, search_nl)
  filters      jsonb,                 -- filtres actifs au moment de la recherche (clé → valeur)
  result_count int,                   -- nombre de résultats renvoyés
  visitor      text,                  -- pseudonyme = sha256(ip + sel) tronqué (jamais l'IP brute)
  session      text,                  -- id de session anonyme (cookie charlie_sid), nullable
  meta         jsonb                  -- contexte libre (tri, page, nb de tours de chat, etc.)
);

-- Accès agrégation : (type, date) couvre toutes les vues métriques ci-dessous.
CREATE INDEX IF NOT EXISTS i_user_events_type_ts ON public.investissement_user_events (event_type, ts DESC);
-- Top fonds consultés : index partiel ciblé sur les vues de fiche.
CREATE INDEX IF NOT EXISTS i_user_events_isin     ON public.investissement_user_events (isin) WHERE event_type = 'fund_view';
-- Fenêtres temporelles génériques (activité sur N derniers jours).
CREATE INDEX IF NOT EXISTS i_user_events_ts       ON public.investissement_user_events (ts DESC);

ALTER TABLE public.investissement_user_events ENABLE ROW LEVEL SECURITY;
-- Aucune policy publique : seul le service role (backend) écrit, seul le dashboard
-- (rôle postgres) lit. Le client navigateur n'y a jamais accès. RLS active par principe,
-- cohérent avec investissement_ai_usage.
REVOKE ALL ON public.investissement_user_events FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Vues d'agrégation (« tableau de bord » interrogeable directement en SQL).
-- security_invoker : elles héritent des droits de l'appelant → RLS s'applique, donc
-- réservées au service role / dashboard, jamais exposées au navigateur.
-- ────────────────────────────────────────────────────────────────────────────

-- Fonds les plus consultés (toutes périodes ; filtrer sur ts pour une fenêtre).
CREATE OR REPLACE VIEW public.investissement_metrics_top_funds
WITH (security_invoker = true) AS
SELECT e.isin,
       f.name,
       f.product_type,
       count(*)                  AS views,
       count(DISTINCT e.visitor) AS unique_visitors,
       max(e.ts)                 AS last_viewed
FROM public.investissement_user_events e
LEFT JOIN public.investissement_funds f USING (isin)
WHERE e.event_type = 'fund_view' AND e.isin IS NOT NULL
GROUP BY e.isin, f.name, f.product_type
ORDER BY views DESC;

-- Recherches / mots-clés les plus tapés (screener texte + recherche langage naturel).
CREATE OR REPLACE VIEW public.investissement_metrics_top_searches
WITH (security_invoker = true) AS
SELECT lower(trim(query))        AS query,
       count(*)                  AS searches,
       count(DISTINCT visitor)   AS unique_visitors,
       max(ts)                   AS last_searched
FROM public.investissement_user_events
WHERE event_type IN ('search', 'search_nl')
  AND query IS NOT NULL AND trim(query) <> ''
GROUP BY lower(trim(query))
ORDER BY searches DESC;

-- Filtres les plus utilisés (une ligne par clé de filtre active).
CREATE OR REPLACE VIEW public.investissement_metrics_filter_usage
WITH (security_invoker = true) AS
SELECT key                       AS filter,
       count(*)                  AS uses,
       count(DISTINCT visitor)   AS unique_visitors
FROM public.investissement_user_events e,
     LATERAL jsonb_object_keys(e.filters) AS key
WHERE e.event_type = 'search' AND e.filters IS NOT NULL
GROUP BY key
ORDER BY uses DESC;

-- Activité quotidienne par type d'événement (volume + visiteurs uniques).
CREATE OR REPLACE VIEW public.investissement_metrics_daily
WITH (security_invoker = true) AS
SELECT (ts AT TIME ZONE 'UTC')::date AS day,
       event_type,
       count(*)                      AS events,
       count(DISTINCT visitor)       AS unique_visitors
FROM public.investissement_user_events
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
