import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { decodeHtml, feeFracToPct, annualizeForType, annualizeCumul } from "@/lib/format";
import type { FundDetailHF, NavPointHF, FundHoldingHF, FundBreakdownHF } from "@/lib/types";
import { FundSheetClient } from "./FundSheetClient";

// Standard ISIN (12 chars) OR internal identifiers (FE_*, CRYPTO_*)
const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/i;

export default async function FondPage({
  params,
}: {
  params: Promise<{ isin: string }>;
}) {
  const { isin } = await params;

  if (!ISIN_RE.test(isin)) notFound();
  const upper = isin.toUpperCase();

  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const since = fiveYearsAgo.toISOString().split("T")[0];

  // Les 6 requêtes de ventilation ne dépendent que de l'ISIN (pas des données du
  // fonds) : on les lance en parallèle AVEC la requête fonds, plutôt qu'après.
  // Économise un aller-retour Supabase complet sur la page la plus cliquée.
  const [
    { data: fund },
    { data: prices },
    { data: holdingsRaw },
    { data: sectorsRaw },
    { data: geosRaw },
    { data: insurersRaw },
    { data: scpiMetrics },
  ] = await Promise.all([
    supabase
      .from("investissement_funds")
      .select(`
        isin, name, management_company, management_company_normalized, tickers,
        product_type, category, category_normalized, asset_class_broad, asset_class, allocation_profile, region_normalized, region_exposure, management_style,
        currency, inception_date, track_record_years,
        hedged, distributor_france, ucits_compliant, data_source, field_sources,
        sfdr_article, sri, srri,
        performance_1y, performance_3y, performance_5y,
        volatility_1y, volatility_3y, sharpe_1y, sharpe_3y,
        max_drawdown_1y, max_drawdown_3y,
        ongoing_charges, ter,
        benchmark_index, benchmark_variant, benchmark_is_category,
        benchmark_perf_1y, benchmark_perf_3y, benchmark_perf_5y,
        alpha_1y, alpha_3y, alpha_5y,
        tracking_diff_1y, tracking_diff_3y, tracking_diff_5y,
        entry_fee_max, exit_fee_max, performance_fee,
        retrocession_cgp, holding_period_years,
        pea_eligible, per_eligible, av_lux_eligible,
        av_fr_eligible, pea_pme_eligible, cto_eligible,
        tax_scheme, tax_reduction_rate, tax_lock_up_years, vintage_year,
        taxonomy_alignment_pct, sustainable_investment_pct, pai_considered,
        esg_exclusions, esg_exclusions_updated_at,
        aum_eur, morningstar_rating, labels, kid_url,
        data_completeness
      `)
      .eq("isin", upper)
      .single(),
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
      .limit(50),
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
    supabase.rpc("get_fund_insurers", { p_isin: upper }),
    // Prix de part SCPI/OPCI : vit dans investissement_scpi_metrics (pas une
    // colonne de investissement_funds) → fetch dédié, sinon le champ reste null.
    supabase
      .from("investissement_scpi_metrics")
      .select("price_per_share, dvm, tof, period")
      .eq("isin", upper)
      .maybeSingle(),
  ]);

  if (!fund) notFound();

  const scpi = scpiMetrics as { price_per_share: number | null; dvm: number | null; tof: number | null; period: string | null } | null;

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
    tickers: (fund as any).tickers ?? null,
    category: (fund as any).category ?? null,
    category_normalized: fund.category_normalized,
    asset_class_broad: (fund as any).asset_class_broad ?? null,
    asset_class: fund.asset_class,
    allocation_profile: (fund as any).allocation_profile ?? null,
    region_normalized: fund.region_normalized,
    region_exposure: (fund as any).region_exposure ?? null,
    currency: fund.currency,
    price_per_share: scpi?.price_per_share ?? null,
    dvm: scpi?.dvm ?? null,
    tof: scpi?.tof ?? null,
    scpi_period: scpi?.period ?? null,
    inception_date: fund.inception_date,
    track_record_years: fund.track_record_years,
    hedged: (fund as any).hedged ?? null,
    distributor_france: (fund as any).distributor_france ?? null,
    ucits_compliant: (fund as any).ucits_compliant ?? null,
    data_source: (fund as any).data_source ?? null,
    field_sources: ((fund as any).field_sources ?? null) as Record<string, string> | null,
    sfdr_article: fund.sfdr_article,
    risk_score: fund.sri,
    srri: fund.srri,
    management_style: fund.management_style ?? null,
    performance_1y: fund.performance_1y,
    // 3y/5y stockés en cumulé (sauf SCPI/livret) → annualisés, comme le screener
    // et /api/funds/[isin]. Sans ça la fiche affichait du cumulé (incohérent).
    performance_3y: annualizeForType(fund.performance_3y, 3, fund.product_type),
    performance_5y: annualizeForType(fund.performance_5y, 5, fund.product_type),
    volatility_1y: fund.volatility_1y,
    volatility_3y: fund.volatility_3y,
    sharpe_1y: fund.sharpe_1y,
    sharpe_3y: fund.sharpe_3y,
    max_drawdown_1y: fund.max_drawdown_1y,
    max_drawdown_3y: fund.max_drawdown_3y,
    ongoing_charges: feeFracToPct(fund.ongoing_charges),
    ter: feeFracToPct(fund.ter),
    // alpha_* déjà en % (1y cumulé, 3y/5y annualisé) → pas de conversion.
    // benchmark_perf_* stocké cumulé (comme performance_*) → annualisé 3y/5y.
    benchmark_index: (fund as any).benchmark_index ?? null,
    benchmark_variant: (fund as any).benchmark_variant ?? null,
    benchmark_is_category: (fund as any).benchmark_is_category ?? null,
    benchmark_perf_1y: (fund as any).benchmark_perf_1y ?? null,
    benchmark_perf_3y: annualizeCumul((fund as any).benchmark_perf_3y, 3),
    benchmark_perf_5y: annualizeCumul((fund as any).benchmark_perf_5y, 5),
    alpha_1y: (fund as any).alpha_1y ?? null,
    alpha_3y: (fund as any).alpha_3y ?? null,
    alpha_5y: (fund as any).alpha_5y ?? null,
    tracking_diff_1y: (fund as any).tracking_diff_1y ?? null,
    tracking_diff_3y: (fund as any).tracking_diff_3y ?? null,
    tracking_diff_5y: (fund as any).tracking_diff_5y ?? null,
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
    tax_scheme: (fund as any).tax_scheme ?? null,
    tax_reduction_rate: (fund as any).tax_reduction_rate ?? null,
    tax_lock_up_years: (fund as any).tax_lock_up_years ?? null,
    vintage_year: (fund as any).vintage_year ?? null,
    taxonomy_alignment_pct: (fund as any).taxonomy_alignment_pct ?? null,
    sustainable_investment_pct: (fund as any).sustainable_investment_pct ?? null,
    pai_considered: (fund as any).pai_considered ?? null,
    esg_exclusions: (fund as any).esg_exclusions ?? null,
    esg_exclusions_updated_at: (fund as any).esg_exclusions_updated_at ?? null,
    aum_eur: fund.aum_eur,
    morningstar_rating: fund.morningstar_rating,
    labels: Array.isArray(fund.labels) ? fund.labels : null,
    kid_url: fund.kid_url,
    data_completeness: fund.data_completeness ?? 0,
    nav_history,
    holdings,
    sectors,
    geos,
    insurers: Array.isArray(insurersRaw) ? (insurersRaw as FundDetailHF["insurers"]) : [],
  };

  return <FundSheetClient fund={detail} />;
}
