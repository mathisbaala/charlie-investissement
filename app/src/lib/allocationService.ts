import { supabase } from "./supabase";
import {
  optimizeAllocation,
  selectionScore,
  COMMISSION_TIE_BREAK_TOL,
  type FundInput,
  type AssetClass,
  type AllocationMethod,
  type OptimizerConstraints,
  type AllocationResult,
} from "./optimizer";
import { toFundInputs, type FundRow } from "./allocationInput";
import { buildPresentation, type AllocationPresentation } from "./allocationRationale";
import { filterUniverse, GEO_TO_REGIONS } from "./profileToConstraints";

// Service serveur du moteur d'allocation : partagé par la route JSON
// (/api/portfolio/optimize) et la route PDF (…/pdf) pour ne pas dupliquer la
// chaîne DB → optimisation → restitution. Ne fait AUCUN rendu : renvoie les
// données ; la sérialisation (JSON/PDF) est le rôle des routes.

const VIEW = "investissement_funds_cgp_ref";
const COLS =
  "isin, name, product_type, asset_class_broad, category_normalized, " +
  "region_normalized, management_style, gestionnaire, risk_score, sfdr_article, " +
  "morningstar_rating, ter, ongoing_charges, performance_1y, performance_3y, " +
  "performance_5y, volatility_1y, volatility_3y, data_completeness";

export interface OptimizeParams {
  contract: string; // « Assureur::Contrat »
  classTargets?: Partial<Record<AssetClass, number>>;
  minAssets: number;
  maxAssets: number;
  maxWeightedSri: number | null;
  riskFree: number; // fraction
  years: number;
  mustInclude: string[];
  advisorName?: string | null;
  asOfLabel?: string;
  /** Zones géographiques du profil (vocabulaire UI : monde, europe, amerique_nord…). */
  geographies?: string[];
  /** Préférence ESG (art8 / art9). */
  esg?: string | null;
  /** Frais courants max, en pourcentage. */
  terMax?: number | null;
  /** Plafond SRI par fonds (adéquation MIF). */
  sriMax?: number | null;
  /** ISIN écartés à la main par le conseiller. */
  exclude?: string[];
  /** Méthode de pondération : max-Sharpe (défaut) ou HRP. */
  method?: AllocationMethod;
  /** Départage rétrocession à adéquation client équivalente (choix conseiller). */
  retroTieBreak?: boolean;
  /**
   * Taux de rétrocession UC de la convention du cabinet pour ce contrat
   * (fraction des frais courants, ex 0.5). Quand il est fourni, il remplace
   * l'estimation de place pour les fonds à rétrocession (les fonds indiciels
   * restent à 0 — ils ne rétrocèdent pas). Les exceptions par fonds restent
   * résolues côté client (affichage).
   */
  ucRetroShare?: number | null;
}

/**
 * Applique le taux de convention UC du cabinet aux fonds de l'univers :
 * retro = taux × frais courants — sauf pour les fonds qui ne rétrocèdent pas
 * (estimation à 0 : indiciels/ETF), qui restent à 0. Sans taux, l'univers est
 * renvoyé tel quel (estimation de place). Fonction pure (testable).
 */
export function applyUcRetroShare(
  funds: FundInput[],
  ucRetroShare: number | null | undefined,
): FundInput[] {
  if (ucRetroShare == null) return funds;
  return funds.map((f) => {
    if (f.retrocession === 0) return f; // indiciel : pas de rétro, convention ou pas
    if (f.ter == null) return f; // frais inconnus : on garde l'estimation
    return { ...f, retrocession: ucRetroShare * f.ter };
  });
}

export interface OptimizeOutput {
  allocation: AllocationResult;
  presentation: AllocationPresentation;
  /** Matrice de corrélation des lignes retenues (alignée sur allocation.lines). */
  correlations: {
    isins: string[];
    names: string[];
    matrix: (number | null)[][];
  };
  meta: {
    contract: string;
    universe: number;
    optimizable: number;
    shortlisted: number;
    correlationWindow: unknown;
    droppedFromUniverse: number;
    droppedByPreferences: number;
  };
}

export interface OptimizeError {
  error: string;
  detail?: string;
  status: number;
}

/**
 * Pré-sélection : borne le nombre de candidats envoyés au calcul de corrélation
 * (coût O(n²)). Garde les meilleurs par score, en représentant chaque classe
 * cible (quota), puis complète jusqu'à `cap`.
 */
export function shortlist(
  funds: FundInput[],
  targets: Partial<Record<AssetClass, number>> | undefined,
  riskFree: number,
  cap = 40,
): FundInput[] {
  const ranked = [...funds].sort(
    (a, b) => selectionScore(b, riskFree) - selectionScore(a, riskFree) || a.isin.localeCompare(b.isin),
  );
  if (ranked.length <= cap) return ranked;

  const picked = new Map<string, FundInput>();
  for (const cls of Object.keys(targets ?? {}) as AssetClass[]) {
    let n = 0;
    for (const f of ranked) {
      if (n >= 8) break;
      if (f.assetClass === cls && !picked.has(f.isin)) {
        picked.set(f.isin, f);
        n += 1;
      }
    }
  }
  for (const f of ranked) {
    if (picked.size >= cap) break;
    if (!picked.has(f.isin)) picked.set(f.isin, f);
  }
  return [...picked.values()];
}

interface CorrPair {
  a: string;
  b: string;
  /** Nombre de rendements hebdo communs ayant servi au calcul. */
  n?: number;
  /** Coefficient, ou null si la paire est sous le seuil de points du RPC. */
  c: number | null;
}

/**
 * ISIN dont l'historique de VL est trop court pour des corrélations fiables
 * (moins de `minPoints` rendements hebdo sur la fenêtre). Leurs paires seront
 * `null` côté RPC et remplacées par les priors de classe côté optimiseur — on
 * le signale au conseiller plutôt que de le masquer.
 */
export function lowCoverageIsins(
  coverage: { isin: string; n_points: number }[] | null | undefined,
  minPoints: number,
): Set<string> {
  const out = new Set<string>();
  for (const c of coverage ?? []) {
    if ((c.n_points ?? 0) < minPoints) out.add(c.isin);
  }
  return out;
}

/** Exécute la chaîne complète d'optimisation d'un contrat. */
export async function optimizeContract(
  params: OptimizeParams,
): Promise<OptimizeOutput | OptimizeError> {
  const {
    contract,
    classTargets,
    minAssets,
    maxAssets,
    maxWeightedSri,
    riskFree,
    years,
    mustInclude,
  } = params;

  // 1) Fonds du contrat (share-class primaire), plafonné pour rester borné.
  const { data: rows, error } = await supabase
    .from(VIEW)
    .select(COLS)
    .overlaps("contracts", [contract])
    .eq("is_primary_share_class", true)
    .limit(600);

  if (error) {
    return { error: "Univers du contrat indisponible", detail: error.message, status: 500 };
  }

  // 2) Conversion + filtrage des non-optimisables. Le taux de convention UC du
  // cabinet, s'il est fourni, remplace l'estimation de place des rétrocessions.
  const converted = toFundInputs((rows ?? []) as unknown as FundRow[]);
  const inputs = applyUcRetroShare(converted.inputs, params.ucRetroShare);
  const dropped = converted.dropped;
  if (inputs.length < minAssets) {
    return {
      error: "Univers insuffisant",
      detail: `${inputs.length} fonds optimisables dans ce contrat (< ${minAssets} requis).`,
      status: 422,
    };
  }

  // 2 bis) Filtres de préférence (profil client + réglages conseiller), avec
  // assouplissement progressif si l'univers restant ne permet plus de diversifier :
  // d'abord la contrainte géographique, puis toutes les préférences — mais JAMAIS
  // les exclusions manuelles du conseiller.
  const filterOpts = {
    maxTer: params.terMax ?? null,
    esg: params.esg ?? null,
    geographies: params.geographies ?? [],
    sriMax: params.sriMax ?? null,
    exclude: params.exclude ?? [],
  };
  const filterNotes: string[] = [];
  // Tant que la contrainte géographique est active, chaque zone demandée devra
  // aussi être REPRÉSENTÉE dans la sélection (cf. coverRegions). Si elle est
  // levée pour préserver la diversification, la couverture l'est aussi.
  let geoActive = (params.geographies?.length ?? 0) > 0;
  let filtered = filterUniverse(inputs, filterOpts);
  if (filtered.funds.length < minAssets && geoActive) {
    const retry = filterUniverse(inputs, { ...filterOpts, geographies: [] });
    if (retry.funds.length >= minAssets) {
      filtered = retry;
      geoActive = false;
      filterNotes.push(
        "Zones géographiques trop restrictives sur ce contrat : contrainte levée pour préserver la diversification.",
      );
    }
  }
  if (filtered.funds.length < minAssets) {
    const bare = filterUniverse(inputs, { exclude: params.exclude ?? [] });
    if (bare.funds.length >= minAssets) {
      filtered = bare;
      geoActive = false;
      filterNotes.push(
        "Préférences du profil trop restrictives sur ce contrat : allocation calculée sur l'univers complet.",
      );
    } else {
      return {
        error: "Univers insuffisant",
        detail: `${bare.funds.length} fonds restants après exclusions (< ${minAssets} requis).`,
        status: 422,
      };
    }
  }
  // Ré-injecte les supports imposés écartés par les préférences (pas les exclus).
  const excludedSet = new Set((params.exclude ?? []).map((s) => s.toUpperCase()));
  const universe = [...filtered.funds];
  for (const isin of mustInclude) {
    if (excludedSet.has(isin.toUpperCase())) continue;
    if (universe.some((f) => f.isin === isin)) continue;
    const f = inputs.find((x) => x.isin === isin);
    if (f) universe.push(f);
  }

  // 3) Pré-sélection puis corrélation dédiée sur le shortlist.
  const candidates = shortlist(universe, classTargets, riskFree);
  const isins = candidates.map((f) => f.isin);

  const { data: corrData, error: corrErr } = await supabase.rpc("inv_fund_correlation", {
    p_isins: isins,
    p_years: years,
  });
  // RPC absent (migration non appliquée) ou en erreur : on N'ÉCHOUE PAS —
  // toutes les paires restent inconnues et le moteur applique ses priors par
  // classe d'actifs. Dégradé honnête (signalé en note) plutôt que panne.
  const corrUnavailable = corrErr != null;

  const corrMap = new Map<string, number | null>();
  const pairs: CorrPair[] = (corrData?.pairs ?? []) as CorrPair[];
  for (const pr of pairs) {
    corrMap.set(`${pr.a}|${pr.b}`, pr.c);
    corrMap.set(`${pr.b}|${pr.a}`, pr.c);
  }
  const corrOf = (a: string, b: string): number | null =>
    a === b ? 1 : corrMap.has(`${a}|${b}`) ? corrMap.get(`${a}|${b}`)! : null;

  // 4) Optimisation + restitution.
  const constraints: Partial<OptimizerConstraints> = {
    minAssets,
    maxAssets,
    classTargets,
    maxWeightedSri,
    riskFree,
    mustInclude,
    method: params.method ?? "sharpe",
    commissionTieBreak: params.retroTieBreak ? COMMISSION_TIE_BREAK_TOL : 0,
    coverRegions: geoActive
      ? (params.geographies ?? [])
          .map((g) => ({ zone: g, regions: GEO_TO_REGIONS[g] ?? [] }))
          .filter((z) => z.regions.length > 0)
      : undefined,
  };
  const allocation = optimizeAllocation(candidates, corrOf, constraints);
  allocation.notes.unshift(...filterNotes);
  if (corrUnavailable) {
    allocation.notes.push(
      "Corrélations historiques indisponibles sur la base (fonction de calcul absente ou en erreur) : corrélations prudentes par classe d'actifs utilisées pour toute l'allocation.",
    );
  }

  // Fonds retenus dont l'historique de VL est trop court pour des corrélations
  // observées : le conseiller doit savoir que leurs corrélations sont des priors.
  const minPoints = Number(
    (corrData?.window as { min_points?: number } | null)?.min_points ?? 26,
  );
  const weakIsins = lowCoverageIsins(
    (corrData?.coverage ?? null) as { isin: string; n_points: number }[] | null,
    minPoints,
  );
  const weakLines = allocation.lines.filter((l) => weakIsins.has(l.isin));
  if (weakLines.length > 0) {
    allocation.notes.push(
      `Historique de VL limité pour ${weakLines.map((l) => l.name).join(", ")} ` +
        `(moins de ${minPoints} points hebdomadaires) : corrélations estimées par classe d'actifs.`,
    );
  }

  // Matrice de corrélation des lignes retenues (pour l'affichage studio).
  const lineIsins = allocation.lines.map((l) => l.isin);
  const corrMatrix = lineIsins.map((a) => lineIsins.map((b) => corrOf(a, b)));

  const contractName = contract.split("::")[1] ?? contract;
  const presentation = buildPresentation(allocation, {
    contractName,
    universeSize: inputs.length + dropped,
    asOfLabel: params.asOfLabel,
    advisorName: params.advisorName ?? null,
  });

  return {
    allocation,
    presentation,
    correlations: {
      isins: lineIsins,
      names: allocation.lines.map((l) => l.name),
      matrix: corrMatrix,
    },
    meta: {
      contract,
      universe: inputs.length + dropped,
      optimizable: inputs.length,
      shortlisted: candidates.length,
      correlationWindow: corrData?.window ?? null,
      droppedFromUniverse: dropped,
      droppedByPreferences: filtered.dropped,
    },
  };
}

const VALID_CLASSES: AssetClass[] = [
  "actions",
  "obligations",
  "monetaire",
  "diversifie",
  "immobilier",
  "alternatif",
  "crypto",
  "fonds_euros",
];

/** Parse « actions:60,obligations:30,crypto:10 » → { actions:60, ... }. */
export function parseTargets(
  raw: string | null,
): Partial<Record<AssetClass, number>> | undefined {
  if (!raw) return undefined;
  const out: Partial<Record<AssetClass, number>> = {};
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":").map((x) => x.trim());
    const cls = k as AssetClass;
    const num = Number(v);
    if (VALID_CLASSES.includes(cls) && Number.isFinite(num) && num > 0) {
      out[cls] = (out[cls] ?? 0) + num;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/;

/** Construit les paramètres d'optimisation depuis les query params d'une requête. */
export function paramsFromQuery(p: URLSearchParams): OptimizeParams | { error: string } {
  const contract = (p.get("contract") ?? "").trim();
  if (!contract || !contract.includes("::")) {
    return { error: "Paramètre 'contract' requis (format « Assureur::Contrat »)." };
  }
  const minAssets = Math.min(Math.max(Number(p.get("min")) || 4, 2), 10);
  const maxAssets = Math.min(Math.max(Number(p.get("max")) || 7, minAssets), 12);
  const rfRaw = p.get("rf");
  const riskFree = rfRaw !== null && Number.isFinite(Number(rfRaw)) ? Number(rfRaw) / 100 : 0.02;
  const isinList = (raw: string | null): string[] =>
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ISIN_RE.test(s));
  const esgRaw = p.get("esg")?.trim().toLowerCase() || null;
  const terMaxRaw = p.get("terMax");
  const sriMaxRaw = p.get("sriMax");
  return {
    contract,
    classTargets: parseTargets(p.get("targets")),
    minAssets,
    maxAssets,
    maxWeightedSri: p.get("maxSri") ? Number(p.get("maxSri")) : null,
    riskFree,
    years: Math.min(Math.max(Number(p.get("years")) || 3, 1), 10),
    mustInclude: isinList(p.get("must")),
    advisorName: p.get("advisor")?.trim() || null,
    asOfLabel: p.get("asOf")?.trim() || undefined,
    geographies: (p.get("geo") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s in GEO_TO_REGIONS),
    esg: esgRaw === "art8" || esgRaw === "art9" ? esgRaw : null,
    terMax:
      terMaxRaw !== null && Number.isFinite(Number(terMaxRaw)) && Number(terMaxRaw) > 0
        ? Number(terMaxRaw)
        : null,
    sriMax:
      sriMaxRaw !== null && Number.isFinite(Number(sriMaxRaw))
        ? Math.min(Math.max(Math.round(Number(sriMaxRaw)), 1), 7)
        : null,
    exclude: isinList(p.get("exclude")),
    method: p.get("method")?.trim().toLowerCase() === "hrp" ? "hrp" : "sharpe",
    retroTieBreak: p.get("retro") === "1",
    // ucShare : taux de convention UC en POURCENTAGE (50 = 50 % des frais).
    ucRetroShare: (() => {
      const raw = p.get("ucShare");
      if (raw === null) return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return null;
      return Math.min(n, 100) / 100;
    })(),
  };
}
