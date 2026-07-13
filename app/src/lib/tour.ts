"use client";

// Visite guidée de première visite : une fenêtre au premier plan qui présente
// chaque onglet en une phrase. Contenu volontairement court et factuel.
// La logique de stockage est isolée ici pour rester testable hors composant.

export type TourStep = {
  /** Clé stable, sert aussi à choisir l'icône côté composant. */
  key: "accueil" | "recherche" | "portefeuille" | "assureurs" | "documents" | "guide";
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    key: "accueil",
    title: "Partez du besoin",
    body: "Décrivez un fonds en langage naturel, ou renseignez le profil client. Charlie propose une sélection adaptée.",
  },
  {
    key: "recherche",
    title: "Recherche",
    body: "Une phrase suffit. Affinez ensuite par risque, frais, performance et enveloppe.",
  },
  {
    key: "portefeuille",
    title: "Portefeuille",
    body: "Pondérez plusieurs fonds : performance, volatilité, Sharpe, corrélation et back-test face à un indice.",
  },
  {
    key: "assureurs",
    title: "Assurances vie",
    body: "Les contrats et leurs unités de compte référencées, assureur par assureur.",
  },
  {
    key: "documents",
    title: "Documents",
    body: "Déposez un DICI ou un KID : Charlie en extrait frais, risque et scénarios.",
  },
  {
    key: "guide",
    title: "Comprendre chaque page",
    body: "Cliquez le logo Charlie en haut à droite : une explication de la page et de son usage, à tout moment.",
  },
];

// Versionné : bump le suffixe pour réafficher la visite après une refonte.
const KEY = "charlie_tour_v2_done";

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
