-- Suppression de l'index full-text GIN mort.
-- idx_funds_name_gin (to_tsvector('french', name)) avait été créé pour une
-- recherche par ts_query qui n'a jamais été branchée : la recherche texte passe
-- par ilike / trigramme / la RPC inv_funds_search, jamais par to_tsvector. L'index
-- était donc entretenu à chaque écriture sans jamais être consulté. On le supprime.
drop index if exists idx_funds_name_gin;
