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
  allocation_profile: string | null;   // profil d'allocation (diversifiés) : prudent/equilibre/dynamique/flexible
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

  // Benchmark + alpha vs indice (migration 20260619100000). alpha_* déjà en %
  // (1y cumulé, 3y/5y annualisé). benchmark_is_category=true → indice de catégorie
  // (proxy), false → indice exact répliqué (ETF vanille).
  benchmark_index: string | null;
  benchmark_variant: string | null;
  benchmark_is_category: boolean | null;
  alpha_1y: number | null;
  alpha_3y: number | null;
  alpha_5y: number | null;

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

  // Référencement assurantiel (assureurs qui référencent le fonds — vue cgp_ref)
  insurers: string[] | null;

  // Tickers boursiers (ETF cotés ; multi-bourses : DCAM, DCAMEUR…). Sert à
  // retrouver un ETF par son code de cotation. Null pour les fonds non cotés.
  tickers: string[] | null;

  // Labels & qualité
  labels: string[] | null;
  kid_url: string | null;
  kid_parsed_at: string | null;
  share_class_group_id: string | null;
  data_completeness: number;
  data_source: string | null;
  field_sources: Record<string, string> | null;
  updated_at: string | null;
};

// ─── FundDetail (RPC get_fund_detail) ────────────────────────────────────────
// Inclut les champs bruts non exposés par la vue + percentiles peer-group
export type FundDetail = Fund & {
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
  | 'alpha_3y'
  | 'data_completeness';

// ─── Réponses API ─────────────────────────────────────────────────────────────

export type ScreenerResponse = {
  data: Fund[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  // true quand les résultats proviennent du filet de recherche approximative
  // (tolérance aux fautes) faute de correspondance exacte — l'UI peut le signaler.
  fuzzy?: boolean;
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

// ─── ParsedFilters (NLP → UI) ─────────────────────────────────────────────────
export type ParsedFilters = {
  sfdr?: number[];
  sri_min?: number;
  sri_max?: number;
  ter_max?: number;
  perf_1y_min?: number;
  perf_3y_min?: number;
  perf_5y_min?: number;
  vol_max?: number;           // volatilité 1 an max en %
  vol_3y_max?: number;        // volatilité 3 ans max en %
  sharpe_min?: number;        // ratio Sharpe 1 an min
  sharpe_3y_min?: number;     // ratio Sharpe 3 ans min
  drawdown_max?: number;      // perte max (magnitude positive) sur 3 ans, ex: 20 = drawdown limité à -20%
  no_entry_fee?: boolean;     // « sans frais d'entrée » : exclut les fonds à frais d'entrée connus
  aum_min?: number;
  track_record_min?: number;
  retrocession_min?: number; // en % (ex: 0.5 = 0.5%)
  envelopes?: string[];
  universe?: string[];        // type de produit (opcvm, etf, scpi…)
  asset_class?: string[];     // classe d'actif large (action, obligation, diversifie…) → asset_class_broad
  allocation_profile?: string[]; // profil d'allocation des diversifiés (prudent/equilibre/dynamique/flexible)
  insurers?: string[];        // assureurs référençant le fonds (ex: "AXA France", "SwissLife France")
  contracts?: string[];       // contrats précis, clé composite "Assureur::Contrat" (ex: "Suravenir::Linxea Spirit 2")
  gestionnaires?: string[];   // sélection rapide de sociétés de gestion (match exact, ex: "Amundi")
  region?: string[];         // zone géographique normalisée (world, europe, usa…)
  sector?: string[];
  exclude_sectors?: string[]; // secteurs à EXCLURE (négation : « peu exposé tech » → ["Technologie"])
  exclude_regions?: string[]; // zones à EXCLURE (négation : « hors US » → ["usa"])
  management_style?: string[];
  currency?: string[];
  morningstar_min?: number;
  manager_search?: string;
  free_text?: string;
  has_kid?: boolean;
  beats_benchmark?: boolean;  // « bat son indice » : alpha 3 ans > 0
  labels?: string[];          // labels officiels durabilité (isr/greenfin/finansol)
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
  tickers: string[] | null;            // tickers boursiers (ETF cotés : DCAM, DCAMEUR…)
  category: string | null;             // catégorie brute (non normalisée)
  category_normalized: string | null;
  asset_class_broad: string | null;    // classe d'actif large, normalisée (colonne de référence)
  asset_class: string | null;          // classe d'actif fine (peut contenir un secteur)
  allocation_profile: string | null;   // profil d'allocation (diversifiés) : prudent/equilibre/dynamique/flexible
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
  volatility_1y: number | null;
  volatility_3y: number | null;
  sharpe_1y: number | null;
  sharpe_3y: number | null;
  max_drawdown_1y: number | null;
  max_drawdown_3y: number | null;
  ongoing_charges: number | null;
  ter: number | null;
  // Benchmark + alpha vs indice (migration 20260619100000). alpha_* : écart
  // fonds − indice (1y cumulé, 3y/5y annualisé, %). benchmark_perf_* : rendement
  // de l'indice (cumulé %, annualisé à la lecture comme performance_*).
  // benchmark_is_category=true → indice de catégorie (proxy) ; false → indice
  // exact répliqué (ETF vanille). tracking_diff_* : legacy (déprécié, lu en repli).
  benchmark_index: string | null;
  benchmark_variant: string | null;   // 'net' | 'gross' | 'price'
  benchmark_is_category: boolean | null;
  benchmark_perf_1y: number | null;
  benchmark_perf_3y: number | null;
  benchmark_perf_5y: number | null;
  alpha_1y: number | null;
  alpha_3y: number | null;
  alpha_5y: number | null;
  tracking_diff_1y: number | null;
  tracking_diff_3y: number | null;
  tracking_diff_5y: number | null;
  // Durabilité / DDA (migration 20260619140000) : SFDR (sfdr_article) + labels
  // déjà présents ; ces 3 catégories MiFID sont enrichies en fond, null sinon.
  taxonomy_alignment_pct: number | null;
  sustainable_investment_pct: number | null;
  pai_considered: boolean | null;
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
  insurers?: FundInsurerRef[];  // référencement assurantiel (assureur + contrats)
};

// Référencement d'un fonds chez un assureur (sortie get_fund_insurers)
export type FundInsurerRef = {
  company: string;
  // Peut être null : get_fund_insurers renvoie un assureur référencé sans
  // liste de contrats détaillée. Toujours garder avec `?? []` avant .filter/.map.
  contracts: string[] | null;
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
