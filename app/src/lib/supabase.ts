import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export type Fund = {
  isin: string;
  name: string;
  product_type: string;
  management_company?: string | null;
  gestionnaire?: string | null;
  sfdr_article: number | null;
  sri?: number | null;
  risk_score?: number | null;
  ongoing_charges: number | null;
  performance_1y: number | null;
  performance_3y: number | null;
  performance_5y: number | null;
  volatility_1y: number | null;
  sharpe_1y: number | null;
  aum_eur: number | null;
  morningstar_rating: number | null;
  pea_eligible: boolean | null;
  per_eligible: boolean | null;
  av_lux_eligible: boolean | null;
  inception_date: string | null;
  data_completeness: number;
};
