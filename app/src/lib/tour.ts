"use client";

// Visite guidée de première visite : une fenêtre au premier plan qui présente
// chaque onglet en une phrase. Contenu volontairement court et factuel.
// La logique de stockage est isolée ici pour rester testable hors composant.

export type TourStep = {
  /** Clé stable, sert aussi à choisir l'icône côté composant. */
  key: "accueil" | "recherche" | "matching" | "assureurs" | "documents" | "chat";
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    key: "accueil",
    title: "Accueil",
    body: "Le point de départ. Tapez une recherche en langage naturel ou parcourez les fonds par enveloppe et par assureur.",
  },
  {
    key: "recherche",
    title: "Recherche",
    body: "Décrivez le fonds recherché en une phrase. Les filtres affinent la liste par risque, frais, performance et enveloppe.",
  },
  {
    key: "matching",
    title: "Profil client",
    body: "Renseignez la situation du client. Charlie pré-filtre la recherche sur les fonds qui lui correspondent.",
  },
  {
    key: "assureurs",
    title: "Assurances vie",
    body: "Parcourez les contrats et leurs unités de compte référencées, assureur par assureur.",
  },
  {
    key: "documents",
    title: "Documents",
    body: "Déposez un DICI ou un KID. Charlie en extrait les frais, le niveau de risque et les scénarios.",
  },
  {
    key: "chat",
    title: "Demander à Charlie",
    body: "Une question à tout moment ? Ouvrez Charlie en haut à droite pour interroger les données.",
  },
];

// Versionné : bump le suffixe pour réafficher la visite après une refonte.
const KEY = "charlie_tour_v1_done";

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

export function resetTour(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* idem */
  }
}
