// Adaptateur données → moteur d'allocation. Convertit une ligne de fonds (schéma
// screener / investissement_funds) en `FundInput` pour l'optimiseur :
//  - mappe product_type / asset_class_broad → classe d'actifs canonique ;
//  - annualise les performances cumulées 3A/5A (comme la frontière API) et
//    passe TOUT en FRACTIONS (l'optimiseur raisonne en fractions, jamais en %).
// Fonctions pures et testables (aucun accès DB).

import { annualizeCumul } from "./format";
import { estimateRetroFrac } from "./remuneration";
import type { FundInput, AssetClass } from "./optimizer";

/** Ligne de fonds telle qu'exposée par le RPC screener (unités base). */
export interface FundRow {
  isin: string;
  name: string;
  product_type?: string | null;
  asset_class_broad?: string | null;
  category_normalized?: string | null;
  region_normalized?: string | null;
  management_style?: string | null;
  gestionnaire?: string | null;
  risk_score?: number | null; // SRI 1–7
  sfdr_article?: number | null;
  morningstar_rating?: number | null; // 1–5 étoiles

  ter?: number | null; // fraction
  ongoing_charges?: number | null; // fraction
  performance_1y?: number | null; // % annuel
  performance_3y?: number | null; // % CUMULÉ sur 3 ans
  performance_5y?: number | null; // % CUMULÉ sur 5 ans
  volatility_1y?: number | null; // %
  volatility_3y?: number | null; // %
  data_completeness?: number | null;
}

// Classe d'actifs canonique depuis asset_class_broad (prioritaire) puis product_type.
const BROAD_MAP: Record<string, AssetClass> = {
  action: "actions",
  actions: "actions",
  obligation: "obligations",
  obligations: "obligations",
  monetaire: "monetaire",
  "monétaire": "monetaire",
  diversifie: "diversifie",
  "diversifié": "diversifie",
  immobilier: "immobilier",
  alternatif: "alternatif",
  crypto: "crypto",
  fonds_euros: "fonds_euros",
};

const PRODUCT_MAP: Record<string, AssetClass> = {
  scpi: "immobilier",
  opci: "immobilier",
  private_equity: "alternatif",
  fcpr: "alternatif",
  crypto: "crypto",
  livret: "fonds_euros",
  fonds_euros: "fonds_euros",
};

/**
 * Classe d'actifs canonique d'un fonds, ou `null` si non classable (le fonds est
 * alors écarté de l'optimisation plutôt que rangé arbitrairement).
 */
export function canonicalAssetClass(row: FundRow): AssetClass | null {
  const broad = (row.asset_class_broad ?? "").trim().toLowerCase();
  if (broad && BROAD_MAP[broad]) return BROAD_MAP[broad];
  const pt = (row.product_type ?? "").trim().toLowerCase();
  if (pt && PRODUCT_MAP[pt]) return PRODUCT_MAP[pt];
  // ETF/OPCVM sans classe large exploitable : non classable ici.
  return null;
}

/**
 * Rendement annualisé attendu, en %/an : priorité au 3 ans annualisé (le plus
 * stable), repli sur 5 ans annualisé puis 1 an. `null` si aucun disponible.
 */
export function expectedAnnualReturnPct(row: FundRow): number | null {
  const a3 = annualizeCumul(row.performance_3y ?? null, 3);
  if (a3 != null) return a3;
  const a5 = annualizeCumul(row.performance_5y ?? null, 5);
  if (a5 != null) return a5;
  return row.performance_1y ?? null;
}

/**
 * Rétrocession distributeur ESTIMÉE, en fraction de l'encours/an, tant que les
 * conventions de distribution réelles du cabinet ne sont pas saisies. Règle de
 * place : la gestion passive (ETF/indiciel) ne rétrocède rien ; la gestion
 * active rétrocède typiquement ~50 % des frais courants au distributeur.
 * `null` si les frais sont inconnus (aucune estimation possible).
 */
export function estimateRetrocession(row: FundRow): number | null {
  // Règle de place mutualisée avec lib/remuneration (source de vérité unique).
  return estimateRetroFrac(row.ongoing_charges ?? row.ter ?? null, row.product_type, row.management_style);
}

/**
 * Convertit une ligne de fonds en `FundInput`. Renvoie `null` si le fonds n'est
 * pas optimisable (classe d'actifs inconnue, ou rendement/volatilité manquants —
 * l'optimisation moyenne-variance exige les deux).
 */
export function toFundInput(row: FundRow): FundInput | null {
  const assetClass = canonicalAssetClass(row);
  if (!assetClass) return null;

  const retPct = expectedAnnualReturnPct(row);
  const volPct = row.volatility_3y ?? row.volatility_1y ?? null;
  if (retPct == null || volPct == null || volPct <= 0) return null;

  const ter = row.ongoing_charges ?? row.ter ?? null;

  return {
    isin: row.isin,
    name: row.name,
    assetClass,
    category: row.category_normalized ?? null,
    sri: row.risk_score ?? null,
    expectedReturn: retPct / 100,
    volatility: volPct / 100,
    ter: ter ?? null,
    retrocession: estimateRetrocession(row),
    sfdr: row.sfdr_article ?? null,
    rating: row.morningstar_rating ?? null,
    managementStyle: row.management_style ?? null,
    gestionnaire: row.gestionnaire ?? null,
    region: row.region_normalized ?? null,
    dataCompleteness: row.data_completeness ?? null,
  };
}

/** Convertit un lot de lignes en `FundInput`, en écartant les non-optimisables. */
export function toFundInputs(rows: FundRow[]): {
  inputs: FundInput[];
  dropped: number;
} {
  const inputs: FundInput[] = [];
  let dropped = 0;
  for (const r of rows) {
    const fi = toFundInput(r);
    if (fi) inputs.push(fi);
    else dropped += 1;
  }
  return { inputs, dropped };
}
