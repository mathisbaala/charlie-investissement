-- Seed CURATED des minimums par enveloppe — cas confirmés (ancres) ───────────
-- Données vérifiées à la main (feasibility scan 24/07) pour Eurazeo Private Value
-- Europe 3, LE cas du retour CGP. Elles rendent la fonctionnalité démontrable dès
-- l'application de 20260723130000, SANS run de scraper : ces supports sont DÉJÀ
-- référencés sur ces contrats (investissement_fund_insurers_mv) → get_fund_insurers
-- accroche directement le minimum sur la fiche fonds.
--
-- Illustre le cœur du besoin : LE MÊME fonds (part C, FR0013301553) affiche des
-- minimums DIFFÉRENTS selon le contrat — 1 000 € sur Linxea Spirit 2 (Spirica),
-- 100 € sur Avenir 2 (Suravenir), 5 000 € sur Zen — et la part A (FR0013301546)
-- 5 000 € sur Cardif Edition Premium. Le minimum dépend bien du couple (support ×
-- contrat), jamais du fonds seul.
--
-- Idempotent : ON CONFLICT (isin, key) réécrit valeur/source/date. confidence
-- 'curated' (donnée sourcée à la main, prime sur un futur 'scraped' de même clé
-- seulement si on le décide — ici on écrase, la curation fait foi pour ces ancres).

INSERT INTO public.investissement_av_fund_envelope_terms
  (isin, key, min_investment_eur, source_url, as_of, confidence)
VALUES
  -- Eurazeo Private Value Europe 3 — part C (support des contrats Linxea/Spirica/Suravenir)
  ('FR0013301553', 'Linxea::Linxea Spirit 2', 1000,
   'https://www.linxea.com/assurance-vie/private-equity/eurazeo-private-value-europe-3/', DATE '2026-07-24', 'curated'),
  ('FR0013301553', 'Linxea::Linxea Avenir 2', 100,
   'https://www.linxea.com/assurance-vie/private-equity/eurazeo-private-value-europe-3/', DATE '2026-07-24', 'curated'),
  ('FR0013301553', 'Linxea::Linxea Zen', 5000,
   'https://www.linxea.com/assurance-vie/private-equity/eurazeo-private-value-europe-3/', DATE '2026-07-24', 'curated'),
  -- Eurazeo Private Value Europe 3 — part A (support des contrats Cardif Edition Premium)
  -- Dispositions spéciales du FCPR : 5 000 € min / 300 000 € max par opération.
  ('FR0013301546', 'BNP Paribas Cardif::Cardif Edition Premium Vie (Assurance Vie)', 5000,
   'https://www.assurancevie.com/assets/files/web/fcpr/annexe/annexe_eurazeo.pdf', DATE '2026-07-24', 'curated'),
  ('FR0013301546', 'BNP Paribas Cardif::Cardif Edition Premium Capitalisation (Capitalisation pers. physique)', 5000,
   'https://www.assurancevie.com/assets/files/web/fcpr/annexe/annexe_eurazeo.pdf', DATE '2026-07-24', 'curated')
ON CONFLICT (isin, key) DO UPDATE SET
  min_investment_eur = EXCLUDED.min_investment_eur,
  source_url         = EXCLUDED.source_url,
  as_of              = EXCLUDED.as_of,
  confidence         = EXCLUDED.confidence,
  updated_at         = now();
