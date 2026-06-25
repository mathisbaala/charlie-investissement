"use client";

import Link from "next/link";
import { useSelection, SelectedFund, COMPARE_MAX } from "@/components/SelectionProvider";
import { Btn } from "@/components/ui/Btn";
import { X, Download } from "@/components/ui/icons";

interface SelectionBarProps {
  onCompare: () => void;
}

function fmt(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "" : v.toFixed(2) + "%";
}

function fmtBool(v: boolean | null | undefined): string {
  return v == null ? "" : v ? "oui" : "non";
}

function exportCsv(funds: SelectedFund[]) {
  const HEADERS = [
    "ISIN","Nom","Gestionnaire","SFDR","SRI","Morningstar",
    "Perf 1A (%)","Perf 3A (%)","Perf 5A (%)","TER (%)","Vol 1A (%)","Sharpe 1A",
    "Max DD 3A (%)","Rétrocession CGP (%)","Encours (€)","Track record (ans)",
    "PEA","PEA-PME","PER","AV France","AV Luxembourg","CTO",
  ];

  const rows = funds.map((f) => [
    f.isin,
    f.name.replace(/"/g, '""'),
    (f.gestionnaire ?? "").replace(/"/g, '""'),
    f.sfdr_article ?? "",
    f.risk_score ?? "",
    f.morningstar_rating ?? "",
    fmtPct(f.performance_1y),
    fmtPct(f.performance_3y),
    fmtPct(f.performance_5y),
    fmtPct(f.ongoing_charges),
    fmtPct(f.volatility_1y),
    f.sharpe_1y != null ? f.sharpe_1y.toFixed(2) : "",
    fmtPct(f.max_drawdown_3y),
    f.retrocession_cgp != null ? (f.retrocession_cgp * 100).toFixed(2) + "%" : "",
    f.aum_eur != null ? Math.round(f.aum_eur) : "",
    fmt(f.track_record_years),
    fmtBool(f.pea_eligible),
    fmtBool(f.pea_pme_eligible),
    fmtBool(f.per_eligible),
    fmtBool(f.av_fr_eligible),
    fmtBool(f.av_lux_eligible),
    fmtBool(f.cto_eligible),
  ]);

  const csv = [HEADERS, ...rows]
    .map((row) => row.map((v) => `"${v}"`).join(";"))
    .join("\r\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fonds-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function SelectionBar({ onCompare }: SelectionBarProps) {
  const { selected, clear } = useSelection();

  if (selected.length === 0) return null;

  const pdfHref = `/api/rapport/pdf?isins=${selected.map((f) => f.isin).join(",")}`;

  return (
    <div className="c-slide-up fixed bottom-4 left-[60px] right-0 mx-auto z-30 flex flex-wrap items-center gap-2 sm:gap-3 bg-paper border border-line rounded-xl px-3 sm:px-4 py-2.5 shadow-[0_4px_16px_oklch(0.22_0.012_60_/_0.12)] max-w-[860px] w-[calc(100%-60px-1.5rem)]">
      <span
        className="text-body-lg text-accent shrink-0"
        style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
      >
        {selected.length}
      </span>
      {/* Liste des noms masquée sur mobile : laisse la place aux actions */}
      <span className="hidden sm:block text-meta text-ink-2 flex-1 min-w-0 truncate">
        {selected.map((f) => f.name).join(" · ")}
      </span>
      {/* Sur mobile : icônes masquées (boutons texte seul, plus compacts) ;
          flex-wrap garantit qu'aucune action n'est coupée si ça déborde. */}
      <Btn variant="ghost" size="sm" onClick={clear} className="shrink-0 ml-auto sm:ml-0">
        <span className="hidden sm:inline-flex"><X size={13} /></span>
        Vider
      </Btn>
      <Btn variant="outline" size="sm" onClick={() => exportCsv(selected)} className="shrink-0">
        <span className="hidden sm:inline-flex"><Download size={13} /></span>
        CSV
      </Btn>
      {selected.length >= 2 && (
        // <a> et non <Link> : route API de téléchargement, pas une page. Un <Link>
        // déclenche le prefetch RSC de Next (/api/rapport/pdf?_rsc=…) → 400 en console.
        <a href={pdfHref} target="_blank" rel="noopener" className="shrink-0">
          <Btn variant="outline" size="sm">
            <span className="hidden sm:inline-flex"><Download size={13} /></span>
            PDF
          </Btn>
        </a>
      )}
      {selected.length >= 2 && (
        <Link
          href={`/portefeuille?isins=${selected.map((f) => f.isin).join(",")}`}
          prefetch={false}
          className="shrink-0"
        >
          <Btn variant="outline" size="sm">Portefeuille</Btn>
        </Link>
      )}
      <Btn
        variant="primary"
        size="sm"
        disabled={selected.length < 2 || selected.length > COMPARE_MAX}
        onClick={onCompare}
        title={selected.length > COMPARE_MAX ? `Comparaison limitée à ${COMPARE_MAX} fonds` : undefined}
        className="shrink-0"
      >
        {selected.length > COMPARE_MAX ? `Comparer (max ${COMPARE_MAX})` : "Comparer"}
      </Btn>
    </div>
  );
}
