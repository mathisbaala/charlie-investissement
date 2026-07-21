"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { FilterPanel } from "@/components/screener/FilterPanel";
import { Btn } from "@/components/ui/Btn";
import { Search, Clock, RotateCcw, ChevronRight, SlidersHorizontal, ArrowRight } from "@/components/ui/icons";
import { addSearch, getRecentSearches } from "@/lib/searches";
import { getViewedFunds, type ViewedFund } from "@/lib/viewedFunds";
import { buildParams, countActiveFilters, DEFAULT_SORT } from "@/lib/screenerParams";
import type { ParsedFilters } from "@/lib/types";

// Accueil = vrai point d'entrée. Deux chemins pour arriver aux fonds, côte à côte :
//   1. écrire ce qu'on cherche en langage naturel (barre + « Lancer la recherche ») ;
//   2. quand on n'a pas de phrase en tête, raisonner par filtres (« Gérer mes
//      filtres » ouvre le panneau du screener directement ici).
// En dessous, la « Reprise d'activité » (recherches récentes + derniers fonds vus)
// permet de reprendre le travail là où on l'a laissé. Pas de profil client (il vit
// dans Portefeuille) ni de compte. Rien ne s'affiche à la 1re visite.
export default function AccueilPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  // Filtres réglés à la main (panneau) avant de lancer la recherche. Ils voyagent
  // vers /recherche via l'URL, seuls ou combinés à la requête texte.
  const [filters, setFilters] = useState<ParsedFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = countActiveFilters(filters);

  // Historique lu après montage (localStorage) pour éviter tout écart d'hydratation.
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [viewedFunds, setViewedFunds] = useState<ViewedFund[]>([]);

  useEffect(() => {
    setRecentSearches(getRecentSearches().map((s) => s.query).slice(0, 6));
    setViewedFunds(getViewedFunds().slice(0, 6));
  }, []);

  // Lance la recherche depuis l'un ou l'autre chemin (texte, filtres, ou les deux).
  function launchSearch() {
    const trimmed = query.trim();
    const hasFilters = activeFilterCount > 0;
    if (!trimmed && !hasFilters) {
      router.push("/recherche");
      return;
    }
    if (trimmed) addSearch({ query: trimmed, chips: [], count: 0 });
    // Chemin pur langage naturel (cas courant) → URL propre `?q=`.
    if (!hasFilters) {
      router.push("/recherche?q=" + encodeURIComponent(trimmed));
      return;
    }
    // Filtres manuels (± texte) → tout est sérialisé dans l'URL.
    const params = buildParams(filters, 1, DEFAULT_SORT.sort_by, DEFAULT_SORT.sort_dir);
    if (trimmed) params.set("q", trimmed);
    router.push(`/recherche?${params.toString()}`);
  }

  function runRecent(q: string) {
    const trimmed = q.trim();
    if (!trimmed) { router.push("/recherche"); return; }
    addSearch({ query: trimmed, chips: [], count: 0 });
    router.push("/recherche?q=" + encodeURIComponent(trimmed));
  }

  const hasHistory = recentSearches.length > 0 || viewedFunds.length > 0;

  return (
    <div className="h-full overflow-y-auto bg-cream px-4 sm:px-8 py-14 sm:py-20">
      <div className="max-w-[960px] mx-auto">

        {/* Une seule grande phrase : ce à quoi l'outil sert. Rien de plus —
            l'espace fait le reste. (Le titre « Charlie » vit dans la Topbar.) */}
        <h1
          className="text-display-lg sm:text-display-xl text-ink tracking-[-0.025em] leading-[1.05] mb-9 sm:mb-11"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Trouver le bon{" "}
          <em className="not-italic" style={{ color: "var(--color-accent)" }}>
            support
          </em>
          .
        </h1>

        {/* Carte de recherche : zone de saisie généreuse en haut, deux actions en
            pied (« Gérer mes filtres » à gauche, « Lancer la recherche » à droite).
            Pas de séparateur : la respiration suffit à distinguer les deux zones. */}
        <div className="bg-paper rounded-2xl border border-line shadow-sm px-5 sm:px-6 pt-5 pb-4">
          <div className="flex items-start gap-3 min-h-[92px]">
            <Search size={18} className="text-muted shrink-0 mt-0.5" />
            <TypingPrompt value={query} onChange={setQuery} onSubmit={launchSearch} className="flex-1" />
          </div>

          <div className="flex items-center justify-between gap-3 mt-3">
            <Btn variant="outline" size="md" onClick={() => setShowFilters(true)} className="gap-2">
              <SlidersHorizontal size={14} strokeWidth={1.7} />
              Gérer mes filtres
              {activeFilterCount > 0 && (
                <span className="ml-0.5 min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-brown text-paper text-caption font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </Btn>
            <Btn variant="accent" size="md" onClick={launchSearch} className="gap-2">
              Lancer la recherche
              <ArrowRight size={15} />
            </Btn>
          </div>
        </div>

        {/* Reprise d'activité — n'apparaît que s'il y a un historique local */}
        {hasHistory && (
          <div className="mt-14 sm:mt-16 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">

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
                        onClick={() => runRecent(q)}
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

      {/* Panneau de filtres du screener, ouvert en tiroir depuis l'accueil.
          « Lancer la recherche » (pied du panneau) navigue vers /recherche avec
          les filtres réglés. La croix ferme sans perdre la sélection. */}
      {showFilters && (
        <>
          <div
            className="fixed inset-0 z-[55] bg-ink/20"
            onClick={() => setShowFilters(false)}
            aria-hidden
          />
          <div className="fixed inset-y-0 right-0 z-[60] flex md:p-3">
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              onApply={() => { setShowFilters(false); launchSearch(); }}
              onReset={() => setFilters({})}
              onClose={() => setShowFilters(false)}
              applyLabel="Rechercher"
              mdWidthClass="md:w-[380px]"
            />
          </div>
        </>
      )}
    </div>
  );
}
