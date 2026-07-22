// Barèmes fiscaux partagés par les calculateurs de transmission. Valeurs en
// vigueur en 2026 (inchangées depuis 2011 pour les DMTG — tranches et
// abattements ne sont plus indexés). Tout ce qui change chaque année (taux
// d'intérêt du crédit fractionné…) reste un CHAMP du calculateur avec défaut,
// jamais une constante ici.

import { eur } from "./types";

// ─── Liens de parenté (vocabulaire commun aux calculateurs DMTG) ─────────────

export type LienParente =
  | "enfant" // ligne directe (enfant, parent)
  | "epoux" // époux / partenaire PACS
  | "petit_enfant"
  | "arriere_petit_enfant"
  | "frere_soeur"
  | "neveu_niece"
  | "parent_4e_degre"
  | "autre"; // au-delà du 4e degré et non-parents

export const LIEN_OPTIONS: { value: LienParente; label: string }[] = [
  { value: "enfant", label: "Enfant / parent (ligne directe)" },
  { value: "epoux", label: "Époux / partenaire PACS" },
  { value: "petit_enfant", label: "Petit-enfant" },
  { value: "arriere_petit_enfant", label: "Arrière-petit-enfant" },
  { value: "frere_soeur", label: "Frère / sœur" },
  { value: "neveu_niece", label: "Neveu / nièce" },
  { value: "parent_4e_degre", label: "Parent jusqu'au 4ᵉ degré" },
  { value: "autre", label: "Autre / sans lien de parenté" },
];

// ─── Barème progressif (art. 777 CGI) ────────────────────────────────────────

export interface Tranche {
  /** Borne haute de la tranche (Infinity pour la dernière). */
  jusqua: number;
  taux: number; // fraction (0.20 = 20 %)
}

/** Tableau I — ligne directe (enfants, parents, et petits-enfants par représentation). */
export const BAREME_LIGNE_DIRECTE: Tranche[] = [
  { jusqua: 8_072, taux: 0.05 },
  { jusqua: 12_109, taux: 0.1 },
  { jusqua: 15_932, taux: 0.15 },
  { jusqua: 552_324, taux: 0.2 },
  { jusqua: 902_838, taux: 0.3 },
  { jusqua: 1_805_677, taux: 0.4 },
  { jusqua: Infinity, taux: 0.45 },
];

/** Tableau II — entre époux et partenaires PACS (donations ; les successions sont exonérées). */
export const BAREME_EPOUX: Tranche[] = [
  { jusqua: 8_072, taux: 0.05 },
  { jusqua: 15_932, taux: 0.1 },
  { jusqua: 31_865, taux: 0.15 },
  { jusqua: 552_324, taux: 0.2 },
  { jusqua: 902_838, taux: 0.3 },
  { jusqua: 1_805_677, taux: 0.4 },
  { jusqua: Infinity, taux: 0.45 },
];

/** Tableau III — entre frères et sœurs. */
export const BAREME_FRERE_SOEUR: Tranche[] = [
  { jusqua: 24_430, taux: 0.35 },
  { jusqua: Infinity, taux: 0.45 },
];

/** Parents jusqu'au 4ᵉ degré : taux unique 55 %. Au-delà et non-parents : 60 %. */
export const BAREME_4E_DEGRE: Tranche[] = [{ jusqua: Infinity, taux: 0.55 }];
export const BAREME_AUTRE: Tranche[] = [{ jusqua: Infinity, taux: 0.6 }];

export function baremeForLien(lien: LienParente): Tranche[] {
  switch (lien) {
    case "enfant":
    case "petit_enfant":
    case "arriere_petit_enfant":
      return BAREME_LIGNE_DIRECTE;
    case "epoux":
      return BAREME_EPOUX;
    case "frere_soeur":
      return BAREME_FRERE_SOEUR;
    case "neveu_niece":
    case "parent_4e_degre":
      return BAREME_4E_DEGRE;
    case "autre":
      return BAREME_AUTRE;
  }
}

export interface TrancheDetail {
  /** « 8 072 € à 12 109 € » */
  tranche: string;
  taux: number;
  assiette: number;
  droits: number;
}

export interface BaremeResult {
  droits: number;
  detail: TrancheDetail[];
}

/** Applique un barème progressif à une base taxable ; détail tranche par tranche. */
export function applyBareme(tranches: Tranche[], base: number): BaremeResult {
  const detail: TrancheDetail[] = [];
  let droits = 0;
  let plancher = 0;
  for (const t of tranches) {
    if (base <= plancher) break;
    const assiette = Math.min(base, t.jusqua) - plancher;
    const d = assiette * t.taux;
    detail.push({
      tranche:
        t.jusqua === Infinity
          ? `Au-delà de ${eur(plancher)}`
          : `${eur(plancher)} à ${eur(t.jusqua)}`,
      taux: t.taux,
      assiette,
      droits: d,
    });
    droits += d;
    plancher = t.jusqua;
  }
  return { droits, detail };
}

// ─── Abattements (art. 779, 790 B/D/E/F/G CGI) ───────────────────────────────

/** Abattement personnel en DONATION selon le lien. */
export function abattementDonation(lien: LienParente): number {
  switch (lien) {
    case "enfant":
      return 100_000; // 779 I
    case "epoux":
      return 80_724; // 790 E/F
    case "petit_enfant":
      return 31_865; // 790 B
    case "arriere_petit_enfant":
      return 5_310; // 790 D
    case "frere_soeur":
      return 15_932; // 779 IV
    case "neveu_niece":
      return 7_967; // 779 V
    default:
      return 0;
  }
}

/**
 * Abattement personnel en SUCCESSION selon le lien. Époux/PACS : exonération
 * totale (loi TEPA, 796-0 bis) — à traiter en amont, cette fonction renvoie
 * Infinity pour le signaler. Défaut sans autre abattement : 1 594 € (788 IV).
 */
export function abattementSuccession(lien: LienParente): number {
  switch (lien) {
    case "enfant":
      return 100_000;
    case "epoux":
      return Infinity; // exonéré
    case "petit_enfant":
    case "arriere_petit_enfant":
      return 1_594; // sauf représentation (alors 100 000 partagé) — géré par le calculateur
    case "frere_soeur":
      return 15_932;
    case "neveu_niece":
      return 7_967;
    default:
      return 1_594;
  }
}

/** Abattement supplémentaire handicap, cumulable (779 II). */
export const ABATTEMENT_HANDICAP = 159_325;

/** Dons familiaux de sommes d'argent (790 G) — donateur < 80 ans, donataire majeur. */
export const ABATTEMENT_DON_SOMMES = 31_865;

// ─── Démembrement (art. 669 CGI) ─────────────────────────────────────────────

/** Valeur fiscale de l'USUFRUIT viager en fraction de la pleine propriété (669 I). */
export function usufruitViager(ageUsufruitier: number): number {
  if (ageUsufruitier < 21) return 0.9;
  if (ageUsufruitier < 31) return 0.8;
  if (ageUsufruitier < 41) return 0.7;
  if (ageUsufruitier < 51) return 0.6;
  if (ageUsufruitier < 61) return 0.5;
  if (ageUsufruitier < 71) return 0.4;
  if (ageUsufruitier < 81) return 0.3;
  if (ageUsufruitier < 91) return 0.2;
  return 0.1;
}

/** Usufruit temporaire : 23 % par tranche de 10 ans, plafonné à l'usufruit viager (669 II). */
export function usufruitTemporaire(dureeAnnees: number, ageUsufruitier?: number): number {
  const parDuree = Math.min(Math.ceil(dureeAnnees / 10) * 0.23, 0.9);
  if (ageUsufruitier == null) return parDuree;
  return Math.min(parDuree, usufruitViager(ageUsufruitier));
}

// ─── Assurance-vie (art. 990 I et 757 B CGI) ─────────────────────────────────

/** 990 I — primes versées avant 70 ans : abattement par bénéficiaire puis 20 % / 31,25 %. */
export const AV_990I_ABATTEMENT = 152_500;
export const AV_990I_SEUIL_2E_TAUX = 700_000; // après abattement
export const AV_990I_TAUX_1 = 0.2;
export const AV_990I_TAUX_2 = 0.3125;

/** Prélèvement 990 I pour la part (après exonérations) d'UN bénéficiaire non exonéré. */
export function prelevement990I(partBeneficiaire: number): number {
  const base = Math.max(0, partBeneficiaire - AV_990I_ABATTEMENT);
  const t1 = Math.min(base, AV_990I_SEUIL_2E_TAUX);
  const t2 = Math.max(0, base - AV_990I_SEUIL_2E_TAUX);
  return t1 * AV_990I_TAUX_1 + t2 * AV_990I_TAUX_2;
}

/** 757 B — primes versées après 70 ans : abattement GLOBAL (tous bénéficiaires), DMTG sur le surplus. */
export const AV_757B_ABATTEMENT_GLOBAL = 30_500;

// ─── Divers partagés ─────────────────────────────────────────────────────────

/** Droit de partage (art. 746 CGI) : 2,5 % général, 1,1 % partages successoraux/post-divorce. */
export const DROIT_PARTAGE_GENERAL = 0.025;
export const DROIT_PARTAGE_SUCCESSORAL = 0.011;

/**
 * Réduction de droits de donation (art. 790 CGI) : 50 % si transmission de
 * titres d'entreprise sous Dutreil en PLEINE PROPRIÉTÉ par un donateur < 70 ans.
 */
export const REDUCTION_DUTREIL_PP_MOINS_70 = 0.5;

/** Exonération Dutreil (787 B/C) : 75 % de la valeur des titres/de l'entreprise. */
export const EXO_DUTREIL = 0.75;
