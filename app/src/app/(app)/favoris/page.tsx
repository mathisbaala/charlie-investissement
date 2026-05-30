"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Btn } from "@/components/ui/Btn";
import { SfdrBadge, SriBadge, MorningstarBadge } from "@/components/ui/Badge";
import { Star, X, Download } from "@/components/ui/icons";
import { getFavorites, removeFavorite } from "@/lib/favorites";
import type { FavoriteEntry } from "@/lib/favorites";
import { pct } from "@/lib/format";
import { useSelection, type SelectedFund } from "@/components/SelectionProvider";
import { SelectionBar } from "@/components/screener/SelectionBar";
import { ComparisonModal } from "@/components/screener/ComparisonModal";

function fmtBool(v: boolean | null | undefined): string {
  return v == null ? "" : v ? "oui" : "non";
}

function exportCsv(funds: FavoriteEntry[]) {
  const HEADERS = [
    "ISIN", "Nom", "Gestionnaire", "SFDR", "SRI", "Morningstar",
    "Perf 3A (%)", "TER (%)", "Rétrocession CGP (%)",
    "PEA", "PEA-PME", "PER", "AV France", "AV Luxembourg", "CTO",
    "Ajouté le",
  ];
  const rows = funds.map((f) => [
    f.isin,
    f.name.replace(/"/g, '""'),
    (f.gestionnaire ?? "").replace(/"/g, '""'),
    f.sfdr_article ?? "",
    f.risk_score ?? "",
    f.morningstar_rating ?? "",
    f.performance_3y != null ? f.performance_3y.toFixed(2) + "%" : "",
    f.ongoing_charges != null ? f.ongoing_charges.toFixed(2) + "%" : "",
    f.retrocession_cgp != null && f.retrocession_cgp > 0 ? (f.retrocession_cgp * 100).toFixed(3) + "%" : "",
    fmtBool(f.pea_eligible),
    fmtBool(f.pea_pme_eligible),
    fmtBool(f.per_eligible),
    fmtBool(f.av_fr_eligible),
    fmtBool(f.av_lux_eligible),
    fmtBool(f.cto_eligible),
    f.added_at ? new Date(f.added_at).toLocaleDateString("fr-FR") : "",
  ]);
  const csv = [HEADERS, ...rows]
    .map((row) => row.map((v) => `"${v}"`).join(";"))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `favoris-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function toSelectedFund(f: FavoriteEntry): SelectedFund {
  return {
    isin: f.isin,
    name: f.name,
    gestionnaire: f.gestionnaire,
    sfdr_article: f.sfdr_article,
    risk_score: f.risk_score,
    performance_1y: null,
    performance_3y: f.performance_3y,
    performance_5y: null,
    ongoing_charges: f.ongoing_charges,
    volatility_1y: null,
    sharpe_1y: null,
    max_drawdown_3y: null,
    morningstar_rating: f.morningstar_rating,
    track_record_years: null,
    aum_eur: null,
    retrocession_cgp: f.retrocession_cgp ?? null,
    pea_eligible: f.pea_eligible,
    pea_pme_eligible: f.pea_pme_eligible,
    per_eligible: f.per_eligible,
    av_fr_eligible: f.av_fr_eligible,
    av_lux_eligible: f.av_lux_eligible,
    cto_eligible: f.cto_eligible,
  };
}

function FavCard({
  f,
  onRemove,
}: {
  f: FavoriteEntry;
  onRemove: () => void;
}) {
  const { toggle, isSelected } = useSelection();
  const sel = isSelected(f.isin);

  return (
    <div
      className={`bg-paper rounded-xl border transition-all group flex flex-col gap-3 p-4 ${
        sel ? "border-accent/40 bg-accent-soft/10" : "border-line hover:shadow-sm"
      }`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-[13px] font-medium text-ink truncate flex-1"
          style={{ fontFamily: "var(--font-serif)" }}
          title={f.name}
        >
          {f.name}
        </p>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-2 hover:text-ink rounded p-0.5"
          aria-label="Retirer des favoris"
        >
          <X size={13} />
        </button>
      </div>

      {/* Gestionnaire */}
      {f.gestionnaire && (
        <p className="text-muted text-[11px] -mt-2">{f.gestionnaire}</p>
      )}

      {/* ISIN */}
      <p className="text-[10px] text-muted-2" style={{ fontFamily: "var(--font-mono)" }}>
        {f.isin}
      </p>

      {/* Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <SfdrBadge article={f.sfdr_article} />
        <SriBadge sri={f.risk_score} />
        {f.morningstar_rating && <MorningstarBadge rating={f.morningstar_rating} />}
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted mb-0.5">Perf. 3A</p>
          <p
            className={`text-[12px] font-medium font-mono ${
              f.performance_3y == null ? "text-muted" : f.performance_3y >= 0 ? "text-ok" : "text-warn"
            }`}
          >
            {pct(f.performance_3y, true)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted mb-0.5">TER</p>
          <p className="text-[12px] text-ink-2 font-mono">{pct(f.ongoing_charges)}</p>
        </div>
        {f.retrocession_cgp != null && f.retrocession_cgp > 0 && (
          <div>
            <p className="text-[10px] text-muted mb-0.5">Rétro. CGP</p>
            <p className="text-[12px] font-medium font-mono text-accent">{pct(f.retrocession_cgp * 100)}</p>
          </div>
        )}
      </div>

      {/* Eligibility pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {f.pea_eligible     && <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">PEA</span>}
        {f.pea_pme_eligible && <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">PEA-PME</span>}
        {f.per_eligible     && <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">PER</span>}
        {f.av_fr_eligible   && <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">AV FR</span>}
        {f.av_lux_eligible  && <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">AV Lux</span>}
        {f.cto_eligible     && <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">CTO</span>}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 mt-auto pt-1">
        <Link href={`/fonds/${f.isin}`} className="text-accent text-[11px] hover:underline flex-1">
          Voir la fiche →
        </Link>
        <button
          onClick={() => toggle(toSelectedFund(f))}
          className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
            sel
              ? "bg-accent-soft text-accent-ink border-accent/20"
              : "border-line text-muted hover:border-accent/30 hover:text-ink-2"
          }`}
        >
          {sel ? "Sélectionné" : "Comparer"}
        </button>
      </div>
    </div>
  );
}

const nfEur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

type SortKey = "added" | "perf" | "retro" | "ter";

export default function FavorisPage() {
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [aumInput, setAumInput] = useState("100000");

  useEffect(() => {
    setFavorites(getFavorites());
  }, []);

  function handleRemove(isin: string) {
    removeFavorite(isin);
    setFavorites((prev) => prev.filter((f) => f.isin !== isin));
  }

  const aum = aumInput ? (parseFloat(aumInput.replace(/\s/g, "").replace(",", ".")) || null) : null;

  const withRetro = favorites.filter((f) => (f.retrocession_cgp ?? 0) > 0);
  const avgRetro = withRetro.length > 0
    ? withRetro.reduce((s, f) => s + (f.retrocession_cgp ?? 0), 0) / withRetro.length
    : null;

  const sorted = [...favorites].sort((a, b) => {
    if (sortKey === "perf")  return (b.performance_3y ?? -999) - (a.performance_3y ?? -999);
    if (sortKey === "retro") return (b.retrocession_cgp ?? 0) - (a.retrocession_cgp ?? 0);
    if (sortKey === "ter")   return (a.ongoing_charges ?? 999) - (b.ongoing_charges ?? 999);
    return new Date(b.added_at ?? 0).getTime() - new Date(a.added_at ?? 0).getTime();
  });

  return (
    <div className="h-full overflow-y-auto bg-cream px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-[26px] text-ink inline" style={{ fontFamily: "var(--font-serif)" }}>
          Favoris
          <span className="ml-2 text-[13px] text-muted font-sans">({favorites.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          {favorites.length > 0 && (
            <>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="appearance-none pl-3 pr-7 py-1.5 rounded-lg text-[11px] font-medium border border-line bg-paper text-ink-2 cursor-pointer focus:outline-none hover:bg-paper-2"
              >
                <option value="added">Récemment ajoutés</option>
                <option value="perf">Perf 3A</option>
                <option value="retro">Rétrocession CGP</option>
                <option value="ter">TER (croissant)</option>
              </select>
              <Btn variant="outline" size="sm" onClick={() => exportCsv(favorites)}>
                <Download size={13} />
                Exporter CSV
              </Btn>
            </>
          )}
        </div>
      </div>

      {/* Synthèse rétrocession */}
      {withRetro.length > 0 && (
        <div className="mb-5 mt-3 bg-accent/10 border border-accent/20 rounded-xl px-5 py-4 flex flex-wrap items-center gap-5">
          <div>
            <p className="text-[9.5px] uppercase tracking-widest text-muted font-semibold">Fonds avec rétrocession</p>
            <p className="text-[20px] font-semibold text-accent font-mono mt-0.5" style={{ fontFamily: "var(--font-serif)" }}>
              {withRetro.length}
              <span className="text-[12px] font-normal text-muted-2 ml-1">/ {favorites.length}</span>
            </p>
          </div>
          {avgRetro != null && (
            <div>
              <p className="text-[9.5px] uppercase tracking-widest text-muted font-semibold">Rétro. moyenne</p>
              <p className="text-[20px] font-semibold text-accent font-mono mt-0.5" style={{ fontFamily: "var(--font-serif)" }}>
                {pct(avgRetro * 100)}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div>
              <p className="text-[9.5px] uppercase tracking-widest text-muted font-semibold">Pour</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <input
                  type="number"
                  value={aumInput}
                  onChange={(e) => setAumInput(e.target.value)}
                  className="w-28 border border-line rounded-lg px-2.5 py-1 text-[13px] font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
                />
                <span className="text-[12px] text-muted">€</span>
              </div>
            </div>
            {aum != null && avgRetro != null && (
              <div className="mt-4">
                <span className="text-[13px] text-muted mx-1">→</span>
                <span className="text-[18px] font-bold text-accent font-mono">
                  {nfEur.format(aum * avgRetro)}
                  <span className="text-[11px] font-normal text-muted-2">/an</span>
                </span>
                <span className="text-[10px] text-muted ml-1">moy.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grid or empty state */}
      {favorites.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted">
          <Star size={32} strokeWidth={1} className="mb-4 text-muted-2" />
          <p className="text-[14px]">Aucun favori enregistré</p>
          <p className="text-[12px] mt-1">Ajoutez des fonds depuis la recherche ou les fiches</p>
          <Link href="/recherche" className="mt-4">
            <Btn variant="primary" size="sm">Rechercher des fonds</Btn>
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-3 gap-4 max-[900px]:grid-cols-2 pb-24">
          {sorted.map((f) => (
            <FavCard key={f.isin} f={f} onRemove={() => handleRemove(f.isin)} />
          ))}
        </div>
      )}

      <SelectionBar onCompare={() => setShowComparison(true)} />
      {showComparison && <ComparisonModal onClose={() => setShowComparison(false)} />}
    </div>
  );
}
