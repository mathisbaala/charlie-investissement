-- Enrichissement des 14 profils assureurs ajoutés en 20260717140000 : on comble
-- fonds_euros (FR) et lux.ticket (Lux) à partir de données DÉJÀ SOURCÉES en base
-- (fonds_euros_nom et ticket_entree des contrats de chaque assureur), sans
-- fabrication. Convention respectée : profils Lux -> fonds_euros NULL, lux au
-- format « k€ ». Restent volontairement NULL faute de source fiable : fonds_euros
-- d'Abeille Retraite Professionnelle (entité retraite pro) et seuils Lux d'Allianz
-- Life Luxembourg (la garde de rendu masque la section vide côté UI).

-- FR : fonds_euros dérivé du fonds_euros_nom sourcé dans les contrats
UPDATE public.investissement_av_insurer_profiles SET fonds_euros='Fonds euros Le Conservateur', updated_at=now() WHERE company='Le Conservateur';
UPDATE public.investissement_av_insurer_profiles SET fonds_euros='Sécurité en euros Sogécap', updated_at=now() WHERE company='Sogécap';
UPDATE public.investissement_av_insurer_profiles SET fonds_euros='Fonds en euros BPCE Vie', updated_at=now() WHERE company='BPCE Vie';
UPDATE public.investissement_av_insurer_profiles SET fonds_euros='Actif Général Garance', updated_at=now() WHERE company='Garance';
UPDATE public.investissement_av_insurer_profiles SET fonds_euros='Fonds euros Monceau Épargne', updated_at=now() WHERE company='Monceau Assurances';
UPDATE public.investissement_av_insurer_profiles SET fonds_euros='Actif Général Prépar Vie', updated_at=now() WHERE company='Prépar Vie';
UPDATE public.investissement_av_insurer_profiles SET fonds_euros='Fonds euros Afi Esca', updated_at=now() WHERE company='Afi Esca';
UPDATE public.investissement_av_insurer_profiles SET fonds_euros='Eurossima / Netissima', updated_at=now() WHERE company='Asac Fapes';

-- Lux : lux.ticket dérivé du ticket_entree sourcé dans les contrats (format « k€ »)
UPDATE public.investissement_av_insurer_profiles SET lux='{"ticket":"300 k€"}'::jsonb, updated_at=now() WHERE company='CALI Europe';
UPDATE public.investissement_av_insurer_profiles SET lux='{"ticket":"300 k€"}'::jsonb, updated_at=now() WHERE company='Sogelife';
UPDATE public.investissement_av_insurer_profiles SET lux='{"ticket":"250 k€"}'::jsonb, updated_at=now() WHERE company='Swiss Life Luxembourg';
UPDATE public.investissement_av_insurer_profiles SET lux='{"ticket":"15 k€"}'::jsonb, updated_at=now() WHERE company='AFI ESCA Luxembourg';
