import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { decodeHtml } from "@/lib/format";
import type { FundDetailHF, NavPointHF, FundHoldingHF, FundBreakdownHF } from "@/lib/types";
import { FundSheetClient } from "./FundSheetClient";

// Standard ISIN (12 chars) OR internal identifiers (FE_*, CRYPTO_*)
const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/i;

const normTer = (v: number | null | undefined): number | null =>
  v != null && v > 0 && v < 0.1 ? parseFloat((v * 100).toFixed(4)) : v ?? null;

export default async function FondPage({
  params,
}: {
  params: Promise<{ isin: string }>;
}) {
  const { isin } = await params;

  if (!ISIN_RE.test(isin)) notFound();
  const upper = isin.toUpperCase();

  const { data: fund } = await supabase
    .from("investissement_funds")
    .select(`
      isin, name, management_company, management_company_normalized,
      product_type, category_normalized, asset_class, region_normalized,
      currency, inception_date, track_record_years,
      sfdr_article, sri, srri,
      performance_1y, performance_3y, performance_5y,
      volatility_1y, volatility_3y, sharpe_1y, sharpe_3y,
      max_drawdown_1y, max_drawdown_3y,
      ongoing_charges, ter,
      entry_fee_max, exit_fee_max, performance_fee,
      retrocession_cgp, holding_period_years,
      pea_eligible, per_eligible, av_lux_eligible,
      av_fr_eligible, pea_pme_eligible, cto_eligible,
      aum_eur, morningstar_rating, labels, kid_url,
      data_completeness
    `)
    .eq("isin", upper)
    .single();

  if (!fund) notFound();

  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const since = threeYearsAgo.toISOString().split("T")[0];

  const [
    { data: prices },
    { data: holdingsRaw },
    { data: sectorsRaw },
    { data: geosRaw },
  ] = await Promise.all([
    supabase
      .from("investissement_fund_prices")
      .select("price_date, nav")
      .eq("isin", upper)
      .gte("price_date", since)
      .order("price_date", { ascending: true })
      .limit(1000),
    supabase
      .from("investissement_fund_holdings")
      .select("rank, position_name, ticker, asset_type, sector, country, weight")
      .eq("isin", upper)
      .order("rank", { ascending: true })
      .limit(10),
    supabase
      .from("investissement_fund_sectors")
      .select("sector_name, weight")
      .eq("isin", upper)
      .order("weight", { ascending: false }),
    supabase
      .from("investissement_fund_geos")
      .select("country_code, country_label, weight")
      .eq("isin", upper)
      .order("weight", { ascending: false })
      .limit(15),
  ]);

  const nav_history: NavPointHF[] = (prices ?? []).map((p: any) => ({
    date: p.price_date,
    nav: p.nav,
  }));

  const holdings: FundHoldingHF[] = (holdingsRaw ?? []).map((h: any) => ({
    rank:          h.rank,
    position_name: h.position_name,
    ticker:        h.ticker ?? null,
    asset_type:    h.asset_type ?? null,
    sector:        h.sector ?? null,
    country:       h.country ?? null,
    weight:        h.weight,
  }));

  const sectors: FundBreakdownHF[] = (sectorsRaw ?? []).map((s: any) => ({
    label:  s.sector_name,
    weight: s.weight,
  }));

  const geos: FundBreakdownHF[] = (geosRaw ?? []).map((g: any) => ({
    label:  g.country_label || g.country_code,
    weight: g.weight,
  }));

  const detail: FundDetailHF = {
    isin: fund.isin,
    name: decodeHtml(fund.name),
    gestionnaire: decodeHtml(fund.management_company_normalized ?? fund.management_company),
    management_company: decodeHtml(fund.management_company),
    product_type: fund.product_type,
    category_normalized: fund.category_normalized,
    asset_class: fund.asset_class,
    region_normalized: fund.region_normalized,
    currency: fund.currency,
    inception_date: fund.inception_date,
    track_record_years: fund.track_record_years,
    sfdr_article: fund.sfdr_article,
    risk_score: fund.sri,
    srri: fund.srri,
    performance_1y: fund.performance_1y,
    performance_3y: fund.performance_3y,
    performance_5y: fund.performance_5y,
    volatility_1y: fund.volatility_1y,
    volatility_3y: fund.volatility_3y,
    sharpe_1y: fund.sharpe_1y,
    sharpe_3y: fund.sharpe_3y,
    max_drawdown_1y: fund.max_drawdown_1y,
    max_drawdown_3y: fund.max_drawdown_3y,
    ongoing_charges: normTer(fund.ongoing_charges),
    ter: normTer(fund.ter),
    entry_fee_max: fund.entry_fee_max ?? null,
    exit_fee_max: fund.exit_fee_max ?? null,
    performance_fee: fund.performance_fee ?? null,
    retrocession_cgp: fund.retrocession_cgp ?? null,
    holding_period_years: fund.holding_period_years ?? null,
    pea_eligible: fund.pea_eligible,
    per_eligible: fund.per_eligible,
    av_lux_eligible: fund.av_lux_eligible,
    av_fr_eligible: fund.av_fr_eligible ?? null,
    pea_pme_eligible: fund.pea_pme_eligible ?? null,
    cto_eligible: fund.cto_eligible ?? null,
    aum_eur: fund.aum_eur,
    morningstar_rating: fund.morningstar_rating,
    labels: Array.isArray(fund.labels) ? fund.labels : null,
    kid_url: fund.kid_url,
    data_completeness: fund.data_completeness ?? 0,
    nav_history,
    holdings,
    sectors,
    geos,
  };

  return <FundSheetClient fund={detail} />;
}
