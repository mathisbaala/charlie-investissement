"use client";

// Fonds récemment consultés (localStorage). Sert la « Reprise d'activité » de
// l'accueil : reprendre le travail là où on l'a laissé, sans profil ni compte.
// Même forme et mêmes garde-fous que @/lib/searches (localStorage corrompu → []).

export type ViewedFund = {
  isin: string;
  name: string;
  viewed_at: string;
};

const KEY = "charlie_viewed_funds";
const MAX = 12;

export function getViewedFunds(): ViewedFund[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    // Un localStorage corrompu (objet/null au lieu d'un tableau) ferait planter
    // les .filter()/.slice() en aval — donc l'accueil. On valide la forme.
    return Array.isArray(parsed)
      ? parsed.filter(
          (f) => f && typeof f.isin === "string" && typeof f.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function addViewedFund(entry: Omit<ViewedFund, "viewed_at">): void {
  if (typeof window === "undefined" || !entry.isin) return;
  // Dédup par ISIN : la vue la plus récente remonte en tête.
  const list = getViewedFunds().filter((f) => f.isin !== entry.isin);
  list.unshift({ ...entry, viewed_at: new Date().toISOString() });
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* quota plein / stockage indisponible : la reprise d'activité est best-effort */
  }
}
