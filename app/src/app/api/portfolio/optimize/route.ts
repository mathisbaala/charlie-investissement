import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  optimizeAllocation,
  selectionScore,
  type FundInput,
  type AssetClass,
  type OptimizerConstraints,
} from "@/lib/optimizer";
import { toFundInputs, type FundRow } from "@/lib/allocationInput";
import { buildPresentation } from "@/lib/allocationRationale";

export const dynamic = "force-dynamic";

// Optimiseur d'allocation par contrat : sélectionne 4–7 supports du contrat et
// calcule les poids maximisant le ratio de Sharpe sous contraintes de classes
// d'actifs et de risque, puis génère la restitution (déterministe, sans IA).
//
// Chaîne : vue investissement_funds_cgp_ref (fonds du contrat) → toFundInputs →
// pré-sélection → RPC inv_fund_correlation (corrélation dédiée) → optimizeAllocation
// → buildPresentation. Tout le calcul lourd est testé unitairement (src/test).

const VIEW = "investissement_funds_cgp_ref";
const COLS =
  "isin, name, product_type, asset_class_broad, category_normalized, " +
  "region_normalized, management_style, gestionnaire, risk_score, sfdr_article, " +
  "ter, ongoing_charges, performance_1y, performance_3y, performance_5y, " +
  "volatility_1y, volatility_3y, data_completeness";

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
function parseTargets(raw: string | null): Partial<Record<AssetClass, number>> | undefined {
  if (!raw) return undefined;
  const out: Partial<Record<AssetClass, number>> = {};
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":").map((s) => s.trim());
    const cls = k as AssetClass;
    const num = Number(v);
    if (VALID_CLASSES.includes(cls) && Number.isFinite(num) && num > 0) {
      out[cls] = (out[cls] ?? 0) + num;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/;

/**
 * Pré-sélection : borne le nombre de candidats envoyés au calcul de corrélation
 * (coût O(n²)). On garde les meilleurs par score, en veillant à représenter
 * chaque classe cible, puis on complète jusqu'à `cap`.
 */
function shortlist(
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
  // Quota par classe cible (top 8 chacune) pour garantir la couverture.
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
  // Complète par score global.
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = req.nextUrl.searchParams;

  // Contrat obligatoire : clé « Assureur::Contrat » (cf. get_contracts_list).
  const contract = (p.get("contract") ?? "").trim();
  if (!contract || !contract.includes("::")) {
    return NextResponse.json(
      { error: "Paramètre 'contract' requis (format « Assureur::Contrat »)." },
      { status: 400 },
    );
  }

  const classTargets = parseTargets(p.get("targets"));
  const minAssets = Math.min(Math.max(Number(p.get("min")) || 4, 2), 10);
  const maxAssets = Math.min(Math.max(Number(p.get("max")) || 7, minAssets), 12);
  const maxWeightedSri = p.get("maxSri") ? Number(p.get("maxSri")) : null;
  const riskFree = Number.isFinite(Number(p.get("rf"))) && p.get("rf") !== null
    ? Number(p.get("rf")) / 100
    : 0.02;
  const years = Math.min(Math.max(Number(p.get("years")) || 3, 1), 10);
  const mustInclude = (p.get("must") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => ISIN_RE.test(s));

  // 1) Fonds du contrat (share-class primaire), plafonné pour rester borné.
  const { data: rows, error } = await supabase
    .from(VIEW)
    .select(COLS)
    .overlaps("contracts", [contract])
    .eq("is_primary_share_class", true)
    .limit(600);

  if (error) {
    return NextResponse.json(
      { error: "Univers du contrat indisponible", detail: error.message },
      { status: 500 },
    );
  }

  // 2) Conversion + filtrage des non-optimisables.
  const { inputs, dropped } = toFundInputs((rows ?? []) as unknown as FundRow[]);
  if (inputs.length < minAssets) {
    return NextResponse.json(
      {
        error: "Univers insuffisant",
        detail: `${inputs.length} fonds optimisables dans ce contrat (< ${minAssets} requis).`,
      },
      { status: 422 },
    );
  }

  // 3) Pré-sélection puis corrélation dédiée sur le shortlist.
  const candidates = shortlist(inputs, classTargets, riskFree);
  const isins = candidates.map((f) => f.isin);

  const { data: corrData, error: corrErr } = await supabase.rpc("inv_fund_correlation", {
    p_isins: isins,
    p_years: years,
  });
  if (corrErr) {
    return NextResponse.json(
      { error: "Corrélations indisponibles", detail: corrErr.message },
      { status: 500 },
    );
  }

  // corrOf : lookup symétrique dans les paires renvoyées (null si absente).
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
    asOfLabel: p.get("asOf")?.trim() || undefined,
    advisorName: p.get("advisor")?.trim() || null,
  });

  return NextResponse.json(
    {
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
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
