// Helpers partagés du lot B — mécanique civile des régimes matrimoniaux au
// premier décès. Utilisé par `masse-successorale` (un régime, en détail) et
// `compare-regimes-matrimoniaux` (les cinq régimes côte à côte). La logique vit
// ici pour que les deux calculateurs donnent TOUJOURS le même chiffre pour le
// même régime — c'est une mécanique civile (C.civ.), pas fiscale : la masse
// obtenue est ensuite l'assiette des DMTG des héritiers.

export type RegimeMatrimonial =
  | "communaute_legale"
  | "communaute_universelle"
  | "communaute_universelle_attribution"
  | "separation"
  | "participation";

export const REGIME_OPTIONS: { value: RegimeMatrimonial; label: string }[] = [
  { value: "communaute_legale", label: "Communauté réduite aux acquêts" },
  { value: "communaute_universelle", label: "Communauté universelle" },
  { value: "communaute_universelle_attribution", label: "Communauté universelle avec attribution intégrale" },
  { value: "separation", label: "Séparation de biens" },
  { value: "participation", label: "Participation aux acquêts" },
];

/** Régimes où il existe une masse commune à liquider (moitié à la succession). */
export function isRegimeCommunautaire(regime: string): boolean {
  return (
    regime === "communaute_legale" ||
    regime === "communaute_universelle" ||
    regime === "communaute_universelle_attribution"
  );
}

export interface PatrimoineRegime {
  /** Biens propres du défunt (régimes séparatistes : son patrimoine hors acquêts). */
  propresDefunt: number;
  propresConjoint: number;
  /** Masse commune (régimes communautaires) — 0 pour séparation/participation. */
  biensCommuns: number;
  /** Acquêts au nom du défunt (séparation/participation) — 0 sinon. */
  acquetsDefunt: number;
  acquetsConjoint: number;
}

export interface MasseRegimeResult {
  /** Masse successorale : ce qui entre dans la succession (assiette des héritiers). */
  masse: number;
  /** Ce que le conjoint détient DÉJÀ hors succession (sa moitié, ses propres, sa créance). */
  conjointHorsSuccession: number;
  /**
   * Créance de participation SIGNÉE : > 0 = due PAR la succession au conjoint
   * (le défunt s'est enrichi davantage), < 0 = due par le conjoint à la
   * succession. 0 hors régime de participation.
   */
  creanceParticipation: number;
  /** Décomposition de la masse pour la table de restitution. */
  composantes: { label: string; montant: number }[];
}

/**
 * Masse successorale au premier décès selon le régime. Pourquoi la moitié en
 * communauté : au décès, la communauté est liquidée et le conjoint survivant
 * reprend sa moitié en pleine propriété AVANT toute dévolution — seule la
 * moitié du défunt tombe dans la succession (art. 1441 C.civ.).
 */
export function masseSelonRegime(regime: RegimeMatrimonial, p: PatrimoineRegime): MasseRegimeResult {
  switch (regime) {
    case "communaute_legale": {
      // Propres du défunt + moitié de la communauté ; le conjoint garde ses
      // propres et sa moitié de communauté hors succession.
      const demiCommunaute = p.biensCommuns / 2;
      return {
        masse: p.propresDefunt + demiCommunaute,
        conjointHorsSuccession: p.propresConjoint + demiCommunaute,
        creanceParticipation: 0,
        composantes: [
          { label: "Biens propres du défunt", montant: p.propresDefunt },
          { label: "Moitié de la communauté", montant: demiCommunaute },
        ],
      };
    }
    case "communaute_universelle": {
      // En universelle, TOUS les biens sont communs (art. 1526 C.civ.) : les
      // « propres » saisis sont fondus dans la masse commune, dont la moitié
      // seulement tombe dans la succession.
      const total = p.biensCommuns + p.propresDefunt + p.propresConjoint;
      return {
        masse: total / 2,
        conjointHorsSuccession: total / 2,
        creanceParticipation: 0,
        composantes: [{ label: "Moitié de la communauté universelle", montant: total / 2 }],
      };
    }
    case "communaute_universelle_attribution": {
      // Clause d'attribution intégrale : le conjoint reçoit TOUTE la communauté
      // hors succession — masse nulle, les enfants n'héritent qu'au 2nd décès.
      const total = p.biensCommuns + p.propresDefunt + p.propresConjoint;
      return {
        masse: 0,
        conjointHorsSuccession: total,
        creanceParticipation: 0,
        composantes: [{ label: "Attribution intégrale au conjoint", montant: 0 }],
      };
    }
    case "separation": {
      // Chacun reste propriétaire de ce qui est à son nom : la succession se
      // limite au patrimoine du défunt (propres + acquêts à son nom).
      return {
        masse: p.propresDefunt + p.acquetsDefunt,
        conjointHorsSuccession: p.propresConjoint + p.acquetsConjoint,
        creanceParticipation: 0,
        composantes: [
          { label: "Biens propres du défunt", montant: p.propresDefunt },
          { label: "Acquêts au nom du défunt", montant: p.acquetsDefunt },
        ],
      };
    }
    case "participation": {
      // Fonctionne comme une séparation pendant le mariage, mais à la
      // dissolution l'époux qui s'est le moins enrichi a une créance égale à la
      // MOITIÉ de la différence d'acquêts (art. 1569 C.civ.). Si le défunt
      // s'est enrichi davantage, le conjoint est créancier : la créance vient
      // EN DÉDUCTION de la masse successorale ; sinon la succession encaisse.
      const creance = (p.acquetsDefunt - p.acquetsConjoint) / 2;
      return {
        masse: p.propresDefunt + p.acquetsDefunt - creance,
        conjointHorsSuccession: p.propresConjoint + p.acquetsConjoint + creance,
        creanceParticipation: creance,
        composantes: [
          { label: "Biens propres du défunt", montant: p.propresDefunt },
          { label: "Acquêts au nom du défunt", montant: p.acquetsDefunt },
          {
            label: creance >= 0 ? "Créance de participation due au conjoint" : "Créance de participation reçue du conjoint",
            montant: -creance,
          },
        ],
      };
    }
  }
}
