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

/** Rétrocession libre : tout type de frais non couvert par les champs dédiés. */
export interface CustomRetroFee {
  /** Intitulé libre (ex. « Commission sur encours SCPI »). */
  label: string;
  /** Taux en fraction (0.01 = 1 %) ; null tant que non renseigné. */
  rate: number | null;
}

export interface CabinetContract {
  /** Clé composite « Assureur::Contrat » (référencement de la base). */
  key: string;
  /** Part des frais de gestion du contrat reversée au cabinet (fraction d'encours/an, 0.005 = 0,50 %). */
  contractFeeShare: number | null;
  /** Part des frais courants des fonds (UC) rétrocédée (0.5 = 50 %). */
  ucRetroShare: number | null;
  /** Frais d'entrée reversés au cabinet (fraction des versements, une fois, 0.01 = 1 %). */
  entryFeeShare: number | null;
  /** Frais d'arbitrage reversés (fraction des montants arbitrés, 0.002 = 0,20 %). */
  arbitrageFeeShare: number | null;
  /** Rétrocession sur le fonds en euros (fraction d'encours euros/an). */
  eurosRetroShare: number | null;
  /** Autres rétrocessions, en saisie libre (intitulé + taux). */
  customFees: CustomRetroFee[];
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
  /**
   * Honoraire de conseil PONCTUEL facturé au client (€, hors rétrocession) —
   * bilan patrimonial, mission de conseil. 100 % revenu cabinet, en SUS des
   * frais du contrat. Politique par défaut du cabinet, surchargeable par étude.
   */
  honoraireForfait: number | null;
  /**
   * Honoraire de conseil RÉCURRENT (fraction de l'encours/an, 0.005 = 0,50 %/an) —
   * suivi annuel, mandat de conseil. 100 % revenu cabinet, facturé en SUS.
   */
  honoraireAnnuel: number | null;
}

export const EMPTY_CABINET: CabinetSettings = {
  cabinetName: "",
  insurers: [],
  contracts: [],
  honoraireForfait: null,
  honoraireAnnuel: null,
};

export function emptyContract(key: string): CabinetContract {
  return {
    key,
    contractFeeShare: null,
    ucRetroShare: null,
    entryFeeShare: null,
    arbitrageFeeShare: null,
    eurosRetroShare: null,
    customFees: [],
    fundOverrides: [],
  };
}

/**
 * Complète un contrat stocké avant l'ajout des nouveaux types de rétrocession
 * (frais d'entrée, arbitrage, fonds euros, saisie libre) : les champs absents
 * du localStorage reçoivent leur valeur vide au lieu de rester `undefined`.
 */
export function normalizeContract(c: Partial<CabinetContract> & { key: string }): CabinetContract {
  return { ...emptyContract(c.key), ...c, fundOverrides: c.fundOverrides ?? [], customFees: c.customFees ?? [] };
}

// ─── localStorage (même pattern que le profil client) ────────────────────────

const STORAGE_KEY = "charlie_cabinet_settings";
// v2 : les contrats sont ajoutés un à un via la recherche — fin du rattachement
// d'office de tout le catalogue d'un assureur partenaire.
const STORAGE_VERSION = 2;

export function loadStoredCabinet(): CabinetSettings {
  if (typeof window === "undefined") return EMPTY_CABINET;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CABINET;
    const { v, ...parsed } = JSON.parse(raw) as Partial<CabinetSettings> & { v?: number };
    // Contrats saisis avant l'ajout des nouveaux types de rétrocession.
    const contracts = (parsed.contracts ?? []).map(normalizeContract);
    return {
      ...EMPTY_CABINET,
      ...parsed,
      // Avant v2, TOUS les contrats d'un assureur partenaire étaient rattachés
      // d'office (convention vierge) : on ne garde que ceux réellement
      // renseignés. À partir de v2, chaque contrat listé a été choisi par le
      // CGP — on les conserve tels quels, même vierges.
      contracts: v == null ? contracts.filter(hasAnyConvention) : contracts,
    };
  } catch {
    return EMPTY_CABINET;
  }
}

export function saveStoredCabinet(c: CabinetSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...c, v: STORAGE_VERSION }));
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
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Contrats d'un assureur proposables à l'ajout dans l'onglet Cabinet :
 * référencés chez `company`, pas encore rattachés au cabinet, filtrés par la
 * recherche (casse et accents ignorés), tronqués à `limit`. Les contrats sont
 * ajoutés un à un — certains assureurs en référencent soixante, tout afficher
 * d'office rendait la page illisible. Exportée pour être testée isolément.
 */
export function searchInsurerContracts<T extends { company: string; key: string }>(
  referenced: T[],
  company: string,
  existingKeys: Set<string>,
  query: string,
  limit = 8,
): T[] {
  const q = norm(query.trim());
  return referenced
    .filter((o) => o.company === company && !existingKeys.has(o.key))
    .filter((o) => q === "" || norm(o.key).includes(q))
    .sort((a, b) => a.key.localeCompare(b.key, "fr"))
    .slice(0, limit);
}

/** Vrai si au moins un taux (ou une exception) est renseigné sur la convention. */
export function hasAnyConvention(contract: CabinetContract | null): boolean {
  if (!contract) return false;
  return (
    contract.contractFeeShare != null ||
    contract.ucRetroShare != null ||
    contract.entryFeeShare != null ||
    contract.arbitrageFeeShare != null ||
    contract.eurosRetroShare != null ||
    contract.customFees.some((f) => f.rate != null) ||
    contract.fundOverrides.length > 0
  );
}

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
