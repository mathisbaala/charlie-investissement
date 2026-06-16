// Logique pure de l'onglet « Assurances vie » (/assureurs), extraite du composant
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
