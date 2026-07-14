// Générateur de restitution — construit la présentation d'allocation à partir du
// résultat d'optimisation. 100 % DÉTERMINISTE (aucun appel LLM/API payante) :
// le texte est produit par un banc de phrases piloté par les données du fonds
// (classe d'actifs, catégorie, style, SFDR, SRI, poids). La structure reprend le
// modèle « proposition / Cardif ELITE » fourni : contexte & objectifs, répartition
// par classe, tableau détaillé, justification par support, profil de risque
// (SRI + SFDR), convictions de gestion, avertissements MIF II.

import type { AllocationResult, AllocationLine, AssetClass } from "./optimizer";

export interface PresentationOptions {
  contractName: string;
  /** Nom de profil (sinon déduit du SRI moyen pondéré). */
  profileLabel?: string;
  /** Taille de l'univers du contrat (nb de supports disponibles). */
  universeSize?: number | null;
  /** Libellé de date (ex. « Février 2026 ») — pas de Date.now() ici (pur). */
  asOfLabel?: string;
  /** Cabinet / conseiller, pour l'en-tête. */
  advisorName?: string | null;
}

export interface ClassBreakdownRow {
  assetClass: AssetClass;
  label: string;
  weight: number;
  role: string;
}

export interface SriBucket {
  sri: number;
  weight: number;
}

export interface SfdrBucket {
  article: number | "n/a";
  weight: number;
  funds: number;
}

export interface AllocationPresentation {
  title: string;
  subtitle: string;
  advisor: string | null;
  asOf: string | null;
  headline: {
    supports: number;
    weightedSri: number | null;
    expectedReturnPct: number;
    volatilityPct: number;
    profileLabel: string;
  };
  objectives: string[];
  classBreakdown: ClassBreakdownRow[];
  table: AllocationLine[];
  perFundRationale: { isin: string; name: string; text: string }[];
  riskProfile: {
    sriDistribution: SriBucket[];
    weightedSri: number | null;
    profileLabel: string;
    sfdrDistribution: SfdrBucket[];
  };
  convictions: { title: string; text: string }[];
  disclaimers: string[];
}

const CLASS_LABEL: Record<AssetClass, string> = {
  actions: "Actions",
  obligations: "Obligations / Crédit",
  monetaire: "Monétaire",
  diversifie: "Allocations flexibles",
  immobilier: "Immobilier (SCPI / SCI)",
  alternatif: "Alternatif (Private Equity)",
  crypto: "Crypto-actifs",
  fonds_euros: "Fonds Euros",
};

const CLASS_ROLE: Record<AssetClass, string> = {
  actions: "Moteur de performance long terme, diversifié géographiquement.",
  obligations: "Portage et diversification obligataire, volatilité maîtrisée.",
  monetaire: "Réserve de liquidité tactique, absorbe les mouvements.",
  diversifie: "Alpha tactique, gestion active multi-actifs.",
  immobilier: "Rendement récurrent et décorrélation des marchés cotés.",
  alternatif: "Prime d'illiquidité du non coté, moteur de performance long terme.",
  crypto: "Poche de dynamisation décorrélée, dimensionnée et bornée.",
  fonds_euros: "Ancre défensive à capital garanti, liquidité immédiate.",
};

/** Profil d'investisseur déduit du SRI moyen pondéré (échelle 1–7). */
export function profileFromSri(sri: number | null): string {
  if (sri == null) return "Sur mesure";
  if (sri < 2.5) return "Prudent";
  if (sri < 3.5) return "Modéré";
  if (sri < 4.5) return "Équilibré";
  if (sri < 5.5) return "Dynamique";
  return "Offensif";
}

function pct(x: number, digits = 1): number {
  const p = Math.pow(10, digits);
  return Math.round(x * 100 * p) / p;
}

function sfdrLabel(a: number | "n/a"): string {
  if (a === "n/a") return "Non classé (Art. 6)";
  return `Article ${a}`;
}

/** Justification d'un support : style de gestion, classe, SFDR, SRI, rôle, poids. */
export function fundRationale(line: AllocationLine): string {
  const parts: string[] = [];
  const cat = line.category || CLASS_LABEL[line.assetClass];
  const style =
    line.category && /etf|indiciel|tracker/i.test(line.category)
      ? "gestion indicielle à bas coût"
      : "gestion active";

  // Phrase 1 : nature + rôle dans la poche.
  parts.push(
    `${cat} retenu en ${style}. ${roleSentence(line)}`,
  );

  // Phrase 2 : couple rendement/risque observé.
  const r = pct(line.expectedReturn);
  const v = pct(line.volatility);
  if (Number.isFinite(r) && Number.isFinite(v)) {
    parts.push(
      `Rendement annualisé attendu ~${r} % pour une volatilité ~${v} %` +
        (line.sri != null ? ` (SRI ${line.sri})` : "") +
        ".",
    );
  }

  // Phrase 3 : durabilité si Article 8/9.
  if (line.sfdr === 8 || line.sfdr === 9) {
    parts.push(
      line.sfdr === 9
        ? "Classé Article 9 SFDR (objectif d'investissement durable)."
        : "Classé Article 8 SFDR (caractéristiques ESG promues).",
    );
  }

  // Phrase 4 : justification du poids.
  parts.push(weightSentence(line));

  return parts.join(" ");
}

function roleSentence(line: AllocationLine): string {
  switch (line.assetClass) {
    case "fonds_euros":
      return "Socle défensif du portefeuille : garantie en capital et amortisseur des chocs de marché.";
    case "monetaire":
      return "Réserve de liquidité quasi sans risque, tampon des souscriptions/rachats.";
    case "obligations":
      return "Source de portage et de diversification, atténue la volatilité globale.";
    case "diversifie":
      return "Brique flexible : le gérant ajuste l'exposition selon le cycle de marché.";
    case "actions":
      return "Contribue au moteur de performance actions du portefeuille.";
    case "immobilier":
      return "Apporte un rendement récurrent peu corrélé aux marchés cotés.";
    case "crypto":
      return "Poche de dynamisation, volontairement plafonnée pour borner le risque.";
    default:
      return "Contribue à la diversification d'ensemble.";
  }
}

function weightSentence(line: AllocationLine): string {
  if (line.weight >= 15)
    return `Position de conviction (${line.weight} %), pilier de l'allocation.`;
  if (line.weight >= 7)
    return `Pondération significative (${line.weight} %) au service du couple rendement/risque.`;
  return `Pondération mesurée (${line.weight} %) pour diversifier sans concentrer le risque.`;
}

/** Distribution du poids par SRI (buckets 1–7), pour l'histogramme de risque. */
export function sriDistribution(lines: AllocationLine[]): SriBucket[] {
  const buckets: SriBucket[] = Array.from({ length: 7 }, (_, i) => ({
    sri: i + 1,
    weight: 0,
  }));
  for (const l of lines) {
    if (l.sri != null && l.sri >= 1 && l.sri <= 7) {
      buckets[l.sri - 1].weight += l.weight;
    }
  }
  return buckets.map((b) => ({ sri: b.sri, weight: Math.round(b.weight * 10) / 10 }));
}

/** Répartition du poids par article SFDR (6/8/9 ; « n/a » → Article 6). */
export function sfdrDistribution(lines: AllocationLine[]): SfdrBucket[] {
  const map = new Map<number | "n/a", { weight: number; funds: number }>();
  for (const l of lines) {
    const key: number | "n/a" = l.sfdr === 8 || l.sfdr === 9 ? l.sfdr : 6;
    const cur = map.get(key) ?? { weight: 0, funds: 0 };
    cur.weight += l.weight;
    cur.funds += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([article, v]) => ({
      article,
      weight: Math.round(v.weight * 10) / 10,
      funds: v.funds,
    }))
    .sort((a, b) => Number(b.article) - Number(a.article));
}

/** Construit la présentation complète à partir du résultat d'optimisation. */
export function buildPresentation(
  result: AllocationResult,
  opts: PresentationOptions,
): AllocationPresentation {
  const profileLabel = opts.profileLabel ?? profileFromSri(result.weightedSri);
  const expectedReturnPct = pct(result.expectedReturn);
  const volatilityPct = pct(result.volatility);

  // Répartition par classe, triée par poids décroissant.
  const classBreakdown: ClassBreakdownRow[] = (
    Object.entries(result.classWeights) as [AssetClass, number][]
  )
    .map(([assetClass, weight]) => ({
      assetClass,
      label: CLASS_LABEL[assetClass],
      weight: Math.round(weight * 10) / 10,
      role: CLASS_ROLE[assetClass],
    }))
    .sort((a, b) => b.weight - a.weight);

  const objectives: string[] = [
    `Performance annualisée cible : ~${expectedReturnPct} % (taux sans risque + prime de risque du portefeuille).`,
    `Volatilité attendue : ~${volatilityPct} % annualisée.`,
    result.weightedSri != null
      ? `SRI moyen pondéré : ~${round1(result.weightedSri)} / 7, profil ${profileLabel}.`
      : `Profil ${profileLabel}.`,
    opts.universeSize
      ? `Univers d'investissement : ${opts.universeSize} supports du contrat ${opts.contractName}.`
      : `Univers d'investissement : supports du contrat ${opts.contractName}.`,
    `Nombre de supports retenus : ${result.lines.length} (allocation resserrée, 4 à 7 lignes).`,
  ];

  // Convictions = 3 lignes de plus fort poids + une conviction sur le coût moyen.
  const top = [...result.lines].sort((a, b) => b.weight - a.weight).slice(0, 3);
  const convictions = top.map((l) => ({
    title: `${l.name} : ${l.weight} %`,
    text: fundRationale(l),
  }));
  const avgTer = weightedTer(result.lines);
  if (avgTer != null) {
    convictions.push({
      title: `Coût moyen ~${round2(avgTer * 100)} %`,
      text:
        "Frais courants moyens pondérés maîtrisés, optimisés par le recours aux ETF sur les poches efficientes.",
    });
  }

  return {
    title: `Allocation ${profileLabel}, ${opts.contractName}`,
    subtitle: `${result.lines.length} supports · profil ${profileLabel}`,
    advisor: opts.advisorName ?? null,
    asOf: opts.asOfLabel ?? null,
    headline: {
      supports: result.lines.length,
      weightedSri: result.weightedSri != null ? round1(result.weightedSri) : null,
      expectedReturnPct,
      volatilityPct,
      profileLabel,
    },
    objectives,
    classBreakdown,
    table: result.lines,
    perFundRationale: result.lines.map((l) => ({
      isin: l.isin,
      name: l.name,
      text: fundRationale(l),
    })),
    riskProfile: {
      sriDistribution: sriDistribution(result.lines),
      weightedSri: result.weightedSri != null ? round1(result.weightedSri) : null,
      profileLabel,
      sfdrDistribution: sfdrDistribution(result.lines),
    },
    convictions,
    disclaimers: [
      "Les performances passées ne préjugent pas des performances futures.",
      "Les unités de compte ne bénéficient pas de la garantie en capital : la valeur des placements peut évoluer à la hausse comme à la baisse.",
      "Ce document est informatif et ne constitue pas un conseil en investissement personnalisé au sens de la directive MIF II.",
      "L'investisseur est invité à lire les documents d'informations clés (DIC/DICI) avant toute souscription.",
    ],
  };
}

function weightedTer(lines: AllocationLine[]): number | null {
  let acc = 0;
  let wsum = 0;
  for (const l of lines) {
    if (l.ter != null && Number.isFinite(l.ter)) {
      acc += l.ter * l.weight;
      wsum += l.weight;
    }
  }
  return wsum > 0 ? acc / wsum : null;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export { sfdrLabel };
