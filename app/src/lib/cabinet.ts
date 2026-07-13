// ─── Cabinet — partenariats assureurs, contrats et conventions de rétrocession ─
//
// Données STRUCTURELLES du cabinet (pas du client) : avec quels assureurs le
// CGP travaille, quels contrats il distribue, et ce que prévoient ses
// conventions de distribution. Saisies une fois dans l'onglet Cabinet,
// réutilisées partout — l'allocation n'a plus à demander « quel contrat ? »
// en saisie libre, et la rémunération estimée repose sur les vrais taux.
//
// Modèle des rétrocessions : CASCADE, comme les conventions réelles.
//  1. Exception par fonds (part des frais courants du fonds, ex 0,60) ;
//  2. sinon taux UC par défaut du contrat (ex 0,50 = « 50 % des frais de
//     gestion des UC ») ;
//  3. sinon estimation de place (cf. estimateRetrocession — ~50 % des frais
//     en gestion active, 0 sur l'indiciel).
// S'y ajoute la part des frais de gestion du CONTRAT (fraction d'encours/an,
// ex 0,005 = 0,50 %), identique pour toutes les lignes du contrat — elle ne
// départage donc pas les fonds entre eux, mais compte dans la rémunération.

export interface FundRetroOverride {
  isin: string;
  /** Part des frais courants du fonds rétrocédée (0.6 = 60 %). */
  share: number;
}

export interface CabinetContract {
  /** Clé composite « Assureur::Contrat » (référencement de la base). */
  key: string;
  /** Part des frais de gestion du contrat reversée au cabinet (fraction d'encours/an, 0.005 = 0,50 %). */
  contractFeeShare: number | null;
  /** Part des frais courants des fonds (UC) rétrocédée (0.5 = 50 %). */
  ucRetroShare: number | null;
  /** Exceptions par fonds (prioritaires sur ucRetroShare). */
  fundOverrides: FundRetroOverride[];
}

export interface CabinetSettings {
  /** Nom du cabinet / conseiller (pré-rempli dans les restitutions). */
  cabinetName: string;
  /** Assureurs partenaires (mêmes valeurs que le référencement). */
  insurers: string[];
  /** Contrats distribués, avec leur convention. */
  contracts: CabinetContract[];
}

export const EMPTY_CABINET: CabinetSettings = {
  cabinetName: "",
  insurers: [],
  contracts: [],
};

export function emptyContract(key: string): CabinetContract {
  return { key, contractFeeShare: null, ucRetroShare: null, fundOverrides: [] };
}

// ─── localStorage (même pattern que le profil client) ────────────────────────

const STORAGE_KEY = "charlie_cabinet_settings";

export function loadStoredCabinet(): CabinetSettings {
  if (typeof window === "undefined") return EMPTY_CABINET;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CABINET;
    return { ...EMPTY_CABINET, ...(JSON.parse(raw) as Partial<CabinetSettings>) };
  } catch {
    return EMPTY_CABINET;
  }
}

export function saveStoredCabinet(c: CabinetSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

// ─── Résolution de la cascade ─────────────────────────────────────────────────

/** Convention du contrat `key`, ou null si le cabinet ne l'a pas renseignée. */
export function cabinetContract(
  cab: CabinetSettings,
  key: string,
): CabinetContract | null {
  return cab.contracts.find((c) => c.key === key) ?? null;
}

/**
 * Part des frais courants rétrocédée pour un fonds donné : exception par fonds,
 * sinon taux UC par défaut du contrat, sinon `null` (l'appelant retombe alors
 * sur l'estimation de place).
 */
export function resolveUcRetroShare(
  contract: CabinetContract | null,
  isin: string,
): number | null {
  if (!contract) return null;
  const ov = contract.fundOverrides.find(
    (o) => o.isin.toUpperCase() === isin.toUpperCase(),
  );
  if (ov) return ov.share;
  return contract.ucRetroShare;
}

/**
 * Rétrocession UC d'un fonds (fraction d'encours/an) via la cascade :
 * part résolue × frais courants du fonds — ou `fallback` (estimation de place)
 * quand la convention ou les frais manquent. La part contrat
 * (`contractFeeShare`) n'est PAS incluse ici : elle est uniforme sur le
 * contrat et s'ajoute au niveau du portefeuille.
 */
export function resolveFundRetrocession(
  contract: CabinetContract | null,
  isin: string,
  fundFees: number | null,
  fallback: number | null,
): number | null {
  const share = resolveUcRetroShare(contract, isin);
  if (share == null || fundFees == null) return fallback;
  return share * fundFees;
}
