"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { Btn } from "@/components/ui/Btn";
import { Search, Clock, RotateCcw, ChevronRight } from "@/components/ui/icons";
import { addSearch, getRecentSearches } from "@/lib/searches";
import { getViewedFunds, type ViewedFund } from "@/lib/viewedFunds";

// Accueil = vrai point d'entrée : une seule chose à faire, chercher. En dessous,
// la « Reprise d'activité » (recherches récentes + derniers fonds vus) permet de
// reprendre le travail là où on l'a laissé — sans profil client (qui vit
// désormais dans Portefeuille) ni compte. Rien ne s'affiche à la 1re visite.
export default function AccueilPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  // Historique lu après montage (localStorage) pour éviter tout écart d'hydratation.
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [viewedFunds, setViewedFunds] = useState<ViewedFund[]>([]);

  useEffect(() => {
    setRecentSearches(getRecentSearches().map((s) => s.query).slice(0, 6));
    setViewedFunds(getViewedFunds().slice(0, 6));
  }, []);

  function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      router.push("/recherche");
      return;
    }
    addSearch({ query: trimmed, chips: [], count: 0 });
    router.push("/recherche?q=" + encodeURIComponent(trimmed));
  }

  const hasHistory = recentSearches.length > 0 || viewedFunds.length > 0;

  return (
    <div className="h-full overflow-y-auto bg-cream px-4 sm:px-8 py-10">
      <div className="max-w-[1040px] mx-auto">

        {/* Recherche en langage naturel (le titre « Charlie » vit dans la Topbar) */}
        <div className="bg-paper rounded-xl border border-line shadow-sm px-5 py-3.5 flex items-center gap-3 focus-within:border-accent/50 transition-colors">
          <Search size={16} className="text-muted shrink-0" />
          <TypingPrompt value={query} onChange={setQuery} onSubmit={() => runSearch(query)} className="flex-1" />
          <Btn variant="primary" size="sm" onClick={() => runSearch(query)}>
            Rechercher
          </Btn>
        </div>

        {/* Reprise d'activité — n'apparaît que s'il y a un historique local */}
        {hasHistory && (
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">

            {recentSearches.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <RotateCcw size={13} className="text-muted-2 shrink-0" />
                  <h2 className="text-caption uppercase tracking-widest text-muted font-semibold">
                    Reprendre une recherche
                  </h2>
                </div>
                <ul className="flex flex-col">
                  {recentSearches.map((q) => (
                    <li key={q}>
                      <button
                        onClick={() => runSearch(q)}
                        className="group w-full flex items-center gap-2.5 py-2 min-h-[40px] -mx-2 px-2 rounded-lg hover:bg-paper transition-colors text-left"
                      >
                        <Search size={13} className="text-muted-2 shrink-0" />
                        <span className="text-body text-ink-2 truncate flex-1">{q}</span>
                        <ChevronRight size={14} className="text-muted-2 group-hover:text-accent-ink shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {viewedFunds.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={13} className="text-muted-2 shrink-0" />
                  <h2 className="text-caption uppercase tracking-widest text-muted font-semibold">
                    Derniers fonds consultés
                  </h2>
                </div>
                <ul className="flex flex-col">
                  {viewedFunds.map((f) => (
                    <li key={f.isin}>
                      <Link
                        href={`/fonds/${encodeURIComponent(f.isin)}`}
                        className="group flex items-center gap-2.5 py-2 min-h-[40px] -mx-2 px-2 rounded-lg hover:bg-paper transition-colors"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-body text-ink-2 truncate group-hover:text-accent-ink">{f.name}</span>
                          <span className="block text-caption font-mono text-muted-2">{f.isin}</span>
                        </span>
                        <ChevronRight size={14} className="text-muted-2 group-hover:text-accent-ink shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
