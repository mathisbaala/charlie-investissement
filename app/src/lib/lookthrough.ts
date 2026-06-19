// ─── Agrégation look-through (transparence portefeuille) ──────────────────────
// Logique pure (testable) de l'API /api/portfolio/lookthrough : exposition
// agrégée équipondérée + détection de doublons. Les poids en entrée sont des
// fractions (0-1) ; la sortie est en % (0-100).

export type ExpoRow = { isin: string; label: string; weight: number };
export type Expo = { label: string; weight: number };

// Lignes génériques / non identifiables → exclues de la détection de doublons.
export const GENERIC_POSITIONS = new Set([
  "autre", "autres", "other", "others", "cash", "liquidités", "liquidites",
  "divers", "n/a", "na", "non communiqué", "non communique", "-",
]);

/**
 * Exposition agrégée ÉQUIPONDÉRÉE sur les fonds qui portent la ventilation :
 * blended[label] = moyenne du poids sur ces fonds. La somme reste ~100 % (on
 * normalise sur les fonds contributeurs, sans révéler ceux qui n'ont pas la
 * donnée). Sortie triée décroissante, top `limit`.
 */
export function blendExposure(rows: ExpoRow[], limit = 12): Expo[] {
  const contributors = new Set(rows.map((r) => r.isin));
  const n = contributors.size;
  if (n === 0) return [];
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (r.weight == null || Number.isNaN(r.weight) || !r.label) continue;
    acc.set(r.label, (acc.get(r.label) ?? 0) + r.weight);
  }
  return Array.from(acc.entries())
    .map(([label, sum]) => ({ label, weight: Math.round((sum / n) * 1000) / 10 }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

export type HoldingRow = { isin: string; position_name: string | null; ticker: string | null; weight: number | null };
export type Overlap = {
  name: string; ticker: string | null; count: number;
  funds: { isin: string; weight: number }[]; max_weight: number;
};

/** Clé d'identité d'une ligne : ticker si présent, sinon nom normalisé. */
export function holdingKey(name: string, ticker: string | null): string {
  if (ticker) return ticker.toUpperCase();
  return name.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

/** Lignes détenues par ≥ 2 fonds (double-emploi), triées par nb de fonds puis poids. */
export function findOverlaps(holdings: HoldingRow[], limit = 20): Overlap[] {
  const byKey = new Map<string, { name: string; ticker: string | null; funds: Map<string, number> }>();
  for (const h of holdings) {
    const name = (h.position_name ?? "").trim();
    if (!name || GENERIC_POSITIONS.has(name.toLowerCase())) continue;
    const ticker = h.ticker ? String(h.ticker).toUpperCase() : null;
    const key = holdingKey(name, ticker);
    if (!byKey.has(key)) byKey.set(key, { name, ticker, funds: new Map() });
    byKey.get(key)!.funds.set(h.isin, Number(h.weight) || 0);
  }
  return Array.from(byKey.values())
    .filter((p) => p.funds.size >= 2)
    .map((p) => ({
      name: p.name,
      ticker: p.ticker,
      count: p.funds.size,
      funds: Array.from(p.funds.entries()).map(([isin, weight]) => ({
        isin, weight: Math.round(weight * 1000) / 10,
      })),
      max_weight: Math.round(Math.max(...p.funds.values()) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || b.max_weight - a.max_weight)
    .slice(0, limit);
}
