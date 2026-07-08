// Outil de recherche de fonds pour le chat IA (Charlie).
// Donne au modèle l'accès aux VRAIES données de la base afin qu'il cite des fonds
// existants (avec leur ISIN → lien vers la fiche), au lieu d'halluciner.

import { supabase } from "@/lib/supabase";
import { feeFracToPct } from "@/lib/format";
import { asExactIsin, expandSearchAliases } from "@/lib/search";

const VIEW = "investissement_funds_cgp_ref";

// Jeu de colonnes compact : assez pour répondre + comparer, sans surcharger le contexte.
const COLS = [
  "isin", "name", "gestionnaire", "product_type", "asset_class_broad",
  "region_normalized", "ter", "ongoing_charges", "performance_1y",
  "performance_3y", "performance_5y", "risk_score", "sfdr_article",
  "aum_eur", "morningstar_rating", "max_drawdown_3y",
  "pea_eligible", "per_eligible", "av_fr_eligible", "av_lux_eligible",
  "entry_fee_max",
].join(",");

type ChatFund = {
  isin: string;
  name: string;
  gestionnaire: string | null;
  product_type: string | null;
  asset_class: string | null;
  region: string | null;
  ter_pct: number | null;
  perf_1y: number | null;
  perf_3y: number | null;
  perf_5y: number | null;
  sri: number | null;
  sfdr_article: number | null;
  aum_eur: number | null;
  morningstar: number | null;
  max_drawdown_3y: number | null;
  envelopes: string[];
  url: string;
};

type Row = {
  isin: string; name: string; gestionnaire: string | null;
  product_type: string | null; asset_class_broad: string | null;
  region_normalized: string | null; ter: number | null; ongoing_charges: number | null;
  performance_1y: number | null; performance_3y: number | null; performance_5y: number | null;
  risk_score: number | null; sfdr_article: number | null; aum_eur: number | null;
  morningstar_rating: number | null; max_drawdown_3y: number | null;
  pea_eligible: boolean | null; per_eligible: boolean | null;
  av_fr_eligible: boolean | null; av_lux_eligible: boolean | null; entry_fee_max: number | null;
};

function toChatFund(r: Row): ChatFund {
  const envelopes: string[] = [];
  if (r.pea_eligible) envelopes.push("PEA");
  if (r.per_eligible) envelopes.push("PER");
  if (r.av_fr_eligible) envelopes.push("AV-FR");
  if (r.av_lux_eligible) envelopes.push("AV-LUX");
  return {
    isin: r.isin,
    name: r.name,
    gestionnaire: r.gestionnaire,
    product_type: r.product_type,
    asset_class: r.asset_class_broad,
    region: r.region_normalized,
    ter_pct: feeFracToPct(r.ter ?? r.ongoing_charges),
    perf_1y: r.performance_1y,
    perf_3y: r.performance_3y,
    perf_5y: r.performance_5y,
    sri: r.risk_score,
    sfdr_article: r.sfdr_article,
    aum_eur: r.aum_eur,
    morningstar: r.morningstar_rating,
    max_drawdown_3y: r.max_drawdown_3y,
    envelopes,
    url: `/fonds/${r.isin}`,
  };
}

/**
 * Recherche de fonds pour le chat. Mêmes garde-fous que le screener (part
 * primaire, complétude ≥ 50, univers curé hors action/crypto/fps). Un ISIN exact
 * renvoie directement le fonds visé (sans garde-fou d'univers).
 */
export async function searchFundsForChat(query: string, limit = 8): Promise<ChatFund[]> {
  // Même normalisation d'alias d'indices que le screener (« sp500 » → « s&p 500 »),
  // pour que chat et recherche s'accordent sur la même requête.
  const q = expandSearchAliases((query ?? "").trim());
  if (!q) return [];
  const lim = Math.max(1, Math.min(limit, 12));

  const exactIsin = asExactIsin(q);
  if (exactIsin) {
    const { data } = await supabase.from(VIEW).select(COLS).eq("isin", exactIsin).limit(1);
    return ((data as unknown as Row[]) ?? []).map(toChatFund);
  }

  // Même classement par PERTINENCE que le screener (RPC inv_funds_search : ticker/nom
  // exact > nom complet > autre colonne), pour que chat et screener s'accordent sur la
  // même requête. L'AUM ne départage plus qu'à pertinence égale. La RPC porte déjà les
  // garde-fous (part primaire, complétude ≥ 50, univers curé) — réappliqués par sûreté.
  const { data } = await (supabase as any)
    .rpc("inv_funds_search", { q })
    .select(`${COLS},relevance`)
    .gte("data_completeness", 50)
    .eq("is_primary_share_class", true)
    .not("product_type", "in", "(action,crypto,fps)")
    .order("relevance", { ascending: false, nullsFirst: false })
    .order("aum_eur", { ascending: false, nullsFirst: false })
    .limit(lim);

  return ((data as unknown as Row[]) ?? []).map(toChatFund);
}
