"use client";

export type FavoriteEntry = {
  isin: string;
  name: string;
  gestionnaire: string | null;
  sfdr_article: number | null;
  risk_score: number | null;
  performance_3y: number | null;
  ongoing_charges: number | null;
  retrocession_cgp: number | null;
  pea_eligible: boolean | null;
  pea_pme_eligible: boolean | null;
  per_eligible: boolean | null;
  av_fr_eligible: boolean | null;
  av_lux_eligible: boolean | null;
  cto_eligible: boolean | null;
  morningstar_rating: number | null;
  added_at: string;
};

const KEY = "charlie_favorites";

export function getFavorites(): FavoriteEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addFavorite(entry: FavoriteEntry): void {
  const list = getFavorites().filter((f) => f.isin !== entry.isin);
  list.unshift({ ...entry, added_at: new Date().toISOString() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
}

export function removeFavorite(isin: string): void {
  const list = getFavorites().filter((f) => f.isin !== isin);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function isFavorite(isin: string): boolean {
  return getFavorites().some((f) => f.isin === isin);
}
