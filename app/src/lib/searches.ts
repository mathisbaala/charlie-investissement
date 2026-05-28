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
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
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
