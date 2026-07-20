// Rattachement d'un fonds HORS CATALOGUE via son document (DIC/KID, reporting,
// term sheet de produit structuré) : l'extraction est faite par /api/dici/parse
// (déterministe puis Vision), ce module valide sa sortie côté client avant de
// l'injecter dans le tableau des positions de l'analyse de l'existant.
// Cas d'usage : les relevés portent souvent des supports absents de notre base
// (produits structurés dédiés, fonds confidentiels) — sans ce chemin ils sont
// barrés et EXCLUS de l'analyse ; avec lui, le CGP dépose le document du support
// et récupère nom/frais/SRI, suffisants pour les diagnostics client (frais
// moyens, SRI pondéré, concentration). Perf/corrélations restent hors de portée
// (aucun historique en base) : le RPC d'analyse ignore ces ISIN, par conception.

import { isValidIsin, scrubLabel } from "./releve";

/** Données validées d'un fonds lues dans son document déposé. */
export interface FundReportData {
  isin: string;
  name: string | null;
  /** Frais courants annuels en % (même unité que ReleveApiPosition.ter). */
  ter: number | null;
  sri: number | null;
  /** Vrai si le fonds est finalement AU catalogue (matched_isin) : l'appelant
   *  peut alors enrichir depuis la base plutôt que du document. */
  catalogued: boolean;
}

export type FundReportOutcome =
  | { ok: true; fund: FundReportData }
  | { ok: false; error: string };

/**
 * Valide la fiche renvoyée par /api/dici/parse pour l'ajout d'un fonds.
 *
 * `expectedIsin` (optionnel) : ISIN de la ligne du relevé pour laquelle le CGP
 * dépose le document. Deux garde-fous en découlent :
 *   - document sans ISIN lisible → on retombe sur l'ISIN attendu (le CGP a
 *     désigné la ligne, le document ne fait que la documenter) ;
 *   - ISIN lisible mais DIFFÉRENT → refus explicite : attacher les frais/SRI
 *     d'un autre support fausserait le diagnostic sans que rien ne le signale.
 */
export function sanitizeFundReport(
  fiche: unknown,
  expectedIsin?: string,
): FundReportOutcome {
  const f = (fiche ?? {}) as Record<string, unknown>;

  const rawIsin = typeof f.isin === "string" ? f.isin.trim().toUpperCase() : "";
  const docIsin = isValidIsin(rawIsin) ? rawIsin : null;
  if (expectedIsin && docIsin && docIsin !== expectedIsin) {
    return {
      ok: false,
      error: `le document concerne ${docIsin}, pas ${expectedIsin} — vérifiez le fichier déposé`,
    };
  }
  const isin = docIsin ?? expectedIsin ?? null;
  if (!isin) {
    return { ok: false, error: "aucun code ISIN lisible dans ce document" };
  }

  // Nom : celui du document, nettoyé comme tout texte issu d'un PDF déposé.
  const name =
    typeof f.name === "string" && f.name.trim().length >= 2
      ? scrubLabel(f.name).slice(0, 120) || null
      : null;

  // Frais courants déjà en % côté API (0.25 = 0,25 %). Bornes plausibles :
  // une valeur aberrante trahit une mauvaise lecture, on préfère null.
  const ter =
    typeof f.ongoing_charges === "number" &&
    Number.isFinite(f.ongoing_charges) &&
    f.ongoing_charges >= 0 &&
    f.ongoing_charges <= 20
      ? Math.round(f.ongoing_charges * 100) / 100
      : null;

  const sri =
    typeof f.sri === "number" && Number.isInteger(f.sri) && f.sri >= 1 && f.sri <= 7
      ? f.sri
      : null;

  const catalogued = typeof f.matched_isin === "string" && f.matched_isin === isin;

  return { ok: true, fund: { isin, name, ter, sri, catalogued } };
}
