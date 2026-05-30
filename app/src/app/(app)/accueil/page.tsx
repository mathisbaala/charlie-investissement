"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { ClientProfilePanel } from "@/components/screener/ClientProfilePanel";
import { Btn } from "@/components/ui/Btn";
import { Search, ChevronRight, Plus, X } from "@/components/ui/icons";
import { getFavorites } from "@/lib/favorites";
import { getRecentSearches, addSearch, clearSearches } from "@/lib/searches";
import type { FavoriteEntry } from "@/lib/favorites";
import type { SearchEntry } from "@/lib/searches";
import { pct, dt } from "@/lib/format";
import {
  type RichClientProfile,
  EMPTY_PROFILE,
  loadStoredProfile,
  saveStoredProfile,
  clearStoredProfile,
  isProfileActive,
} from "@/lib/clientProfile";

// ─── Top performer type ───────────────────────────────────────────────────────

type TopFund = {
  isin: string;
  name: string;
  gestionnaire: string | null;
  product_type: string;
  sfdr_article: number | null;
  performance_1y: number | null;
  performance_3y: number | null;
  ter: number | null;
  morningstar_rating: number | null;
  retrocession_cgp: number | null;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccueilPage() {
  const router = useRouter();
  const [query,   setQuery]   = useState("");
  const [searches, setSearches] = useState<SearchEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [topEtf,    setTopEtf]    = useState<TopFund[]>([]);
  const [topOpcvm,  setTopOpcvm]  = useState<TopFund[]>([]);
  const [topRetro,  setTopRetro]  = useState<TopFund[]>([]);
  const [stats, setStats] = useState<{ total: number; withKid: number; etf: number; opcvm: number; scpi: number; sfdr89: number } | null>(null);

  // Client profile
  const [profile,          setProfile]          = useState<RichClientProfile>(EMPTY_PROFILE);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [profileLoaded,    setProfileLoaded]    = useState(false);

  useEffect(() => {
    setSearches(getRecentSearches());
    setFavorites(getFavorites());
    setProfile(loadStoredProfile());
    setProfileLoaded(true);

    fetch("/api/screener/top-performers?type=etf&sort_by=performance_3y&limit=5&min_completeness=70")
      .then((r) => r.json())
      .then((d) => setTopEtf(d.data ?? []))
      .catch(() => {});

    fetch("/api/screener/top-performers?type=opcvm&sort_by=performance_3y&limit=5&min_completeness=70&min_aum=50000000")
      .then((r) => r.json())
      .then((d) => setTopOpcvm(d.data ?? []))
      .catch(() => {});

    fetch("/api/screener/funds?types=opcvm&sort_by=retrocession_cgp&sort_dir=desc&retrocession_min=0.01&min_completeness=60&per_page=5&deduplicate=true")
      .then((r) => r.json())
      .then((d) => setTopRetro(d.data ?? []))
      .catch(() => {});

    fetch("/api/screener/stats")
      .then((r) => r.json())
      .then((d) => {
        if (!d.total_funds) return;
        setStats({
          total:  d.total_funds,
          withKid: d.with_kid ?? 12804,
          etf:    d.by_type?.etf ?? 0,
          opcvm:  d.by_type?.opcvm ?? 0,
          scpi:   d.by_type?.scpi ?? 0,
          sfdr89: (d.by_sfdr?.["8"] ?? 0) + (d.by_sfdr?.["9"] ?? 0),
        });
      })
      .catch(() => {});
  }, []);

  // Persist profile changes
  useEffect(() => {
    if (!profileLoaded) return;
    saveStoredProfile(profile);
  }, [profile, profileLoaded]);

  function handleSearch() {
    if (!query.trim()) {
      router.push("/recherche");
      return;
    }
    addSearch({ query: query.trim(), chips: [], count: 0 });
    router.push("/recherche?q=" + encodeURIComponent(query.trim()));
  }

  const profileActive = isProfileActive(profile);

  return (
    <div className="h-full overflow-y-auto bg-cream px-8 py-10">
      <div className="max-w-[1040px] mx-auto">

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-[32px] text-ink italic" style={{ fontFamily: "var(--font-serif)" }}>
            Charlie.
          </h1>

          {/* Search bar */}
          <div className="mt-5 bg-paper rounded-xl border border-line shadow-sm px-5 py-3.5 flex items-center gap-3">
            <Search size={16} className="text-muted shrink-0" />
            <TypingPrompt
              value={query}
              onChange={setQuery}
              onSubmit={handleSearch}
              className="flex-1"
            />

            {/* Profile toggle */}
            {profileActive ? (
              <button
                type="button"
                onClick={() => setShowProfilePanel((v) => !v)}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft text-accent-ink text-[11px] font-medium border border-accent/20 hover:bg-accent/10 transition-colors"
              >
                <span>Profil actif</span>
                <X
                  size={10}
                  onClick={(e) => {
                    e.stopPropagation();
                    setProfile(EMPTY_PROFILE);
                    clearStoredProfile();
                    setShowProfilePanel(false);
                  }}
                />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowProfilePanel((v) => !v)}
                title="Importer un profil client"
                className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-full border transition-colors ${
                  showProfilePanel
                    ? "bg-accent-soft text-accent-ink border-accent/20"
                    : "border-line text-muted hover:bg-paper-2 hover:text-ink-2"
                }`}
              >
                <Plus size={13} />
              </button>
            )}

            <Btn variant="primary" size="sm" onClick={handleSearch}>
              Rechercher
            </Btn>
          </div>

          {/* Profile panel */}
          {showProfilePanel && (
            <div className="mt-2">
              <ClientProfilePanel
                profile={profile}
                onChange={setProfile}
                onClose={() => setShowProfilePanel(false)}
                onSearch={handleSearch}
              />
            </div>
          )}
        </div>

        {/* ── Stats strip ────────────────────────────────────────────────────── */}
        {stats && (
          <div className="mb-8 grid grid-cols-4 gap-3">
            {[
              { label: "fonds indexés",    value: stats.total.toLocaleString("fr-FR"), link: "/recherche" },
              { label: "DICIs disponibles", value: stats.withKid.toLocaleString("fr-FR"), link: "/documents" },
              { label: "ETF · OPCVM · SCPI", value: `${stats.etf.toLocaleString("fr-FR")} · ${stats.opcvm.toLocaleString("fr-FR")} · ${stats.scpi}`, link: null },
              { label: "fonds ESG (Art. 8+9)", value: stats.sfdr89.toLocaleString("fr-FR"), link: "/recherche?q=ESG" },
            ].map(({ label, value, link }) => (
              <div
                key={label}
                className={`bg-paper rounded-xl border border-line px-4 py-3 ${link ? "cursor-pointer hover:bg-cream transition-colors" : ""}`}
                onClick={link ? () => router.push(link) : undefined}
              >
                <p className="text-[20px] font-medium text-ink" style={{ fontFamily: "var(--font-serif)" }}>{value}</p>
                <p className="text-[10px] text-muted mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── 3-column grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-5 mb-8">

          {/* Recherches récentes */}
          <div className="bg-paper rounded-xl border border-line px-5 py-4">
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-3">
              Recherches récentes
            </p>
            {searches.length === 0 ? (
              <p className="text-[12px] text-muted italic">Aucune recherche récente</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {searches.slice(0, 6).map((s, i) => (
                  <div
                    key={i}
                    className="cursor-pointer group rounded-lg px-2 py-2 hover:bg-paper-2 transition-colors"
                    onClick={() => router.push("/recherche?q=" + encodeURIComponent(s.query))}
                  >
                    <p className="text-[12px] text-ink-2 group-hover:text-ink truncate">{s.query}</p>
                    <p className="text-[10px] text-muted-2 mt-0.5" style={{ fontFamily: "var(--font-mono)" }}>
                      {dt(s.searched_at)}
                    </p>
                  </div>
                ))}
                <button
                  onClick={() => { clearSearches(); setSearches([]); }}
                  className="text-[10px] text-muted hover:text-ink mt-2 text-left px-2 transition-colors"
                >
                  Effacer l'historique
                </button>
              </div>
            )}
          </div>

          {/* Favoris récents */}
          <div className="bg-paper rounded-xl border border-line px-5 py-4">
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-3">
              Favoris récents
            </p>
            {favorites.length === 0 ? (
              <p className="text-[12px] text-muted italic">Aucun favori enregistré</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {favorites.slice(0, 6).map((f) => (
                  <div
                    key={f.isin}
                    className="cursor-pointer group rounded-lg px-2 py-2 hover:bg-paper-2 transition-colors"
                    onClick={() => router.push(`/fonds/${f.isin}`)}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-[12px] text-ink-2 group-hover:text-ink truncate font-medium flex-1">
                        {f.name}
                      </p>
                      {f.performance_3y != null && (
                        <span className={`text-[11px] font-mono shrink-0 font-medium ${f.performance_3y >= 0 ? "text-ok" : "text-warn"}`}>
                          {pct(f.performance_3y, true)}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted truncate px-0.5">{f.gestionnaire ?? "—"}</p>
                  </div>
                ))}
                <Link href="/favoris" className="text-[10px] text-muted hover:text-accent-ink mt-2 px-2 flex items-center gap-1 transition-colors">
                  Voir tous les favoris <ChevronRight size={10} />
                </Link>
              </div>
            )}
          </div>

          {/* Par enveloppe */}
          <div className="bg-paper rounded-xl border border-line px-5 py-4">
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-3">
              Par enveloppe
            </p>
            <div className="flex flex-col gap-1">
              {[
                { label: "PEA",           q: "fonds+%C3%A9ligibles+PEA",           desc: "Plan Épargne en Actions" },
                { label: "PEA-PME",       q: "fonds+%C3%A9ligibles+PEA-PME+PME",   desc: "PEA dédié PME / ETI" },
                { label: "PER",           q: "fonds+%C3%A9ligibles+PER+retraite",   desc: "Plan Épargne Retraite" },
                { label: "AV France",     q: "fonds+assurance-vie+France",          desc: "Assurance-Vie française" },
                { label: "AV Luxembourg", q: "fonds+assurance-vie+luxembourg",      desc: "AV luxembourgeoise" },
                { label: "CTO",           q: "fonds+%C3%A9ligibles+CTO+compte-titres", desc: "Compte-Titres Ordinaire" },
              ].map(({ label, q, desc }) => (
                <button
                  key={label}
                  onClick={() => router.push(`/recherche?q=${q}`)}
                  className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-paper-2 transition-colors text-left group"
                >
                  <div>
                    <span className="text-[12px] text-ink-2 group-hover:text-ink font-medium">{label}</span>
                    <p className="text-[10px] text-muted-2">{desc}</p>
                  </div>
                  <ChevronRight size={12} className="text-muted group-hover:text-ink-2 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Top performers ──────────────────────────────────────────────────── */}
        {(topEtf.length > 0 || topOpcvm.length > 0 || topRetro.length > 0) && (
          <div className="grid grid-cols-3 gap-5">

            {topEtf.length > 0 && (
              <div className="bg-paper rounded-xl border border-line px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted font-semibold">Top ETF · Perf 3A</p>
                  <Link href="/recherche?q=ETF+performant" className="text-[10px] text-muted hover:text-accent-ink transition-colors flex items-center gap-0.5">
                    Voir tout <ChevronRight size={10} />
                  </Link>
                </div>
                <div className="flex flex-col gap-0.5">
                  {topEtf.map((f) => (
                    <Link key={f.isin} href={`/fonds/${f.isin}`} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-paper-2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-ink-2 group-hover:text-ink truncate font-medium">{f.name}</p>
                        <p className="text-[10px] text-muted-2 truncate">
                          {f.gestionnaire ?? f.isin}
                          {f.ter != null && <span className="ml-1.5 font-mono">{pct(f.ter)}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {f.performance_3y != null && (
                          <span className={`text-[13px] font-mono font-medium ${f.performance_3y >= 0 ? "text-ok" : "text-warn"}`}>
                            {pct(f.performance_3y, true)}
                          </span>
                        )}
                        <p className="text-[10px] text-muted-2">3 ans</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {topOpcvm.length > 0 && (
              <div className="bg-paper rounded-xl border border-line px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted font-semibold">Top OPCVM · Perf 3A</p>
                  <Link href="/recherche?q=OPCVM+performant" className="text-[10px] text-muted hover:text-accent-ink transition-colors flex items-center gap-0.5">
                    Voir tout <ChevronRight size={10} />
                  </Link>
                </div>
                <div className="flex flex-col gap-0.5">
                  {topOpcvm.map((f) => (
                    <Link key={f.isin} href={`/fonds/${f.isin}`} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-paper-2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-ink-2 group-hover:text-ink truncate font-medium">{f.name}</p>
                        <p className="text-[10px] text-muted-2 truncate">
                          {f.gestionnaire ?? f.isin}
                          {f.sfdr_article && <span className="ml-1.5">Art.{f.sfdr_article}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {f.performance_3y != null && (
                          <span className={`text-[13px] font-mono font-medium ${f.performance_3y >= 0 ? "text-ok" : "text-warn"}`}>
                            {pct(f.performance_3y, true)}
                          </span>
                        )}
                        <p className="text-[10px] text-muted-2">3 ans</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {topRetro.length > 0 && (
              <div className="bg-paper rounded-xl border border-line px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted font-semibold">Top OPCVM · Rétro. CGP</p>
                  <Link
                    href="/recherche?q=OPCVM+r%C3%A9trocession+CGP&sort_by=retrocession_cgp"
                    className="text-[10px] text-muted hover:text-accent-ink transition-colors flex items-center gap-0.5"
                  >
                    Voir tout <ChevronRight size={10} />
                  </Link>
                </div>
                <div className="flex flex-col gap-0.5">
                  {topRetro.map((f) => (
                    <Link key={f.isin} href={`/fonds/${f.isin}`} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-paper-2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-ink-2 group-hover:text-ink truncate font-medium">{f.name}</p>
                        <p className="text-[10px] text-muted-2 truncate">{f.gestionnaire ?? f.isin}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {f.retrocession_cgp != null && (
                          <span className="text-[13px] font-mono font-medium text-accent">
                            {pct(f.retrocession_cgp * 100)}
                          </span>
                        )}
                        <p className="text-[10px] text-muted-2">rétro./an</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
