// ─────────────────────────────────────────────────────────────────────────────
// Récupération serveur des données « riches » des PDF factsheet : historique de
// VL (courbes base 100) et composition par fonds (géo / secteurs / lignes). Isolé
// des routes pour être réutilisable (rapport fonds + portefeuille). Tolérant aux
// trous : un fonds sans donnée renvoie une entrée vide, jamais d'exception.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import { canonicalSector, type ExpoRow } from "@/lib/lookthrough";
import type { Pt, Slice } from "@/lib/pdf/chartMath";

export type { Slice };
export type FundComposition = { geos: Slice[]; sectors: Slice[]; holdings: Slice[] };

/** Date ISO (AAAA-MM-JJ) il y a `years` années, pour borner l'historique. */
function cutoffDate(years: number, now: number = Date.now()): string {
  return new Date(now - years * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Historique de VL par ISIN sur `years` années, trié par date croissante.
 * Une requête par fonds (en parallèle) pour éviter le plafond PostgREST de 1000
 * lignes sur un lot multi-fonds (cf. piège pagination). Renvoie des points
 * {t: epoch ms, v: nav}. Les fonds sans historique sont absents de la map.
 */
export async function fetchNavSeries(isins: string[], years = 5): Promise<Record<string, Pt[]>> {
  const from = cutoffDate(years);
  const out: Record<string, Pt[]> = {};
  await Promise.all(
    isins.map(async (isin) => {
      const { data } = await supabase
        .from("investissement_fund_prices")
        .select("price_date, nav")
        .eq("isin", isin)
        .gte("price_date", from)
        .order("price_date", { ascending: true })
        .limit(1600);
      const pts = (data ?? [])
        .map((r) => ({ t: new Date(r.price_date as string).getTime(), v: Number(r.nav) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0);
      if (pts.length >= 2) out[isin] = pts;
    }),
  );
  return out;
}

/** Top `n` d'une liste de poids agrégés par libellé (somme, tri décroissant). */
function topByLabel(rows: { label: string | null; weight: number }[], n: number): Slice[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (!r.label || !Number.isFinite(r.weight) || r.weight <= 0) continue;
    acc.set(r.label, (acc.get(r.label) ?? 0) + r.weight);
  }
  return Array.from(acc.entries())
    .map(([label, weight]) => ({ label, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}

/**
 * Composition par fonds : zones géographiques (canonicalisées par code pays),
 * secteurs (libellé FR canonique) et principales lignes détenues. Lots batchés
 * (un appel par dimension, filtre `in`).
 */
export async function fetchCompositionByFund(isins: string[]): Promise<Record<string, FundComposition>> {
  const [geoRes, secRes, holdRes] = await Promise.all([
    supabase.from("investissement_fund_geos").select("isin, country_label, country_code, weight").in("isin", isins),
    supabase.from("investissement_fund_sectors").select("isin, sector_name, weight").in("isin", isins),
    supabase.from("investissement_fund_holdings").select("isin, position_name, weight").in("isin", isins).limit(4000),
  ]);

  // Libellé canonique par code pays (un pays = une ligne quelle que soit la langue).
  const geoRows = (geoRes.data ?? []) as { isin: string; country_label: string; country_code: string; weight: number }[];
  const codeLabel = new Map<string, string>();
  for (const g of geoRows) {
    const code = ((g.country_code || "").trim() || g.country_label || "").toUpperCase();
    if (code && !codeLabel.has(code)) codeLabel.set(code, g.country_label || g.country_code);
  }

  const byFund: Record<string, { geo: { label: string; weight: number }[]; sec: { label: string | null; weight: number }[]; hold: { label: string; weight: number }[] }> = {};
  const ensure = (isin: string) => (byFund[isin] ??= { geo: [], sec: [], hold: [] });

  for (const g of geoRows) {
    const code = ((g.country_code || "").trim() || g.country_label || "").toUpperCase();
    ensure(g.isin).geo.push({ label: codeLabel.get(code) || g.country_label || g.country_code, weight: Number(g.weight) });
  }
  for (const srow of (secRes.data ?? []) as { isin: string; sector_name: string; weight: number }[]) {
    ensure(srow.isin).sec.push({ label: canonicalSector(srow.sector_name), weight: Number(srow.weight) });
  }
  for (const h of (holdRes.data ?? []) as { isin: string; position_name: string; weight: number }[]) {
    if (h.position_name) ensure(h.isin).hold.push({ label: h.position_name, weight: Number(h.weight) });
  }

  const out: Record<string, FundComposition> = {};
  for (const isin of Object.keys(byFund)) {
    const b = byFund[isin];
    out[isin] = {
      geos: topByLabel(b.geo, 6),
      sectors: topByLabel(b.sec.filter((x) => x.label) as { label: string; weight: number }[], 6),
      holdings: topByLabel(b.hold, 8),
    };
  }
  return out;
}

/**
 * Lignes ExpoRow (clé = code pays) pour l'exposition géographique agrégée d'un
 * portefeuille. Réutilise la même canonicalisation que la composition par fonds.
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
