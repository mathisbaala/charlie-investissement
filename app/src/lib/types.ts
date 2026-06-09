// ─────────────────────────────────────────────────────────────────────────────
// Domain types — Charlie Investissement
//
// Trois niveaux :
//   Fund        → colonnes de la VIEW investissement_funds_cgp (screener)
//   FundDetail  → sortie de get_fund_detail() RPC (fiche complète)
//   SimilarFund → sortie de get_similar_funds() RPC (fonds similaires)
//   NavPoint    → table investissement_fund_nav (historique VL)
// ─────────────────────────────────────────────────────────────────────────────

// ─── Fund (view investissement_funds_cgp) ─────────────────────────────────────
// Utilisé par : screener, matching, rapport PDF
export type Fund = {
  isin: string;
  name: string;
  product_type: string;

  // Classification
  asset_class_broad: string | null;
  asset_class: string | null;
  category_normalized: string | null;
  region_normalized: string | null;
  sector: string | null;
  management_style: string | null;
  gestionnaire: string | null;

  // Frais — toujours en % (ex: 1.5 = 1.5 %)
  ter: number | null;
  ongoing_charges: number | null;

  // Performances annualisées (%)
  performance_1y: number | null;
  performance_3y: number | null;
  performance_5y: number | null;
  average_performance: number | null;

  // Métriques de risque
  volatility_1y: number | null;
  volatility_3y: number | null;
  sharpe_1y: number | null;
  sharpe_3y: number | null;
  max_drawdown_1y: number | null;
  max_drawdown_3y: number | null;
  risk_score: number | null;       // = sri (nouvelle nomenclature PRIIPs)
  sfdr_article: number | null;

  // Encours & rating
  aum_eur: number | null;
  morningstar_rating: number | null;
  currency: string | null;

  // Dates
  inception_date: string | null;
  track_record_years: number | null;

  // Frais détaillés (vue v3)
  entry_fee_max: number | null;
  exit_fee_max: number | null;
  performance_fee: number | null;
  retrocession_cgp: number | null;

  // Éligibilités
  pea_eligible: boolean | null;
  per_eligible: boolean | null;
  av_lux_eligible: boolean | null;
  av_fr_eligible: boolean | null;
  pea_pme_eligible: boolean | null;
  cto_eligible: boolean | null;
  ucits_compliant: boolean | null;
  is_institutional: boolean | null;
  accessible_retail: boolean | null;
  hedged: boolean | null;

  // Labels & qualité
  labels: string[] | null;
  kid_url: string | null;
  kid_parsed_at: string | null;
  share_class_group_id: string | null;
  data_completeness: number;
  data_source: string | null;
  field_sources: Record<string, string> | null;
  updated_at: string | null;

  // Alias rétro-compatibles (certains scrapers/pages lisent ces champs)
  /** @deprecated utiliser risk_score */
  sri?: number | null;
  /** @deprecated utiliser gestionnaire */
  management_company?: string | null;
};

// ─── FundDetail (RPC get_fund_detail) ────────────────────────────────────────
// Inclut les champs bruts non exposés par la vue + percentiles peer-group
export type FundDetail = Omit<Fund, 'sri' | 'management_company'> & {
  // Champs bruts de la table (absents de la vue)
  management_company: string | null;
  category: string | null;             // catégorie brute (non normalisée)
  region_exposure: string | null;      // exposition géographique brute
  srri: number | null;                 // ancien indicateur SRRI OPCVM (1-7)
  distributor_france: boolean | null;
  min_subscription_eur: number | null;
  created_at: string | null;

  // Percentiles dans la catégorie normalisée (0-100)
  ter_percentile_in_category: number | null;
  perf3y_percentile_in_category: number | null;
};

// ─── SimilarFund (RPC get_similar_funds) ─────────────────────────────────────
export type SimilarFund = {
  isin: string;
  name: string;
  gestionnaire: string | null;
  product_type: string;
  category_normalized: string | null;
  region_normalized: string | null;
  sfdr_article: number | null;
  risk_score: number | null;
  ter: number | null;
  performance_1y: number | null;
  performance_3y: number | null;
  morningstar_rating: number | null;
  retrocession_cgp: number | null;
  data_completeness: number;
  similarity_score: number;
};

// ─── NavPoint (table investissement_fund_nav) ─────────────────────────────────
export type NavPoint = {
  isin: string;
  nav_date: string;    // ISO date "YYYY-MM-DD"
  nav_value: number;
  currency: string;
  source: string | null;
};

// ─── ScreenerFilters ──────────────────────────────────────────────────────────
// Paramètres de requête pour GET /api/screener/funds
export type ScreenerFilters = {
  types?: string[];
  regions?: string[];
  categories?: string[];
  sectors?: string[];
  management_style?: string[];
  sfdr?: number[];
  pea?: boolean;
  pea_pme?: boolean;
  per?: boolean;
  av_fr?: boolean;
  av_lux?: boolean;
  cto?: boolean;
  sri_min?: number;
  sri_max?: number;
  ter_max?: number;
  perf_1y_min?: number;
  perf_3y_min?: number;
  vol_max?: number;
  sharpe_min?: number;
  track_record_min?: number;
  morningstar_min?: number;
  aum_min?: number;
  retrocession_min?: number;
  gestionnaire?: string;
  search?: string;
  min_completeness?: number;
  deduplicate?: boolean;
  sort_by?: SortField;
  sort_dir?: 'asc' | 'desc';
  page?: number;
  per_page?: number;

  // Alias rétro-compatibles (ancienne route POST /api/screener)
  /** @deprecated utiliser types */
  product_type?: string[];
  /** @deprecated utiliser sfdr */
  sfdr_article?: number[];
  /** @deprecated utiliser pea */
  pea_eligible?: boolean;
  /** @deprecated utiliser per */
  per_eligible?: boolean;
  /** @deprecated utiliser av_lux */
  av_lux_eligible?: boolean;
  /** @deprecated utiliser search */
  name_search?: string;
  /** @deprecated utiliser min_completeness */
  completeness_min?: number;
  /** @deprecated utiliser per_page */
  limit?: number;
  /** @deprecated utiliser sort_dir */
  sort_asc?: boolean;
  asset_class?: string[];
  region?: string[];
  category?: string[];
  ter_min?: number;
  labels?: string[];
};

export type SortField =
  | 'performance_3y'
  | 'performance_1y'
  | 'performance_5y'
  | 'average_performance'
  | 'ter'
  | 'aum_eur'
  | 'sharpe_1y'
  | 'sharpe_3y'
  | 'volatility_1y'
  | 'max_drawdown_3y'
  | 'morningstar_rating'
  | 'track_record_years'
  | 'retrocession_cgp'
  | 'entry_fee_max'
  | 'data_completeness';

// ─── Réponses API ─────────────────────────────────────────────────────────────

export type ScreenerResponse = {
  data: Fund[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

export type FundDetailResponse = {
  data: FundDetail;
};

export type SimilarFundsResponse = {
  data: SimilarFund[];
  ref_isin: string;
};

export type NavResponse = {
  data: NavPoint[];
  isin: string;
  count: number;
};

// ─── Stats ────────────────────────────────────────────────────────────────────

export type FundStats = {
  total_funds: number;
  exploitable_funds: number;           // data_completeness >= 60
  with_kid: number;
  by_type: Record<string, number>;
  by_sfdr: Record<string, number>;
  avg_ter: number | null;
  avg_perf_3y: number | null;
};

// ─── Filtres disponibles (GET /api/screener/filters) ─────────────────────────

export type FilterOption = {
  value: string;
  label?: string;
  count: number;
};

export type NumericFilterOption = {
  value: number;
  count: number;
};

export type NumericRange = {
  min: number | null;
  max: number | null;
};

export type ScreenerFiltersResponse = {
  product_types: FilterOption[];
  asset_classes?: FilterOption[];
  regions: FilterOption[];
  categories: FilterOption[];
  sectors: FilterOption[];
  management_styles: FilterOption[];
  gestionnaires: FilterOption[];
  sfdr_articles: NumericFilterOption[];
  ter_range: NumericRange;
  perf_3y_range: NumericRange;
};

// ─── Matching ─────────────────────────────────────────────────────────────────
// Source of truth : lib/matching.ts — ces types re-exportent pour que le
// frontend puisse importer depuis @/lib/types sans connaître l'implémentation.

export type { ClientProfile, MatchResult as MatchedFund } from "@/lib/matching";

export type MatchingResponse = {
  results: import("@/lib/matching").MatchResult[];
  profile: import("@/lib/matching").ClientProfile;
};

// ─── ParsedFilters (NLP → UI) ─────────────────────────────────────────────────
export type ParsedFilters = {
  sfdr?: number[];
  sri_min?: number;
  sri_max?: number;
  ter_max?: number;
  perf_1y_min?: number;
  perf_3y_min?: number;
  vol_max?: number;
  sharpe_min?: number;
  aum_min?: number;
  track_record_min?: number;
  retrocession_min?: number; // en % (ex: 0.5 = 0.5%)
  envelopes?: string[];
  universe?: string[];        // type de produit (opcvm, etf, scpi…)
  asset_class?: string[];     // classe d'actif large (action, obligation, diversifie…) → asset_class_broad
  region?: string[];         // zone géographique normalisée (world, europe, usa…)
  sector?: string[];
  management_style?: string[];
  currency?: string[];
  morningstar_min?: number;
  manager_search?: string;
  free_text?: string;
  has_kid?: boolean;
  chips?: string[];
};

// ─── FundDetailHF (fiche fonds — adapté aux données disponibles) ──────────────
export type NavPointHF = { date: string; nav: number };

export type FundDetailHF = {
  isin: string;
  name: string;
  gestionnaire: string | null;
  management_company: string | null;
  product_type: string | null;
  category: string | null;             // catégorie brute (non normalisée)
  category_normalized: string | null;
  asset_class_broad: string | null;    // classe d'actif large, normalisée (colonne de référence)
  asset_class: string | null;          // classe d'actif fine (peut contenir un secteur)
  region_normalized: string | null;
  region_exposure: string | null;      // exposition géographique brute
  currency: string | null;
  inception_date: string | null;
  track_record_years: number | null;
  hedged: boolean | null;              // version couverte en devise
  distributor_france: boolean | null;  // distribué en France
  ucits_compliant: boolean | null;     // conforme UCITS
  data_source: string | null;          // source legacy (fallback traçabilité)
  field_sources: Record<string, string> | null; // provenance par champ
  sfdr_article: number | null;
  risk_score: number | null;
  srri: number | null;
  management_style: string | null;
  performance_1y: number | null;
  performance_3y: number | null;
  performance_5y: number | null;
  average_performance: number | null;
  volatility_1y: number | null;
  volatility_3y: number | null;
  sharpe_1y: number | null;
  sharpe_3y: number | null;
  max_drawdown_1y: number | null;
  max_drawdown_3y: number | null;
  ongoing_charges: number | null;
  ter: number | null;
  pea_eligible: boolean | null;
  per_eligible: boolean | null;
  av_lux_eligible: boolean | null;
  av_fr_eligible: boolean | null;
  pea_pme_eligible: boolean | null;
  cto_eligible: boolean | null;
  // Frais détaillés (migration 20260529000004)
  entry_fee_max: number | null;
  exit_fee_max: number | null;
  performance_fee: number | null;
  retrocession_cgp: number | null;
  holding_period_years: number | null;
  aum_eur: number | null;
  morningstar_rating: number | null;
  labels: string[] | null;
  kid_url: string | null;
  data_completeness: number;
  nav_history: NavPointHF[];
  holdings: FundHoldingHF[];
  sectors: FundBreakdownHF[];
  geos: FundBreakdownHF[];
};

export type FundHoldingHF = {
  rank: number;
  position_name: string;
  ticker: string | null;
  asset_type: string | null;
  sector: string | null;
  country: string | null;
  weight: number;
};

export type FundBreakdownHF = {
  label: string;
  weight: number;
};
