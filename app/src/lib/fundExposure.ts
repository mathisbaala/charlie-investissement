// ─── Compositions géo / secteurs des fonds (Supabase, côté serveur) ───────────
// Lignes ExpoRow brutes par fonds, prêtes pour l'agrégation pondérée
// (`weightedExposure`). Partagées entre le rapport PDF et l'API
// /api/portfolio/exposure qui alimente les camemberts du portefeuille.

import { supabase } from "@/lib/supabase";
import { canonicalSector, type ExpoRow } from "@/lib/lookthrough";

/**
 * Lignes ExpoRow (clé = code pays) pour l'exposition géographique agrégée d'un
 * portefeuille. Le libellé canonique par code pays évite qu'un même pays compte
 * deux fois selon la langue du libellé (« United States » vs « États-Unis »).
 */
export async function fetchGeoRows(isins: string[]): Promise<ExpoRow[]> {
  const { data } = await supabase
    .from("investissement_fund_geos")
    .select("isin, country_label, country_code, weight")
    .in("isin", isins);
  const rows = (data ?? []) as { isin: string; country_label: string; country_code: string; weight: number }[];
  const codeLabel = new Map<string, string>();
  for (const g of rows) {
    const code = ((g.country_code || "").trim() || g.country_label || "").toUpperCase();
    if (code && !codeLabel.has(code)) codeLabel.set(code, g.country_label || g.country_code);
  }
  return rows.map((g) => {
    const code = ((g.country_code || "").trim() || g.country_label || "").toUpperCase();
    return { isin: g.isin, key: code, label: codeLabel.get(code) || g.country_label || g.country_code, weight: Number(g.weight) };
  });
}

/** Lignes ExpoRow (secteurs canoniques FR) pour l'exposition agrégée. */
export async function fetchSectorRows(isins: string[]): Promise<ExpoRow[]> {
  const { data } = await supabase
    .from("investissement_fund_sectors")
    .select("isin, sector_name, weight")
    .in("isin", isins);
  return ((data ?? []) as { isin: string; sector_name: string; weight: number }[])
    .map((srow) => ({ isin: srow.isin, label: canonicalSector(srow.sector_name) as string, weight: Number(srow.weight) }))
    .filter((srow) => srow.label != null);
}
