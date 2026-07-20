"use client";

// Visite guidée de première visite : une fenêtre au premier plan qui présente
// chaque onglet en une phrase. Contenu volontairement court et factuel.
// La logique de stockage est isolée ici pour rester testable hors composant.

export type TourStep = {
  /** Clé stable, sert aussi à choisir l'icône côté composant. */
  key: "accueil" | "portefeuille" | "simulateur" | "assureurs" | "cabinet" | "guide";
  title: string;
  body: string;
};

// Une étape par pilier, dans l'ordre du rail (Accueil, Partenaires,
// Portefeuille, Frais), puis Mon cabinet et le guide contextuel en clôture.
export const TOUR_STEPS: TourStep[] = [
  {
    key: "accueil",
    title: "Trouvez le bon support",
    body: "Décrivez ce que vous cherchez avec vos propres mots : Charlie traduit votre phrase en une recherche de fonds. Filtrez, triez et comparez les résultats pour retenir le support qui colle au besoin.",
  },
  {
    key: "assureurs",
    title: "Partenaires",
    body: "Le mapping exhaustif des assureurs et de leurs contrats : où loger fiscalement chaque support, avec qui travailler, ce que propose chaque partenaire, ses contrats, ses frais et sa rémunération.",
  },
  {
    key: "portefeuille",
    title: "Portefeuille",
    body: "Construisez un portefeuille de A à Z à partir du profil du client, ou analysez un portefeuille existant pour repérer les trous dans la raquette et les points à optimiser.",
  },
  {
    key: "simulateur",
    title: "Frais",
    body: "La comptabilité du portefeuille : ce qu'il rapporte, ce que gagne le cabinet, ce qu'il coûte au client, poste par poste. De quoi éditer des rapports clairs et transparents.",
  },
  {
    key: "cabinet",
    title: "Mon cabinet",
    body: "Renseignez vos partenariats assureurs et vos rétrocessions une fois : le reste de la plateforme les réutilise.",
  },
  {
    key: "guide",
    title: "Comprendre chaque page",
    body: "Cliquez le logo Charlie en haut à droite : une explication de la page et de son usage, à tout moment.",
  },
];

// Versionné : bump le suffixe pour réafficher la visite après une refonte.
// v3 : fusion Portefeuille + Allocation, cabinet passé en pied de rail.
// v4 : ajout de l'étape Simulateur de frais.
// v5 : accueil recentré sur recherche + reprise d'activité (profil déplacé dans
//      Portefeuille), assureurs devenus fiches-contrat.
// v6 : onglet Documents retiré (DICI fusionné dans Portefeuille → Analyser).
// v7 : tour recentré sur les 4 piliers du rail (Accueil / Partenaires /
//      Portefeuille / Frais) ; étape Recherche fusionnée dans Accueil ;
//      « Assurances vie » renommé « Partenaires ».
const KEY = "charlie_tour_v7_done";

export function isTourDone(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function markTourDone(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* stockage indisponible : on n'insiste pas */
  }
}
