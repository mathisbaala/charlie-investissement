"use client";

// Visite guidée de première visite : une fenêtre au premier plan qui présente
// chaque onglet en une phrase. Contenu volontairement court et factuel.
// La logique de stockage est isolée ici pour rester testable hors composant.

export type TourStep = {
  /** Clé stable, sert aussi à choisir l'icône côté composant. */
  key: "accueil" | "recherche" | "portefeuille" | "simulateur" | "assureurs" | "cabinet" | "documents" | "guide";
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    key: "accueil",
    title: "Partez du besoin",
    body: "Décrivez un fonds en langage naturel pour lancer une recherche. En dessous, reprenez vos recherches récentes et vos derniers fonds consultés.",
  },
  {
    key: "recherche",
    title: "Recherche",
    body: "Une phrase suffit. Affinez ensuite par risque, frais, performance et enveloppe.",
  },
  {
    key: "portefeuille",
    title: "Portefeuille",
    body: "Du profil client à la proposition : portefeuille optimisé (max-Sharpe ou HRP), Markowitz interactif, back-test face à un indice, restitution PDF et PowerPoint.",
  },
  {
    key: "simulateur",
    title: "Frais",
    body: "Ce que gagne le cabinet et ce que coûte le contrat : rétrocessions et commission d'entrée, cumulées et détaillées support par support. Supports importés par recherche, relevé ou fiche.",
  },
  {
    key: "assureurs",
    title: "Assurances vie",
    body: "Chaque contrat en fiche : enveloppe, supports référencés, frais moyens et répartition. Assureur par assureur.",
  },
  {
    key: "cabinet",
    title: "Mon cabinet",
    body: "Renseignez vos partenariats assureurs et vos rétrocessions une fois : le reste de la plateforme les réutilise.",
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
// v3 : fusion Portefeuille + Allocation, cabinet passé en pied de rail.
// v4 : ajout de l'étape Simulateur de frais.
// v5 : accueil recentré sur recherche + reprise d'activité (profil déplacé dans
//      Portefeuille), assureurs devenus fiches-contrat.
const KEY = "charlie_tour_v5_done";

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
