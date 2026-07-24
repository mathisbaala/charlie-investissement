// Logique pure de l'onglet « Assurances vie » (/partenaires), extraite du composant
// pour être testable. L'enveloppe (AV / Capi / PER / PEA) est l'axe primaire : elle
// filtre les contrats de chaque assureur. « av » est le défaut du domaine — un
// contrat sans type explicite est une assurance vie.

export type ContractType = "av" | "capi" | "per" | "pea" | "pep";
export type Envelope = "av" | "capi" | "per" | "pea";

export type ContractLike = {
  company: string;
  contract: string;
  closed?: boolean;
  types?: ContractType[];
};

// Les types d'un contrat, « av » par défaut si non renseigné.
export function typesOf(c: ContractLike): ContractType[] {
  return c.types && c.types.length ? c.types : ["av"];
}

// Un contrat appartient-il à l'enveloppe active ?
export function inEnvelope(c: ContractLike, env: Envelope): boolean {
  return typesOf(c).includes(env);
}

// Contrats « réels » d'un assureur : on retire le cas redondant où l'unique
// contrat reprend le nom de l'assureur (fréquent côté AV Luxembourg).
export function realContracts<T extends ContractLike>(all: T[], company: string): T[] {
  return all.filter((c) => c.contract && !(all.length === 1 && c.contract === company));
}

// Contrats à afficher pour une enveloppe donnée (enveloppe + statut commercial).
export function visibleContracts<T extends ContractLike>(
  all: T[], company: string, env: Envelope, hideClosed: boolean,
): T[] {
  return realContracts(all, company).filter(
    (c) => inEnvelope(c, env) && (!hideClosed || !c.closed),
  );
}

// Un assureur est-il visible sous l'enveloppe active ? Il l'est s'il a au moins un
// contrat de cette enveloppe. Cas particulier AV : on garde aussi les assureurs
// sans détail de contrat (AV Luxembourg « redondant »), l'AV étant le défaut.
export function isInsurerVisible(
  all: ContractLike[], company: string, env: Envelope, hideClosed: boolean,
): boolean {
  if (visibleContracts(all, company, env, hideClosed).length > 0) return true;
  return env === "av" && realContracts(all, company).length === 0;
}

// Types d'un contrat autres que l'enveloppe active (marqueur « aussi X »).
export function otherEnvelopes(c: ContractLike, env: Envelope): ContractType[] {
  return typesOf(c).filter((t) => t !== env);
}

// Décompose une clé de contrat « Assureur::Contrat » en nom lisibles. Split sur
// le PREMIER « :: » (le nom de contrat peut lui-même contenir « :: »). Fallback
// si la clé ne contient pas « :: » : tout est le nom de contrat, assureur = null.
export function parseContractKey(key: string): { company: string | null; contract: string } {
  const i = key.indexOf("::");
  if (i === -1) return { company: null, contract: key };
  return { company: key.slice(0, i), contract: key.slice(i + 2) };
}

// ─── Attributs PER / retraite (colonnes av_contract_terms) ───────────────────
// Libellés des attributs statutaires des contrats retraite (retraite_scheme /
// sortie_modes / deblocage_anticipe_cases), remplis par règle (loi PACTE pour les
// PER ; régimes Madelin/PERP/Art.8x pour l'ancien). Fonctions pures : la fiche-
// contrat ne fait que mapper ces libellés.

const RETRAITE_SCHEME_LABEL: Record<string, string> = {
  perin:   "PER individuel",
  pereco:  "PER collectif (PERECO)",
  pero:    "PER obligatoire (PERO)",
  madelin: "Contrat Madelin",
  perp:    "PERP",
  art82:   "Article 82",
  art83:   "Article 83",
  ancien:  "Contrat retraite",
};
// Libellé du sous-type de contrat retraite ; null si schéma inconnu/absent
// (on n'affiche alors pas de sous-type plutôt que d'inventer).
export function retraiteSchemeLabel(scheme: string | null | undefined): string | null {
  if (!scheme) return null;
  return RETRAITE_SCHEME_LABEL[scheme] ?? null;
}

const SORTIE_MODE_LABEL: Record<string, string> = {
  capital:            "Capital",
  rente_viagere:      "Rente viagère",
  capital_fractionne: "Sortie fractionnée",
};
// Libellé d'un mode de sortie ; repli = code brut (jamais masqué silencieusement).
export function sortieModeLabel(mode: string): string {
  return SORTIE_MODE_LABEL[mode] ?? mode;
}

const DEBLOCAGE_CASE_LABEL: Record<string, string> = {
  deces_conjoint_partenaire:                    "Décès du conjoint ou partenaire de Pacs",
  invalidite:                                   "Invalidité (2ᵉ ou 3ᵉ catégorie)",
  surendettement:                               "Surendettement",
  expiration_droits_chomage:                    "Expiration des droits au chômage",
  cessation_non_salarie_liquidation_judiciaire: "Liquidation judiciaire (non-salarié)",
  acquisition_residence_principale:             "Acquisition de la résidence principale",
};
// Libellé d'un cas de déblocage anticipé ; repli = code brut.
export function deblocageCaseLabel(c: string): string {
  return DEBLOCAGE_CASE_LABEL[c] ?? c;
}
