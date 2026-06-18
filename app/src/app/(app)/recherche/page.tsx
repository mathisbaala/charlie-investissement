"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { FilterPanel } from "@/components/screener/FilterPanel";
import { ParsedFilterChips } from "@/components/screener/ParsedFilterChips";
import { FundTable } from "@/components/screener/FundTable";
import { FundPreviewDrawer } from "@/components/screener/FundPreviewDrawer";
import { SelectionBar } from "@/components/screener/SelectionBar";
import { ComparisonModal } from "@/components/screener/ComparisonModal";
import { Btn } from "@/components/ui/Btn";
import { SlidersHorizontal, ArrowUpDown, ArrowLeft, ChevronRight, ChevronDown, X, Search } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Fund, ParsedFilters, ScreenerResponse } from "@/lib/types";
import { buildParams, filtersFromParams } from "@/lib/screenerParams";
import { handledRateLimit } from "@/lib/rateLimitClient";
import { asExactIsin } from "@/lib/search";
import { parseContractKey } from "@/lib/insurer-envelope";
import {
  type RichClientProfile,
  EMPTY_PROFILE,
  loadStoredProfile,
  saveStoredProfile,
  clearStoredProfile,
  isProfileActive,
  serializeForNlp,
} from "@/lib/clientProfile";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// buildParams importé localement (utilisé par fetchFunds) ET réexporté pour les
// tests existants qui l'importent depuis cette page.
export { buildParams };

async function fetchFunds(
  f: ParsedFilters,
  page: number,
  sortBy: string,
  sortDir: string,
): Promise<ScreenerResponse> {
  const params = buildParams(f, page, sortBy, sortDir);
  const res = await fetch(`/api/funds?${params.toString()}`);
  if (!res.ok) throw new Error("API error");
  return res.json() as Promise<ScreenerResponse>;
}

async function parseQuery(q: string): Promise<ParsedFilters> {
  const res = await fetch("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  if (await handledRateLimit(res)) return {};
  if (!res.ok) return {};
  return res.json();
}

// ─── Cache de session ──────────────────────────────────────────────────────────
// Conserve la dernière recherche (requête + filtres + résultats) pour que le
// retour depuis une fiche fonds restaure l'écran instantanément, sans re-parser
// ni recharger (sinon la page se remonte à vide puis « repart de zéro »).
const SEARCH_CACHE_KEY = "charlie_search_state_v1";

type SearchCache = {
  query: string;
  filters: ParsedFilters;
  funds: Fund[];
  total: number;
  page: number;
  totalPages: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  nlpFailed: boolean;
  fuzzy: boolean;
};

function loadSearchCache(): SearchCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SEARCH_CACHE_KEY);
    return raw ? (JSON.parse(raw) as SearchCache) : null;
  } catch { return null; }
}
function saveSearchCache(c: SearchCache) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(c)); } catch { /* quota plein : ignore */ }
}
function clearSearchCache() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(SEARCH_CACHE_KEY); } catch { /* ignore */ }
}

// ─── Inner component ──────────────────────────────────────────────────────────

function RechercheInner() {
  const router      = useRouter();
  const searchParams = useSearchParams();
  const initialQ    = searchParams.get("q") ?? "";

  const [query,          setQuery]          = useState(initialQ);
  const [filters,        setFilters]        = useState<ParsedFilters>({});
  const [nlpFailed,      setNlpFailed]      = useState(false);
  const [fuzzy,          setFuzzy]          = useState(false);  // résultats approchants (tolérance fautes)
  const [parsing,        setParsing]        = useState(false);  // analyse NLP en cours
  // Après une restauration depuis le cache, on saute le fetch automatique
  // (les résultats sont déjà là — éviter un rechargement et un nouveau flash).
  const skipNextFetch = useRef(false);
  const [showFilters,    setShowFilters]    = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [activeFund,     setActiveFund]     = useState<string | null>(null);

  // Client profile — saisi sur la page dédiée (/matching), partagé via localStorage.
  const [profile, setProfile] = useState<RichClientProfile>(EMPTY_PROFILE);

  const initialSortBy    = searchParams.get("sort_by");
  // Filtres décidés en amont, transmis par l'URL (page Profil client, lien
  // partagé, enveloppe/assureur depuis l'accueil). `from=profile` force l'état
  // « recherché » même si le profil ne se traduit par aucun filtre dur.
  const initialUrlFilters = filtersFromParams(searchParams);
  const fromProfile       = searchParams.get("from") === "profile";
  const hasUrlFilters     = Object.keys(initialUrlFilters).length > 0;
  const hasInitialFilter  = !!(initialQ || hasUrlFilters || fromProfile);
  const [hasSearched, setHasSearched] = useState(hasInitialFilter);

  // Results
  const [funds,      setFunds]      = useState<Fund[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading,    setLoading]    = useState(hasInitialFilter);

  // Sort
  const [sortBy,  setSortBy]  = useState(initialSortBy ?? "data_completeness");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Load profile from localStorage on mount
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    setProfile(loadStoredProfile());

    // Restauration instantanée depuis le cache de session : au retour d'une
    // fiche fonds (URL /recherche sans `q`, ou `q` identique à la recherche
    // mémorisée), on réaffiche la liste précédente sans re-parser ni recharger.
    // On ne restaure PAS si l'URL porte des filtres explicites (Profil client,
    // enveloppe/assureur, lien partagé) : l'intention prime sur l'historique.
    const cache = loadSearchCache();
    const canRestore =
      cache && !hasUrlFilters && !fromProfile &&
      (!initialQ || initialQ === cache.query);
    if (canRestore && cache) {
      skipNextFetch.current = true;
      setQuery(cache.query);
      setFilters(cache.filters);
      setFunds(cache.funds);
      setTotal(cache.total);
      setPage(cache.page);
      setTotalPages(cache.totalPages);
      setSortBy(cache.sortBy);
      setSortDir(cache.sortDir);
      setNlpFailed(cache.nlpFailed);
      setFuzzy(cache.fuzzy ?? false);
      setHasSearched(true);
      setLoading(false);
      return;
    }

    // Arrivée avec des filtres déjà décidés (Profil client, enveloppe/assureur
    // depuis l'accueil, lien partagé) : on amorce directement, sans analyse NLP.
    if (hasUrlFilters || fromProfile) {
      setFilters(initialUrlFilters);
    } else if (initialQ) {
      setQuery(initialQ);
      // ISIN exact (lien partagé, rechargement) : recherche ciblée sans NLP.
      if (asExactIsin(initialQ)) {
        setFilters({ free_text: initialQ });
        setNlpFailed(false);
      } else {
        setParsing(true);
        parseQuery(initialQ).then((parsed) => {
          const hasFilters = Object.keys(parsed).length > 0;
          setFilters(hasFilters ? parsed : { free_text: initialQ });
          setNlpFailed(!hasFilters);
          setParsing(false);
        });
      }
    }
    // Lecture unique au montage (garde `initialized`) — les filtres d'URL sont
    // figés à l'arrivée ; pas besoin de réagir à leurs changements d'identité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  // Persist profile changes
  useEffect(() => {
    if (!initialized) return;
    saveStoredProfile(profile);
  }, [profile, initialized]);

  // Fetch results
  useEffect(() => {
    if (!hasSearched) {
      setLoading(false);
      return;
    }
    // Tant que l'analyse NLP tourne, on n'interroge PAS l'API : sinon un premier
    // fetch part avec les filtres encore vides (la « pseudo-liste » qui clignote
    // avant les vrais résultats). On attend que les filtres compris soient prêts.
    if (parsing) return;
    // État restauré depuis le cache : la liste est déjà à l'écran, pas de refetch.
    if (skipNextFetch.current) { skipNextFetch.current = false; return; }

    let cancelled = false;
    setLoading(true);
    fetchFunds(filters, page, sortBy, sortDir)
      .then((data) => {
        if (!cancelled) {
          setFunds(data.data);
          setTotal(data.total);
          setTotalPages(data.total_pages);
          setFuzzy(!!data.fuzzy);
          setLoading(false);
          saveSearchCache({
            query, filters, funds: data.data, total: data.total,
            page, totalPages: data.total_pages, sortBy, sortDir, nlpFailed,
            fuzzy: !!data.fuzzy,
          });
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `query`/`nlpFailed` ne pilotent pas le fetch : exclus des deps à dessein
    // (ils ne servent qu'à alimenter le cache au moment du succès).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, sortBy, sortDir, hasSearched, parsing]);

  // ─── Search handler ────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setHasSearched(true);
    setParsing(true);     // affiche l'état de chargement, gèle le fetch
    setFunds([]);         // vide la liste précédente → aucun chevauchement visuel
    setFuzzy(false);      // évite une bannière « approchants » périmée pendant le chargement
    setPage(1);
    const raw = query.trim();
    // Un ISIN exact part directement en recherche ciblée, sans analyse NLP : le
    // LLM pourrait le déformer (p. ex. lire « FR… » comme la zone France) et c'est
    // un aller-retour inutile. L'API le traite alors par correspondance exacte.
    if (asExactIsin(raw)) {
      setFilters({ free_text: raw });
      setNlpFailed(false);
      setParsing(false);
      router.replace(`/recherche?q=${encodeURIComponent(raw)}`, { scroll: false });
      return;
    }
    const profileCtx = isProfileActive(profile) ? serializeForNlp(profile) : null;
    const fullQuery = profileCtx
      ? `${raw} — contexte client: ${profileCtx}`
      : raw;

    const parsed = await parseQuery(fullQuery);
    const hasFilters = Object.keys(parsed).length > 0;
    setFilters(hasFilters ? parsed : { free_text: query.trim() });
    setNlpFailed(!hasFilters);
    setParsing(false);    // libère le fetch, qui part avec les filtres compris
    router.replace(`/recherche?q=${encodeURIComponent(query.trim())}`, { scroll: false });
  }, [query, router, profile]);

  const handleFiltersApply = useCallback(() => setPage(1), []);

  const handleFiltersReset = useCallback(() => {
    setFilters({});
    setQuery("");
    setFunds([]);
    setFuzzy(false);
    setPage(1);
    setHasSearched(false);
    clearSearchCache();
    router.replace("/recherche", { scroll: false });
  }, [router]);

  const handleRemoveChip = useCallback((chip: string) => {
    setFilters((prev) => ({
      ...prev,
      chips: (prev.chips ?? []).filter((c) => c !== chip),
    }));
  }, []);

  // Retire le filtre de référencement (assureur / contrat) arrivé par l'URL
  // depuis l'onglet Assurances vie. Le fetch se redéclenche sur `filters`.
  // On nettoie aussi l'URL (sinon un reload réapplique le filtre retiré),
  // en préservant la requête texte `q=` si présente.
  const clearReferencingFilter = useCallback(() => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next.insurers;
      delete next.contracts;
      return next;
    });
    setPage(1);
    const q = query.trim();
    router.replace(q ? `/recherche?q=${encodeURIComponent(q)}` : "/recherche", { scroll: false });
  }, [router, query]);

  // ─── Sort / pagination ─────────────────────────────────────────────────────

  const handleSortByChange  = useCallback((v: string) => { setSortBy(v); setPage(1); }, []);
  const handleSortDirToggle = useCallback(() => { setSortDir((d) => d === "desc" ? "asc" : "desc"); setPage(1); }, []);
  const handleColumnSort    = useCallback((field: string) => {
    if (field === sortBy) {
      setSortDir((d) => d === "desc" ? "asc" : "desc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  }, [sortBy]);
  const goToPrevPage = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const goToNextPage = useCallback(() => setPage((p) => Math.min(totalPages, p + 1)), [totalPages]);
  const handleRowClick = useCallback((f: Fund) => setActiveFund((prev) => prev === f.isin ? null : f.isin), []);

  const profileActive = isProfileActive(profile);

  // Bandeau de contexte « référencement » : libellé lisible quand le screener est
  // filtré sur un contrat (clé « Assureur::Contrat ») ou un assureur, depuis
  // l'onglet Assurances vie. null si aucun filtre de référencement actif.
  const refContracts = filters.contracts ?? [];
  const refInsurers  = filters.insurers ?? [];
  let referencingLabel: string | null = null;
  if (refContracts.length === 1) {
    const { company, contract } = parseContractKey(refContracts[0]);
    referencingLabel = `Supports logeables dans ${contract}${company ? ` (${company})` : ""}`;
  } else if (refContracts.length > 1) {
    referencingLabel = `${refContracts.length} contrats sélectionnés`;
  } else if (refInsurers.length === 1) {
    referencingLabel = `Supports référencés chez ${refInsurers[0]}`;
  } else if (refInsurers.length > 1) {
    referencingLabel = `${refInsurers.length} assureurs sélectionnés`;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-cream flex-col">

      {/* ── Sticky header ── */}
      <div className="shrink-0 border-b border-line bg-paper px-3 md:px-5 py-3 space-y-2.5">

        {/* Search bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-2 md:gap-3 bg-paper-2 rounded-xl border border-line px-3 md:px-4 py-2.5 focus-within:border-accent/50 transition-colors">
            <TypingPrompt
              value={query}
              onChange={setQuery}
              onSubmit={handleSearch}
              className="flex-1"
            />

            {/* Pastille profil actif : le profil se renseigne sur la page dédiée
                (clic → édition) ; la croix le retire des recherches en cours. */}
            {profileActive && (
              <button
                type="button"
                onClick={() => router.push("/matching")}
                title="Modifier le profil client"
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft text-accent-ink text-label font-medium border border-accent/20 hover:bg-accent/10 transition-colors"
              >
                <span>Profil actif</span>
                <X
                  size={10}
                  onClick={(e) => {
                    e.stopPropagation();
                    setProfile(EMPTY_PROFILE);
                    clearStoredProfile();
                  }}
                />
              </button>
            )}

            <Btn variant="primary" size="sm" onClick={handleSearch}>
              Rechercher
            </Btn>
          </div>
        </div>

        {referencingLabel && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-accent-soft/30 border border-accent/20">
            <p className="text-label text-accent-ink min-w-0 truncate">
              <span className="font-semibold">{referencingLabel}</span>
              {!parsing && !loading && (
                <span className="text-accent-ink/70"> — {total.toLocaleString("fr-FR")} fonds</span>
              )}
            </p>
            <button
              onClick={clearReferencingFilter}
              className="text-label text-accent-ink/80 hover:text-accent-ink underline shrink-0"
            >
              retirer le filtre
            </button>
          </div>
        )}
        <ParsedFilterChips filters={filters} onRemoveChip={handleRemoveChip} />
        {nlpFailed && query.trim() && (
          <p className="text-label text-muted px-1">
            Filtres intelligents indisponibles — recherche par nom. Utilisez les{" "}
            <button onClick={() => setShowFilters(true)} className="underline hover:text-ink-2 transition-colors">
              filtres manuels
            </button>{" "}
            pour affiner.
          </p>
        )}
        {fuzzy && query.trim() && (
          <p className="text-label text-muted px-1">
            Aucune correspondance exacte pour «&nbsp;{query.trim()}&nbsp;» — voici les fonds
            aux noms les plus proches.
          </p>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="flex-1 overflow-hidden flex gap-3 px-3 pb-3 min-h-0">

        {showFilters && (
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            onApply={handleFiltersApply}
            onReset={handleFiltersReset}
            onClose={() => setShowFilters(false)}
            resultCount={total}
          />
        )}

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {!hasSearched ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
              <div className="w-12 h-12 rounded-2xl bg-paper-2 border border-line flex items-center justify-center">
                <Search size={20} className="text-muted" strokeWidth={1.5} />
              </div>
              <p className="text-body-lg font-medium text-ink-2">Recherchez dans la base de données</p>
            </div>
          ) : (<>

          {/* Toolbar — flex-wrap : sur très petit écran (≤320px) le groupe de
              contrôles passe sous le compteur au lieu de couper « Filtres ». */}
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-y-2 py-2.5 text-label text-muted">
            <span className="text-meta font-medium text-ink-2">
              {parsing ? "Analyse de votre recherche…" : loading ? "Chargement…" : `${total.toLocaleString("fr-FR")} fonds`}
            </span>
            {/* flex-wrap aussi sur le groupe : à 320px, Tri/Filtres passent sous
                le sélecteur au lieu d'être rognés hors écran. */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="relative flex items-center">
                <select
                  value={sortBy}
                  onChange={(e) => handleSortByChange(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 rounded-lg text-label font-medium border border-line bg-paper text-ink-2 cursor-pointer focus:outline-none transition-colors hover:bg-paper-2"
                >
                  <option value="data_completeness">Complétude</option>
                  <option value="performance_3y">Perf 3A</option>
                  <option value="performance_1y">Perf 1A</option>
                  <option value="performance_5y">Perf 5A</option>
                  <option value="aum_eur">Encours</option>
                  <option value="sharpe_1y">Sharpe 1A</option>
                  <option value="volatility_1y">Volatilité 1A</option>
                  <option value="ter">TER</option>
                  <option value="morningstar_rating">Morningstar</option>
                  <option value="track_record_years">Ancienneté</option>
                </select>
                <ChevronDown size={11} className="absolute right-2 pointer-events-none text-ink-2" />
              </div>
              <button
                onClick={handleSortDirToggle}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label font-medium border transition-colors bg-paper text-ink-2 border-line hover:bg-paper-2"
              >
                <ArrowUpDown size={12} />
                {sortDir === "desc" ? "Déc." : "Crois."}
              </button>
              <button
                onClick={() => setShowFilters((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label font-medium border transition-colors ${
                  showFilters ? "bg-accent-soft text-accent-ink border-accent/20" : "bg-paper text-ink-2 border-line hover:bg-paper-2"
                }`}
              >
                <SlidersHorizontal size={12} />
                Filtres
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {loading || parsing ? (
              <div className="flex items-center justify-center h-40 text-muted">
                <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : funds.length === 0 ? (
              <div className="flex h-40">
                <EmptyState
                  icon={<Search size={16} />}
                  title="Aucun fonds ne correspond à votre recherche."
                  hint="Élargissez ou réinitialisez vos filtres, ou laissez-vous guider par un profil client."
                  action={
                    <div className="flex flex-col items-center gap-2">
                      <button onClick={handleFiltersReset} className="text-accent text-meta font-medium hover:underline">
                        Réinitialiser les filtres
                      </button>
                      <button onClick={() => router.push("/matching")} className="text-meta text-muted hover:text-accent-ink hover:underline">
                        Ou partir d&apos;un profil client →
                      </button>
                    </div>
                  }
                />
              </div>
            ) : (
              <div className="border border-line rounded-xl overflow-hidden">
                <FundTable
                  funds={funds}
                  onRowClick={handleRowClick}
                  activeFundIsin={activeFund}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleColumnSort}
                />
              </div>
            )}

            {!loading && !parsing && totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-3 text-label text-muted">
                <span>Page {page} / {totalPages}</span>
                <div className="flex gap-1">
                  <button disabled={page <= 1} onClick={goToPrevPage} className="p-1.5 rounded border border-line hover:bg-paper-2 disabled:opacity-40 transition-colors" aria-label="Page précédente">
                    <ArrowLeft size={13} />
                  </button>
                  <button disabled={page >= totalPages} onClick={goToNextPage} className="p-1.5 rounded border border-line hover:bg-paper-2 disabled:opacity-40 transition-colors" aria-label="Page suivante">
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
          </>)}
        </div>

        {activeFund && (
          <FundPreviewDrawer isin={activeFund} onClose={() => setActiveFund(null)} />
        )}
      </div>

      <SelectionBar onCompare={() => setShowComparison(true)} />
      {showComparison && <ComparisonModal onClose={() => setShowComparison(false)} />}
    </div>
  );
}

export default function RecherchePage() {
  return (
    <Suspense>
      <RechercheInner />
    </Suspense>
  );
}
