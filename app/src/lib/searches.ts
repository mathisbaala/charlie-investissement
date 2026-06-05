"use client";

export type SearchEntry = {
  query: string;
  chips: string[];
  count: number;
  searched_at: string;
};

const KEY = "charlie_searches";

export function getRecentSearches(): SearchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    // Un localStorage corrompu (objet/null au lieu d'un tableau) ferait planter
    // les .filter()/.slice() en aval — donc l'accueil. On valide la forme.
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.query === "string") : [];
  } catch {
    return [];
  }
}

export function addSearch(entry: Omit<SearchEntry, "searched_at">): void {
  const list = getRecentSearches().filter((s) => s.query !== entry.query);
  list.unshift({ ...entry, searched_at: new Date().toISOString() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
}

export function clearSearches(): void {
  localStorage.removeItem(KEY);
}
