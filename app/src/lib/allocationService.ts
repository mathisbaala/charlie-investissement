import { supabase } from "./supabase";
import {
  optimizeAllocation,
  selectionScore,
  type FundInput,
  type AssetClass,
  type OptimizerConstraints,
  type AllocationResult,
} from "./optimizer";
import { toFundInputs, type FundRow } from "./allocationInput";
import { buildPresentation, type AllocationPresentation } from "./allocationRationale";

// Service serveur du moteur d'allocation : partagé par la route JSON
// (/api/portfolio/optimize) et la route PDF (…/pdf) pour ne pas dupliquer la
// chaîne DB → optimisation → restitution. Ne fait AUCUN rendu : renvoie les
// données ; la sérialisation (JSON/PDF) est le rôle des routes.

const VIEW = "investissement_funds_cgp_ref";
const COLS =
  "isin, name, product_type, asset_class_broad, category_normalized, " +
  "region_normalized, management_style, gestionnaire, risk_score, sfdr_article, " +
  "ter, ongoing_charges, performance_1y, performance_3y, performance_5y, " +
  "volatility_1y, volatility_3y, data_completeness";

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
}

export interface OptimizeOutput {
  allocation: AllocationResult;
  presentation: AllocationPresentation;
  meta: {
    contract: string;
    universe: number;
    optimizable: number;
    shortlisted: number;
    correlationWindow: unknown;
    droppedFromUniverse: number;
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
  c: number | null;
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

  // 2) Conversion + filtrage des non-optimisables.
  const { inputs, dropped } = toFundInputs((rows ?? []) as unknown as FundRow[]);
  if (inputs.length < minAssets) {
    return {
      error: "Univers insuffisant",
      detail: `${inputs.length} fonds optimisables dans ce contrat (< ${minAssets} requis).`,
      status: 422,
    };
  }

  // 3) Pré-sélection puis corrélation dédiée sur le shortlist.
  const candidates = shortlist(inputs, classTargets, riskFree);
  const isins = candidates.map((f) => f.isin);

  const { data: corrData, error: corrErr } = await supabase.rpc("inv_fund_correlation", {
    p_isins: isins,
    p_years: years,
  });
  if (corrErr) {
    return { error: "Corrélations indisponibles", detail: corrErr.message, status: 500 };
  }

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
  };
  const allocation = optimizeAllocation(candidates, corrOf, constraints);

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
    meta: {
      contract,
      universe: inputs.length + dropped,
      optimizable: inputs.length,
      shortlisted: candidates.length,
      correlationWindow: corrData?.window ?? null,
      droppedFromUniverse: dropped,
    },
  };
}

const VALID_CLASSES: AssetClass[] = [
  "actions",
  "obligations",
  "monetaire",
  "diversifie",
  "immobilier",
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
  return {
    contract,
    classTargets: parseTargets(p.get("targets")),
    minAssets,
    maxAssets,
    maxWeightedSri: p.get("maxSri") ? Number(p.get("maxSri")) : null,
    riskFree,
    years: Math.min(Math.max(Number(p.get("years")) || 3, 1), 10),
    mustInclude: (p.get("must") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ISIN_RE.test(s)),
    advisorName: p.get("advisor")?.trim() || null,
    asOfLabel: p.get("asOf")?.trim() || undefined,
  };
}
