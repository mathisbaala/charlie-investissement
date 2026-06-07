-- recompute-completeness-v2.sql — recalcul data_completeness (formule v2 per-type)
-- À rejouer après tout enrichissement de masse (ex. parsing KID) pour refléter les
-- nouveaux champs. Idempotent. Réplique scripts/migrations/recalc-completeness-v2.py.
-- Appliqué initialement le 07/06/2026 (migration recompute_data_completeness_v2, doc §11.18).
update investissement_funds set data_completeness = least(100, case product_type
  when 'opcvm' then
    (case when ter is not null or ongoing_charges is not null then 14 else 0 end)+
    (case when sri is not null or srri is not null then 14 else 0 end)+
    (case when performance_1y is not null then 12 else 0 end)+
    (case when performance_3y is not null then 10 else 0 end)+
    (case when sfdr_article is not null then 8 else 0 end)+
    (case when aum_eur is not null then 10 else 0 end)+
    (case when kid_parsed_at is not null or kid_url is not null then 14 else 0 end)+
    (case when volatility_1y is not null then 8 else 0 end)+
    (case when inception_date is not null or track_record_years is not null then 6 else 0 end)+
    (case when coalesce(management_company,'')<>'' then 4 else 0 end)
  when 'etf' then
    (case when ter is not null or ongoing_charges is not null then 14 else 0 end)+
    (case when sri is not null or srri is not null then 14 else 0 end)+
    (case when performance_1y is not null then 12 else 0 end)+
    (case when performance_3y is not null then 10 else 0 end)+
    (case when sfdr_article is not null then 8 else 0 end)+
    (case when aum_eur is not null then 12 else 0 end)+
    (case when kid_parsed_at is not null or kid_url is not null then 14 else 0 end)+
    (case when volatility_1y is not null then 8 else 0 end)+
    (case when inception_date is not null or track_record_years is not null then 4 else 0 end)+
    (case when coalesce(management_company,'')<>'' then 4 else 0 end)
  when 'action' then
    (case when coalesce(currency,'')<>'' then 20 else 0 end)+
    (case when aum_eur is not null then 25 else 0 end)+
    (case when performance_1y is not null then 20 else 0 end)+
    (case when performance_3y is not null then 15 else 0 end)+
    (case when performance_5y is not null then 10 else 0 end)+
    (case when coalesce(asset_class,'')<>'' then 5 else 0 end)+ 5
  when 'scpi' then
    (case when performance_1y is not null then 20 else 0 end)+
    (case when performance_3y is not null then 10 else 0 end)+
    (case when aum_eur is not null then 15 else 0 end)+
    (case when ter is not null or ongoing_charges is not null then 10 else 0 end)+
    (case when sri is not null or srri is not null then 10 else 0 end)+
    (case when coalesce(management_company,'')<>'' then 10 else 0 end)+
    (case when inception_date is not null then 10 else 0 end)+
    (case when coalesce(category,'')<>'' then 5 else 0 end)+
    (case when coalesce(region_exposure,'')<>'' then 5 else 0 end)+
    (case when sfdr_article is not null then 5 else 0 end)
  when 'crypto' then
    (case when aum_eur is not null then 25 else 0 end)+
    (case when performance_1y is not null then 20 else 0 end)+
    (case when performance_3y is not null then 15 else 0 end)+
    (case when volatility_1y is not null then 15 else 0 end)+
    (case when sri is not null or srri is not null then 10 else 0 end)+
    (case when coalesce(category,'')<>'' then 10 else 0 end)+
    (case when coalesce(currency,'')<>'' then 5 else 0 end)
  when 'fonds_euros' then
    (case when performance_1y is not null then 35 else 0 end)+
    (case when ter is not null or ongoing_charges is not null then 20 else 0 end)+
    (case when coalesce(management_company,'')<>'' then 15 else 0 end)+
    (case when sri is not null or srri is not null then 10 else 0 end)+
    (case when aum_eur is not null then 10 else 0 end)+
    (case when performance_3y is not null then 10 else 0 end)+
    (case when performance_5y is not null then 10 else 0 end)
  when 'livret' then
    (case when performance_1y is not null then 50 else 0 end)+
    (case when coalesce(management_company,'')<>'' then 20 else 0 end)+
    (case when aum_eur is not null then 15 else 0 end)+
    (case when sri is not null or srri is not null then 10 else 0 end)+
    (case when coalesce(currency,'')<>'' then 5 else 0 end)
  when 'obligation' then
    (case when performance_1y is not null then 15 else 0 end)+
    (case when performance_3y is not null then 10 else 0 end)+
    (case when sri is not null or srri is not null then 15 else 0 end)+
    (case when morningstar_rating is not null then 15 else 0 end)+
    (case when aum_eur is not null then 10 else 0 end)+
    (case when volatility_1y is not null then 10 else 0 end)+
    (case when inception_date is not null or track_record_years is not null then 10 else 0 end)+
    (case when coalesce(management_company,'')<>'' then 10 else 0 end)+
    (case when coalesce(currency,'')<>'' then 5 else 0 end)
  when 'opci' then
    (case when performance_1y is not null then 20 else 0 end)+
    (case when performance_3y is not null then 15 else 0 end)+
    (case when sri is not null or srri is not null then 15 else 0 end)+
    (case when aum_eur is not null then 15 else 0 end)+
    (case when ter is not null or ongoing_charges is not null then 10 else 0 end)+
    (case when coalesce(management_company,'')<>'' then 10 else 0 end)+
    (case when inception_date is not null then 10 else 0 end)+
    (case when sfdr_article is not null then 5 else 0 end)
  when 'fcpi' then  (case when aum_eur is not null then 15 else 0 end)+(case when coalesce(management_company,'')<>'' then 15 else 0 end)+(case when coalesce(category,'')<>'' then 10 else 0 end)+(case when inception_date is not null then 10 else 0 end)+(case when track_record_years is not null then 10 else 0 end)+(case when sri is not null or srri is not null then 15 else 0 end)+(case when performance_1y is not null then 10 else 0 end)+(case when performance_3y is not null then 5 else 0 end)+(case when ter is not null or ongoing_charges is not null then 5 else 0 end)+(case when sfdr_article is not null then 5 else 0 end)
  when 'fip' then  (case when aum_eur is not null then 15 else 0 end)+(case when coalesce(management_company,'')<>'' then 15 else 0 end)+(case when coalesce(category,'')<>'' then 10 else 0 end)+(case when inception_date is not null then 10 else 0 end)+(case when track_record_years is not null then 10 else 0 end)+(case when sri is not null or srri is not null then 15 else 0 end)+(case when performance_1y is not null then 10 else 0 end)+(case when performance_3y is not null then 5 else 0 end)+(case when ter is not null or ongoing_charges is not null then 5 else 0 end)+(case when sfdr_article is not null then 5 else 0 end)
  when 'fcpr' then  (case when aum_eur is not null then 15 else 0 end)+(case when coalesce(management_company,'')<>'' then 15 else 0 end)+(case when coalesce(category,'')<>'' then 10 else 0 end)+(case when inception_date is not null then 10 else 0 end)+(case when track_record_years is not null then 10 else 0 end)+(case when sri is not null or srri is not null then 15 else 0 end)+(case when performance_1y is not null then 10 else 0 end)+(case when performance_3y is not null then 5 else 0 end)+(case when ter is not null or ongoing_charges is not null then 5 else 0 end)+(case when sfdr_article is not null then 5 else 0 end)
  when 'fpci' then  (case when coalesce(management_company,'')<>'' then 25 else 0 end)+(case when inception_date is not null then 20 else 0 end)+(case when track_record_years is not null then 15 else 0 end)+(case when aum_eur is not null then 15 else 0 end)+(case when coalesce(category,'')<>'' then 10 else 0 end)+(case when sfdr_article is not null then 5 else 0 end)+(case when coalesce(currency,'')<>'' then 5 else 0 end)+(case when coalesce(asset_class,'')<>'' then 5 else 0 end)
  when 'fps' then  (case when coalesce(management_company,'')<>'' then 25 else 0 end)+(case when inception_date is not null then 20 else 0 end)+(case when track_record_years is not null then 15 else 0 end)+(case when aum_eur is not null then 15 else 0 end)+(case when coalesce(category,'')<>'' then 10 else 0 end)+(case when sfdr_article is not null then 5 else 0 end)+(case when coalesce(currency,'')<>'' then 5 else 0 end)+(case when coalesce(asset_class,'')<>'' then 5 else 0 end)
  else data_completeness end);
