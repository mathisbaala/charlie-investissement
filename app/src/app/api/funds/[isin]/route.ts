import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { feeFracToPct, annualizeForType, annualizeCumul } from "@/lib/format";
import { logEvent } from "@/lib/analytics";
import { botGuard, dataRateLimit } from "@/lib/rateLimit";
import type { FundDetailHF, FundHoldingHF, FundBreakdownHF, NavPointHF } from "@/lib/types";

export const dynamic = "force-dynamic";

const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ isin: string }> }
): Promise<NextResponse> {
  const bot = botGuard(req);
  if (bot) return bot;
  const limited = await dataRateLimit(req);
  if (limited) return limited;

  const { isin } = await params;

  if (!ISIN_RE.test(isin)) {
    return NextResponse.json({ error: "ISIN invalide" }, { status: 400 });
  }

  const upper = isin.toUpperCase();

  // Fetch fund from table (not view — needs management_company, srri, etc.)
  const { data: fund, error: fundErr } = await supabase
    .from("investissement_funds")
    .select(`
      isin, name, management_company, management_company_normalized, tickers,
      product_type, category, category_normalized, asset_class_broad, asset_class, allocation_profile, region_normalized, region_exposure, management_style,
      currency, inception_date, track_record_years,
      hedged, distributor_france, ucits_compliant, data_source, field_sources,
      sfdr_article, sri, srri, risk_level,
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
      taxonomy_alignment_pct, sustainable_investment_pct, pai_considered,
      aum_eur, morningstar_rating, labels, kid_url,
      data_completeness, updated_at
    `)
    .eq("isin", upper)
    .single();

  if (fundErr || !fund) {
    return NextResponse.json({ error: "Fonds non trouvé", isin: upper }, { status: 404 });
  }

  // Fetch NAV history + breakdown tables in parallel
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const since = threeYearsAgo.toISOString().split("T")[0];

  const [pricesRes, holdingsRes, sectorsRes, geosRes, insurersRes, scpiRes, metricsRes] = await Promise.all([
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
      // Compo complète des ETF jusqu'à 500 lignes en base : le drawer d'aperçu
      // n'en montre qu'une fraction, on borne la réponse aux 50 principales.
      .limit(50),
    supabase
      .from("investissement_fund_sectors")
      .select("sector_name, weight")
      .eq("isin", upper)
      .order("weight", { ascending: false }),
    supabase
      .from("investissement_fund_geos")
      .select("country_label, country_code, weight")
      .eq("isin", upper)
      .order("weight", { ascending: false }),
    // Référencement assureur (mêmes données que la fiche /fonds/[isin]) : permet au
    // drawer d'aperçu d'afficher « chez quel assureur le fonds est référencé »
    // sans appel séparé. Réponse mise en cache 300s comme le reste du détail.
    supabase.rpc("get_fund_insurers", { p_isin: upper }),
    // Prix de part SCPI/OPCI : vit dans investissement_scpi_metrics (pas une
    // colonne de investissement_funds) → fetch dédié, sinon le champ reste null.
    supabase
      .from("investissement_scpi_metrics")
      .select("price_per_share, dvm, tof, period")
      .eq("isin", upper)
      .maybeSingle(),
    // Métriques dérivées du prix, lues depuis la vue gardée (source unique de la
    // garde de fraîcheur, cf. SQL inv_prices_stale) : quand la série est périmée
    // ou minuscule, perf/vol/sharpe/drawdown/alpha y sont déjà NULL. Exception
    // (migration 20260623140000) : pour un fonds SANS série locale (LU/IE), les
    // 3 perfs viennent d'une source externe directe (AMF GECO / catalogue /
    // Morningstar) et restent affichées si fraîches et saines — seuls vol/sharpe/
    // drawdown/alpha restent masqués. La fiche reprend ces valeurs gardées plutôt
    // que les valeurs brutes de la table (qui peuvent être un fossile sur 2 points).
    supabase
      .from("investissement_funds_cgp")
      .select(
        "performance_1y, performance_3y, performance_5y, volatility_1y, volatility_3y, sharpe_1y, sharpe_3y, max_drawdown_1y, max_drawdown_3y, alpha_1y, alpha_3y, alpha_5y"
      )
      .eq("isin", upper)
      .maybeSingle(),
  ]);

  // Métriques dérivées gardées (NULL si série non fiable). Repli sur les valeurs
  // brutes de la table uniquement si la lecture de la vue échoue (rare), pour ne
  // jamais casser la fiche — le screener, lui, est gardé en dur côté SQL.
  const gm = metricsRes.data as Record<string, number | null> | null;
  const useGated = !!gm;

  const scpi = scpiRes.data as { price_per_share: number | null; dvm: number | null; tof: number | null; period: string | null } | null;

  const nav_history: NavPointHF[] = (pricesRes.data ?? []).map((p: any) => ({
    date: p.price_date,
    nav: p.nav,
  }));

  const holdings: FundHoldingHF[] = (holdingsRes.data ?? []).map((h: any) => ({
    rank: h.rank,
    position_name: h.position_name,
    ticker: h.ticker ?? null,
    asset_type: h.asset_type ?? null,
    sector: h.sector ?? null,
    country: h.country ?? null,
    weight: h.weight,
  }));

  const sectors: FundBreakdownHF[] = (sectorsRes.data ?? []).map((s: any) => ({
    label: s.sector_name,
    weight: s.weight,
  }));

  const geos: FundBreakdownHF[] = (geosRes.data ?? []).map((g: any) => ({
    label: g.country_label ?? g.country_code,
    weight: g.weight,
  }));

  // Map to FundDetailHF
  const detail: FundDetailHF = {
    isin: fund.isin,
    name: fund.name,
    gestionnaire: fund.management_company_normalized ?? fund.management_company,
    management_company: fund.management_company,
    product_type: fund.product_type,
    tickers: (fund as any).tickers ?? null,
    category_normalized: fund.category_normalized,
    asset_class_broad: (fund as any).asset_class_broad ?? null,
    asset_class: fund.asset_class,
    allocation_profile: (fund as any).allocation_profile ?? null,
    region_normalized: fund.region_normalized,
    region_exposure: (fund as any).region_exposure ?? null,
    category: (fund as any).category ?? null,
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
    management_style: (fund as any).management_style ?? null,
    // Valeurs gardées issues de la vue CGP (perf 3y/5y déjà annualisées par
    // inv_annualize_pt côté SQL). Repli sur la table + annualisation TS seulement
    // si la vue n'a pas répondu.
    performance_1y: useGated ? gm!.performance_1y : fund.performance_1y,
    performance_3y: useGated ? gm!.performance_3y : annualizeForType(fund.performance_3y, 3, fund.product_type),
    performance_5y: useGated ? gm!.performance_5y : annualizeForType(fund.performance_5y, 5, fund.product_type),
    volatility_1y: useGated ? gm!.volatility_1y : fund.volatility_1y,
    volatility_3y: useGated ? gm!.volatility_3y : fund.volatility_3y,
    sharpe_1y: useGated ? gm!.sharpe_1y : fund.sharpe_1y,
    sharpe_3y: useGated ? gm!.sharpe_3y : fund.sharpe_3y,
    max_drawdown_1y: useGated ? gm!.max_drawdown_1y : fund.max_drawdown_1y,
    max_drawdown_3y: useGated ? gm!.max_drawdown_3y : fund.max_drawdown_3y,
    ongoing_charges: feeFracToPct(fund.ongoing_charges),
    ter: feeFracToPct(fund.ter),
    benchmark_index: (fund as any).benchmark_index ?? null,
    benchmark_variant: (fund as any).benchmark_variant ?? null,
    benchmark_is_category: (fund as any).benchmark_is_category ?? null,
    benchmark_perf_1y: (fund as any).benchmark_perf_1y ?? null,
    benchmark_perf_3y: annualizeCumul((fund as any).benchmark_perf_3y, 3),
    benchmark_perf_5y: annualizeCumul((fund as any).benchmark_perf_5y, 5),
    alpha_1y: useGated ? gm!.alpha_1y : ((fund as any).alpha_1y ?? null),
    alpha_3y: useGated ? gm!.alpha_3y : ((fund as any).alpha_3y ?? null),
    alpha_5y: useGated ? gm!.alpha_5y : ((fund as any).alpha_5y ?? null),
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
    taxonomy_alignment_pct: (fund as any).taxonomy_alignment_pct ?? null,
    sustainable_investment_pct: (fund as any).sustainable_investment_pct ?? null,
    pai_considered: (fund as any).pai_considered ?? null,
    aum_eur: fund.aum_eur,
    morningstar_rating: fund.morningstar_rating,
    labels: Array.isArray(fund.labels) ? fund.labels : null,
    kid_url: fund.kid_url,
    data_completeness: fund.data_completeness ?? 0,
    nav_history,
    holdings,
    sectors,
    geos,
    insurers: Array.isArray(insurersRes.data)
      ? (insurersRes.data as FundDetailHF["insurers"])
      : [],
  };

  // Télémétrie : consultation d'une fiche fonds (alimente le top des fonds les plus vus).
  logEvent(req, {
    event_type: "fund_view",
    isin: fund.isin,
    meta: { name: fund.name, product_type: fund.product_type },
  });

  return NextResponse.json(
    { data: detail },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
