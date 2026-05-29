"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { FilterPanel } from "@/components/screener/FilterPanel";
import { ParsedFilterChips } from "@/components/screener/ParsedFilterChips";
import { FundTable } from "@/components/screener/FundTable";
import { FundPreviewDrawer } from "@/components/screener/FundPreviewDrawer";
import { SelectionBar } from "@/components/screener/SelectionBar";
import { ComparisonModal } from "@/components/screener/ComparisonModal";
import { Btn } from "@/components/ui/Btn";
import { SlidersHorizontal, ArrowUpDown, ArrowLeft, ChevronRight } from "@/components/ui/icons";
import type { Fund, ParsedFilters, ScreenerResponse } from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildParams(
  f: ParsedFilters,
  page: number,
  sortBy: string,
  sortDir: string,
): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.sfdr?.length)               sp.set("sfdr",              f.sfdr.join(","));
  if (f.sri_min        != null)      sp.set("sri_min",           String(f.sri_min));
  if (f.sri_max        != null)      sp.set("sri_max",           String(f.sri_max));
  if (f.ter_max        != null)      sp.set("ter_max",           String(f.ter_max));
  if (f.perf_1y_min    != null)      sp.set("perf_1y_min",       String(f.perf_1y_min));
  if (f.perf_3y_min    != null)      sp.set("perf_3y_min",       String(f.perf_3y_min));
  if (f.vol_max        != null)      sp.set("vol_max",           String(f.vol_max));
  if (f.sharpe_min     != null)      sp.set("sharpe_min",        String(f.sharpe_min));
  if (f.aum_min        != null)      sp.set("aum_min",           String(f.aum_min));
  if (f.track_record_min != null)    sp.set("track_record_min",  String(f.track_record_min));
  if (f.morningstar_min  != null)    sp.set("morningstar_min",   String(f.morningstar_min));
  if (f.envelopes?.length)           sp.set("envelopes",         f.envelopes.join(","));
  if (f.universe?.length)            sp.set("universe",          f.universe.join(","));
  if (f.currency?.length)            sp.set("currency",          f.currency.join(","));
  if (f.manager_search)              sp.set("manager_search",    f.manager_search);
  if (f.free_text)                   sp.set("search",            f.free_text);
  sp.set("sort_by",  sortBy);
  sp.set("sort_dir", sortDir);
  sp.set("page",     String(page));
  sp.set("per_page", "50");
  return sp;
}

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
  if (!res.ok) return {};
  return res.json();
}

// ─── Inner component (needs useSearchParams → must be inside Suspense) ────────

function RechercheInner() {
  const router      = useRouter();
  const searchParams = useSearchParams();
  const initialQ    = searchParams.get("q") ?? "";

  // Core state
  const [query,          setQuery]          = useState(initialQ);
  const [filters,        setFilters]        = useState<ParsedFilters>({});
  const [nlpFailed,      setNlpFailed]      = useState(false);
  const [showFilters,    setShowFilters]    = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [activeFund,     setActiveFund]     = useState<string | null>(null);

  // Results state
  const [funds,      setFunds]      = useState<Fund[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading,    setLoading]    = useState(true);

  // Sort state
  const [sortBy,  setSortBy]  = useState("data_completeness");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Initialization — parse URL query once on mount
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    if (initialQ) {
      setQuery(initialQ);
      parseQuery(initialQ).then((parsed) => {
        setFilters(parsed);
        const hasFilters = Object.keys(parsed).length > 0;
        setNlpFailed(!hasFilters);
      });
    }
  }, [initialized, initialQ]);

  // ─── Fetch effect — runs whenever fetch deps change ───────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFunds(filters, page, sortBy, sortDir)
      .then((data) => {
        if (!cancelled) {
          setFunds(data.data);
          setTotal(data.total);
          setTotalPages(data.total_pages);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filters, page, sortBy, sortDir]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    const parsed = await parseQuery(query.trim());
    setFilters(parsed);
    setNlpFailed(Object.keys(parsed).length === 0);
    setPage(1);
    router.replace(`/recherche?q=${encodeURIComponent(query.trim())}`, { scroll: false });
  }, [query, router]);

  const handleFiltersApply = useCallback(() => {
    setPage(1);
  }, []);

  const handleFiltersReset = useCallback(() => {
    setFilters({});
    setQuery("");
    setPage(1);
    router.replace("/recherche", { scroll: false });
  }, [router]);

  const handleRemoveChip = useCallback((chip: string) => {
    setFilters((prev) => ({
      ...prev,
      chips: (prev.chips ?? []).filter((c) => c !== chip),
    }));
  }, []);

  // ─── Sort helpers ──────────────────────────────────────────────────────────

  const handleSortByChange = useCallback((value: string) => {
    setSortBy(value);
    setPage(1);
  }, []);

  const handleSortDirToggle = useCallback(() => {
    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    setPage(1);
  }, []);

  // ─── Pagination helpers ────────────────────────────────────────────────────

  const goToPrevPage = useCallback(() => {
    setPage((p) => Math.max(1, p - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPage((p) => Math.min(totalPages, p + 1));
  }, [totalPages]);

  // ─── Row click handler ─────────────────────────────────────────────────────

  const handleRowClick = useCallback((f: Fund) => {
    setActiveFund((prev) => (prev === f.isin ? null : f.isin));
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-cream flex-col">

      {/* ── Search bar + chips (sticky header) ── */}
      <div className="shrink-0 border-b border-line bg-paper px-5 py-3 space-y-2.5">
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-3 bg-paper-2 rounded-xl border border-line px-4 py-2.5">
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
        <ParsedFilterChips filters={filters} onRemoveChip={handleRemoveChip} />
        {nlpFailed && query.trim() && (
          <p className="text-[11px] text-muted px-1">
            Filtres intelligents indisponibles — résultats non filtrés. Utilisez les{" "}
            <button
              onClick={() => setShowFilters(true)}
              className="underline hover:text-ink-2 transition-colors"
            >
              filtres manuels
            </button>{" "}
            pour affiner.
          </p>
        )}
      </div>

      {/* ── Toolbar — transparent, just buttons on cream bg ── */}
      <div className="shrink-0 flex items-center justify-between px-5 py-2.5 text-[11px] text-muted">
        <span className="text-[12px] font-medium text-ink-2">
          {loading ? "Chargement…" : `${total.toLocaleString("fr-FR")} fonds`}
        </span>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => handleSortByChange(e.target.value)}
            className="text-[11px] border border-line rounded-lg px-2.5 py-1.5 bg-paper text-ink-2 cursor-pointer focus:outline-none focus:border-accent/40 transition-colors"
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

          <button
            onClick={handleSortDirToggle}
            className="p-1.5 rounded-lg text-muted hover:text-ink-2 hover:bg-paper-2 border border-transparent hover:border-line transition-colors"
            title={sortDir === "desc" ? "Décroissant" : "Croissant"}
          >
            <ArrowUpDown size={13} />
          </button>

          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
              showFilters
                ? "bg-accent-soft text-accent-ink border-accent/20"
                : "bg-paper text-ink-2 border-line hover:bg-paper-2"
            }`}
          >
            <SlidersHorizontal size={12} />
            Filtres
          </button>
        </div>
      </div>

      {/* ── Three-pane area: [FilterCard] [Table] [DrawerCard] ── */}
      <div className="flex-1 overflow-hidden flex gap-3 px-3 pb-3 min-h-0">

        {/* Filter panel — card, starts at table level */}
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

        {/* Table scroll area */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-muted">
              <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : funds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted text-sm gap-2">
              <p>Aucun fonds ne correspond à votre recherche.</p>
              <button onClick={handleFiltersReset} className="text-accent text-xs hover:underline">
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="border border-line rounded-xl overflow-x-auto">
              <FundTable
                funds={funds}
                onRowClick={handleRowClick}
                activeFundIsin={activeFund}
              />
            </div>
          )}

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-3 text-[11px] text-muted">
              <span>Page {page} / {totalPages}</span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={goToPrevPage}
                  className="p-1.5 rounded border border-line hover:bg-paper-2 disabled:opacity-40 transition-colors"
                  aria-label="Page précédente"
                >
                  <ArrowLeft size={13} />
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={goToNextPage}
                  className="p-1.5 rounded border border-line hover:bg-paper-2 disabled:opacity-40 transition-colors"
                  aria-label="Page suivante"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Preview drawer — card aligned with table */}
        {activeFund && (
          <FundPreviewDrawer
            isin={activeFund}
            onClose={() => setActiveFund(null)}
          />
        )}
      </div>

      {/* Selection bar (fixed bottom) + comparison modal */}
      <SelectionBar onCompare={() => setShowComparison(true)} />
      {showComparison && (
        <ComparisonModal onClose={() => setShowComparison(false)} />
      )}
    </div>
  );
}

// ─── Export — wrapped in Suspense for useSearchParams ─────────────────────────

export default function RecherchePage() {
  return (
    <Suspense>
      <RechercheInner />
    </Suspense>
  );
}
