// ─── Agrégation look-through (transparence portefeuille) ──────────────────────
// Logique pure (testable) de l'API /api/portfolio/lookthrough : exposition
// agrégée équipondérée + détection de doublons. Les poids en entrée sont des
// fractions (0-1) ; la sortie est en % (0-100).

// `key` (optionnel) = identité d'agrégation stable inter-sources (ex. code ISO
// pays) : deux libellés différents d'une même entité (« Germany »/« Allemagne »,
// tous deux code `DE`) fusionnent en une seule ligne au lieu d'être double-comptés.
// Absent → on agrège par `label` (rétrocompatible).
export type ExpoRow = { isin: string; label: string; weight: number; key?: string };
export type Expo = { label: string; weight: number };

/** Libellé canonique d'une clé = le plus fréquent dans le panier (tie-break alpha). */
function pickLabel(votes: Map<string, number>): string {
  return Array.from(votes.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

// Lignes génériques / non identifiables → exclues de la détection de doublons.
export const GENERIC_POSITIONS = new Set([
  "autre", "autres", "other", "others", "cash", "liquidités", "liquidites",
  "divers", "n/a", "na", "non communiqué", "non communique", "-",
]);

// ─── Canonicalisation des secteurs ────────────────────────────────────────────
// La base mélange 3 taxonomies de secteurs : Morningstar (« Technology »), GICS
// (« Information Technology ») et des traductions FR (« Technologie »). Sans
// canonicalisation, un panier multi-sources triple-compte le même secteur. On
// rabat les variantes dominantes (clé = nom en minuscules) sur un libellé FR
// unique. La longue traîne GICS fine (« Aerospace & Defense »…) et les secteurs
// obligataires (« Treasury »…) passent tels quels (collisions rares à 1-4 fonds).
const SECTOR_CANON: Record<string, string> = {
  "technology": "Technologie", "information technology": "Technologie", "technologie": "Technologie",
  "financial services": "Services financiers", "financials": "Services financiers",
  "financial": "Services financiers", "services financiers": "Services financiers",
  "healthcare": "Santé", "health care": "Santé", "santé": "Santé",
  "consumer cyclical": "Consommation cyclique", "consumer discretionary": "Consommation cyclique",
  "consumer, cyclical": "Consommation cyclique", "biens de consommation cycliques": "Consommation cyclique",
  "consumer defensive": "Consommation défensive", "consumer staples": "Consommation défensive",
  "consumer non-cyclical": "Consommation défensive", "consumer, non-cyclical": "Consommation défensive",
  "biens de consommation non cycliques": "Consommation défensive",
  "industrials": "Industrie", "industrial": "Industrie", "industrie": "Industrie",
  "basic materials": "Matériaux", "materials": "Matériaux", "matières premières": "Matériaux",
  "communication services": "Communication", "communication": "Communication",
  "communications": "Communication", "télécommunication": "Communication",
  "telecommunications": "Communication", "telecommunication services": "Communication",
  "energy": "Énergie", "énergie": "Énergie",
  "utilities": "Services aux collectivités",
  "real estate": "Immobilier", "immobilier": "Immobilier", "reits": "Immobilier",
};
// Junk évident à NE PAS afficher comme secteur (artefacts d'enrichers).
const ISIN_LIKE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const SECTOR_JUNK = new Set(["unknown", "fx", "volatilité sur 1 an (en eur)"]);

/** Libellé de secteur canonique (FR) ; null si junk (ISIN collé, artefact) à écarter. */
export function canonicalSector(name: string | null): string | null {
  if (!name) return null;
  const t = name.trim();
  if (!t || ISIN_LIKE.test(t)) return null;
  const low = t.toLowerCase();
  if (SECTOR_JUNK.has(low)) return null;
  return SECTOR_CANON[low] ?? t;
}

/**
 * Exposition agrégée PONDÉRÉE par les poids du portefeuille (pas équipondérée) :
 * contribution d'une ligne = poids du fonds × poids interne de la ligne. On
 * normalise sur les seuls fonds qui PORTENT la ventilation (somme de leurs poids),
 * afin que le total reste ~100 % sans révéler les fonds sans donnée. `fundWeights`
 * est en fraction de portefeuille (0-1) ; `weight` des lignes en fraction (0-1).
 * Sortie en % (0-100), triée décroissante, top `limit`.
 */
export function weightedExposure(
  rows: ExpoRow[],
  fundWeights: Record<string, number>,
  limit = 10,
): Expo[] {
  const contributors = new Set(rows.filter((r) => r.label && Number.isFinite(r.weight)).map((r) => r.isin));
  let wsum = 0;
  for (const isin of contributors) wsum += fundWeights[isin] ?? 0;
  if (wsum <= 0) return [];
  const acc = new Map<string, number>();
  const labelVotes = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.label || !Number.isFinite(r.weight)) continue;
    const fw = fundWeights[r.isin] ?? 0;
    if (fw <= 0) continue;
    const key = r.key || r.label;
    acc.set(key, (acc.get(key) ?? 0) + fw * r.weight);
    const votes = labelVotes.get(key) ?? new Map<string, number>();
    votes.set(r.label, (votes.get(r.label) ?? 0) + 1);
    labelVotes.set(key, votes);
  }
  return Array.from(acc.entries())
    .map(([key, sum]) => ({ label: pickLabel(labelVotes.get(key)!), weight: Math.round((sum / wsum) * 1000) / 10 }))
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
