"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { Btn } from "@/components/ui/Btn";
import { Search } from "@/components/ui/icons";
import { getFavorites } from "@/lib/favorites";
import { getRecentSearches, addSearch, clearSearches } from "@/lib/searches";
import type { FavoriteEntry } from "@/lib/favorites";
import type { SearchEntry } from "@/lib/searches";
import { pct, dt } from "@/lib/format";

const QUICK_SEARCHES: { label: string; q: string }[] = [
  { label: "ETF monde", q: "ETF+monde+all+cap" },
  { label: "SCPI diversifiées", q: "SCPI+diversifiées+rendement" },
  { label: "Fonds article 9", q: "fonds+SFDR+article+9" },
  { label: "Obligataires défensifs", q: "obligations+investment+grade" },
  { label: "Monétaires EUR", q: "fonds+monétaires+EUR" },
];

export default function AccueilPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searches, setSearches] = useState<SearchEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);

  useEffect(() => {
    setSearches(getRecentSearches());
    setFavorites(getFavorites());
  }, []);

  function handleSearch() {
    if (!query.trim()) {
      router.push("/recherche");
      return;
    }
    addSearch({ query: query.trim(), chips: [], count: 0 });
    router.push("/recherche?q=" + encodeURIComponent(query.trim()));
  }

  return (
    <div className="h-full overflow-y-auto bg-cream px-8 py-10">
      <div className="max-w-[960px] mx-auto">
        {/* Section 1 — Search hero */}
        <div className="mb-10">
          <h1
            className="text-[32px] text-ink italic"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Charlie.
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Décrire votre recherche en langage naturel.
          </p>

          <div className="mt-6 bg-paper rounded-xl border border-line shadow-sm px-5 py-3.5 flex items-center gap-3">
            <Search size={16} className="text-muted shrink-0" />
            <TypingPrompt
              value={query}
              onChange={setQuery}
              onSubmit={handleSearch}
              className="flex-1"
            />
            <Btn variant="primary" size="sm" onClick={handleSearch}>
              Rechercher
            </Btn>
          </div>
        </div>

        {/* Section 2 — 3-column grid */}
        <div className="grid grid-cols-3 gap-5">
          {/* Col 1 — Recherches récentes */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-3">
              Recherches récentes
            </p>
            {searches.length === 0 ? (
              <p className="text-[12px] text-muted italic">
                Aucune recherche récente
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {searches.slice(0, 5).map((s, i) => (
                  <div
                    key={i}
                    className="cursor-pointer group rounded-lg px-3 py-2 hover:bg-paper-2 transition-colors"
                    onClick={() =>
                      router.push(
                        "/recherche?q=" + encodeURIComponent(s.query)
                      )
                    }
                  >
                    <p className="text-[12px] text-ink-2 group-hover:text-ink truncate">
                      {s.query}
                    </p>
                    <p
                      className="text-[10px] text-muted-2 mt-0.5"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {dt(s.searched_at)}
                    </p>
                  </div>
                ))}
                <button
                  onClick={() => {
                    clearSearches();
                    setSearches([]);
                  }}
                  className="text-[11px] text-muted hover:text-ink mt-1 text-left px-3 transition-colors"
                >
                  Effacer
                </button>
              </div>
            )}
          </div>

          {/* Col 2 — Favoris récents */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-3">
              Favoris récents
            </p>
            {favorites.length === 0 ? (
              <p className="text-[12px] text-muted italic">
                Aucun favori enregistré
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {favorites.slice(0, 5).map((f) => (
                  <div
                    key={f.isin}
                    className="cursor-pointer group rounded-lg px-3 py-2 hover:bg-paper-2 transition-colors"
                    onClick={() => router.push(`/fonds/${f.isin}`)}
                  >
                    <p className="text-[12px] text-ink-2 group-hover:text-ink truncate font-medium">
                      {f.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] text-muted truncate">
                        {f.gestionnaire ?? "—"}
                      </p>
                      {f.performance_3y != null && (
                        <span
                          className={`text-[10px] ml-auto shrink-0 ${
                            f.performance_3y >= 0 ? "text-ok" : "text-warn"
                          }`}
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {pct(f.performance_3y, true)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Col 3 — Explorer */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-3">
              Explorer
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_SEARCHES.map(({ label, q }) => (
                <button
                  key={label}
                  onClick={() => router.push(`/recherche?q=${q}`)}
                  className="bg-paper-2 hover:bg-accent-soft text-ink-2 hover:text-accent-ink text-[11px] px-3 py-1.5 rounded-full border border-line hover:border-accent/20 transition-colors cursor-pointer"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section 3 — Bottom stat strip */}
        <div className="mt-12 border-t border-line-soft pt-6 flex items-center gap-8 text-muted">
          <span className="text-[12px]">35 988 instruments indexés</span>
          <span className="text-[12px] text-muted-2">·</span>
          <span className="text-[12px]">
            OPCVM · ETF · SCPI · FPS · Fonds euros
          </span>
        </div>
      </div>
    </div>
  );
}
