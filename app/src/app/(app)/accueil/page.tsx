"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { ClientProfilePanel } from "@/components/screener/ClientProfilePanel";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Search, ChevronRight, Plus, X } from "@/components/ui/icons";
import { addSearch } from "@/lib/searches";
import { pct } from "@/lib/format";
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
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccueilPage() {
  const router = useRouter();
  const [query,   setQuery]   = useState("");
  const [topEtf,   setTopEtf]   = useState<TopFund[]>([]);
  const [topOpcvm, setTopOpcvm] = useState<TopFund[]>([]);
  const [topScpi,  setTopScpi]  = useState<TopFund[]>([]);
  const [insurers, setInsurers] = useState<{ company: string; funds: number }[]>([]);
  const [insurersLoading, setInsurersLoading] = useState(true);

  // Client profile
  const [profile,          setProfile]          = useState<RichClientProfile>(EMPTY_PROFILE);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [profileLoaded,    setProfileLoaded]    = useState(false);

  useEffect(() => {
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

    fetch("/api/screener/top-performers?type=scpi&sort_by=performance_3y&limit=5&min_completeness=50")
      .then((r) => r.json())
      .then((d) => setTopScpi(d.data ?? []))
      .catch(() => {});

    fetch("/api/screener/insurers")
      .then((r) => r.json())
      .then((d) => setInsurers(d.data ?? []))
      .catch(() => {})
      .finally(() => setInsurersLoading(false));
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
    <div className="h-full overflow-y-auto bg-cream px-4 sm:px-8 py-10">
      <div className="max-w-[1040px] mx-auto">

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-display-md text-ink italic" style={{ fontFamily: "var(--font-serif)" }}>
            Charlie.
          </h1>

          {/* Search bar */}
          <div className="mt-5 bg-paper rounded-xl border border-line shadow-sm px-5 py-3.5 flex items-center gap-3 focus-within:border-accent/50 transition-colors">
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
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft text-accent-ink text-label font-medium border border-accent/20 hover:bg-accent/10 transition-colors"
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

        {/* ── navigation grid ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">

          {/* Par enveloppe */}
          <Card className="px-5 py-4 flex flex-col">
            <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-3">
              Par enveloppe
            </p>
            <div className="flex flex-col gap-0.5">
              {[
                { label: "PEA",           env: "PEA" },
                { label: "PEA-PME",       env: "PEA-PME" },
                { label: "PER",           env: "PER" },
                { label: "AV France",     env: "AV-FR" },
                { label: "AV Luxembourg", env: "AV-LUX" },
                { label: "CTO",           env: "CTO" },
              ].map(({ label, env }) => (
                <button
                  key={label}
                  onClick={() => router.push(`/recherche?envelopes=${env}`)}
                  className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-paper-2 transition-colors text-left group"
                >
                  <span className="text-meta text-ink-2 group-hover:text-ink font-medium">{label}</span>
                  <ChevronRight size={12} className="text-muted group-hover:text-ink-2 shrink-0" />
                </button>
              ))}
            </div>
          </Card>

          {/* Par assureur */}
          <Card className="px-5 py-4 flex flex-col">
            <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-3">
              Par assureur
            </p>
            {insurersLoading ? (
              <div className="flex flex-col gap-0.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-6" />
                  </div>
                ))}
              </div>
            ) : insurers.length === 0 ? (
              <EmptyState title="Annuaire indisponible" />
            ) : (
              <div className="flex flex-col gap-0.5">
                {insurers.slice(0, 6).map(({ company, funds }) => (
                  <button
                    key={company}
                    onClick={() => router.push(`/recherche?insurer=${encodeURIComponent(company)}`)}
                    className="flex items-center justify-between gap-2 px-2 py-2 rounded-lg hover:bg-paper-2 transition-colors text-left group"
                  >
                    <span className="text-meta text-ink-2 group-hover:text-ink font-medium truncate">{company}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-caption text-muted-2" style={{ fontFamily: "var(--font-mono)" }}>
                        {funds.toLocaleString("fr-FR")}
                      </span>
                      <ChevronRight size={12} className="text-muted group-hover:text-ink-2" />
                    </span>
                  </button>
                ))}
                <Link href="/assureurs" className="text-caption text-muted hover:text-accent-ink mt-2 px-2 flex items-center gap-1 transition-colors">
                  Voir l'annuaire complet <ChevronRight size={10} />
                </Link>
              </div>
            )}
          </Card>
        </div>

        {/* ── Top performers ──────────────────────────────────────────────────── */}
        {(topEtf.length > 0 || topOpcvm.length > 0 || topScpi.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            {topEtf.length > 0 && (
              <Card className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-caption uppercase tracking-widest text-muted font-semibold">Top ETF · Perf 3A</p>
                  <Link href="/recherche?universe=etf&sort_by=performance_3y" className="text-caption text-muted hover:text-accent-ink transition-colors flex items-center gap-0.5">
                    Voir tout <ChevronRight size={10} />
                  </Link>
                </div>
                <div className="flex flex-col gap-0.5">
                  {topEtf.map((f) => (
                    <Link key={f.isin} href={`/fonds/${f.isin}`} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-paper-2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-meta text-ink-2 group-hover:text-ink truncate font-medium">{f.name}</p>
                        <p className="text-caption text-muted-2 truncate">
                          {f.gestionnaire ?? f.isin}
                          {f.ter != null && <span className="ml-1.5 font-mono">{pct(f.ter)}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {f.performance_3y != null && (
                          <span className={`text-body font-mono font-medium ${f.performance_3y >= 0 ? "text-ok" : "text-danger"}`}>
                            {pct(f.performance_3y, true)}
                          </span>
                        )}
                        <p className="text-caption text-muted-2">3 ans</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {topOpcvm.length > 0 && (
              <Card className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-caption uppercase tracking-widest text-muted font-semibold">Top OPCVM · Perf 3A</p>
                  <Link href="/recherche?universe=opcvm&sort_by=performance_3y" className="text-caption text-muted hover:text-accent-ink transition-colors flex items-center gap-0.5">
                    Voir tout <ChevronRight size={10} />
                  </Link>
                </div>
                <div className="flex flex-col gap-0.5">
                  {topOpcvm.map((f) => (
                    <Link key={f.isin} href={`/fonds/${f.isin}`} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-paper-2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-meta text-ink-2 group-hover:text-ink truncate font-medium">{f.name}</p>
                        <p className="text-caption text-muted-2 truncate">
                          {f.gestionnaire ?? f.isin}
                          {f.sfdr_article && <span className="ml-1.5">Art.{f.sfdr_article}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {f.performance_3y != null && (
                          <span className={`text-body font-mono font-medium ${f.performance_3y >= 0 ? "text-ok" : "text-danger"}`}>
                            {pct(f.performance_3y, true)}
                          </span>
                        )}
                        <p className="text-caption text-muted-2">3 ans</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {topScpi.length > 0 && (
              <Card className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-caption uppercase tracking-widest text-muted font-semibold">Top SCPI · Perf 3A</p>
                  <Link href="/recherche?universe=scpi&sort_by=performance_3y" className="text-caption text-muted hover:text-accent-ink transition-colors flex items-center gap-0.5">
                    Voir tout <ChevronRight size={10} />
                  </Link>
                </div>
                <div className="flex flex-col gap-0.5">
                  {topScpi.map((f) => (
                    <Link key={f.isin} href={`/fonds/${f.isin}`} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-paper-2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-meta text-ink-2 group-hover:text-ink truncate font-medium">{f.name}</p>
                        <p className="text-caption text-muted-2 truncate">{f.gestionnaire ?? f.isin}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {f.performance_3y != null && (
                          <span className={`text-body font-mono font-medium ${f.performance_3y >= 0 ? "text-ok" : "text-danger"}`}>
                            {pct(f.performance_3y, true)}
                          </span>
                        )}
                        <p className="text-caption text-muted-2">3 ans</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
