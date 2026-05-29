"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { ExternalLink, ChevronRight, ArrowLeft, Search, FileText } from "@/components/ui/icons";
import { SfdrBadge, SriBadge } from "@/components/ui/Badge";
import { decodeHtml } from "@/lib/format";

interface DocFund {
  isin: string;
  name: string;
  gestionnaire: string | null;
  product_type: string | null;
  sfdr_article: number | null;
  risk_score: number | null;
  kid_url: string;
  aum_eur: number | null;
}

interface DocsResponse {
  data: DocFund[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

const PRODUCT_TYPES = [
  { val: "",            label: "Tous" },
  { val: "etf",        label: "ETF" },
  { val: "opcvm",      label: "OPCVM" },
  { val: "scpi",       label: "SCPI" },
  { val: "fonds_euros",label: "Fonds euros" },
  { val: "fps",        label: "FPS" },
];

function TypePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors whitespace-nowrap ${
        active
          ? "bg-brown text-paper border-brown"
          : "bg-paper text-ink-2 border-line hover:border-accent/30"
      }`}
    >
      {label}
    </button>
  );
}

function TypeTag({ type }: { type: string | null }) {
  if (!type) return null;
  const label = type.toUpperCase().replace("_", " ");
  const cls =
    type === "etf"         ? "bg-accent-soft text-accent-ink" :
    type === "opcvm"       ? "bg-paper-2 text-ink-2" :
    type === "scpi"        ? "bg-ok-soft text-ok" :
    type === "fonds_euros" ? "bg-warn-soft text-warn" :
                             "bg-paper-2 text-ink-2";
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium font-mono ${cls}`}>
      {label}
    </span>
  );
}

async function fetchDocs(search: string, types: string, page: number): Promise<DocsResponse> {
  const sp = new URLSearchParams();
  if (search) sp.set("search", search);
  if (types)  sp.set("types", types);
  sp.set("page", String(page));
  sp.set("per_page", "50");
  const res = await fetch(`/api/documents?${sp.toString()}`);
  if (!res.ok) throw new Error("API error");
  return res.json();
}

export default function DocumentsPage() {
  const [search,  setSearch]  = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page,    setPage]    = useState(1);
  const [funds,   setFunds]   = useState<DocFund[]>([]);
  const [total,   setTotal]   = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(1);
    }, 300);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDocs(debouncedSearch, typeFilter, page)
      .then((r) => {
        if (!cancelled) {
          setFunds(r.data);
          setTotal(r.total);
          setTotalPages(r.total_pages);
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedSearch, typeFilter, page]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-cream">

      {/* Header */}
      <div className="shrink-0 border-b border-line bg-paper px-6 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] text-ink" style={{ fontFamily: "var(--font-serif)" }}>
            Documents DICI
          </h1>
          <span className="text-[12px] text-muted">
            {loading ? "…" : `${total.toLocaleString("fr-FR")} documents`}
          </span>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 bg-paper-2 rounded-xl border border-line px-3.5 py-2.5">
          <Search size={14} className="text-muted shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Rechercher par nom, ISIN ou gestionnaire…"
            className="flex-1 text-[13px] text-ink bg-transparent focus:outline-none placeholder:text-muted"
          />
          {search && (
            <button
              onClick={() => { setSearch(""); setDebouncedSearch(""); setPage(1); }}
              className="text-muted hover:text-ink transition-colors text-[11px]"
            >
              ✕
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="flex gap-2 flex-wrap">
          {PRODUCT_TYPES.map(({ val, label }) => (
            <TypePill
              key={val}
              label={label}
              active={typeFilter === val}
              onClick={() => { setTypeFilter(val); setPage(1); }}
            />
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : funds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <FileText size={32} className="text-muted-2" strokeWidth={1.25} />
            <p className="text-[13px] text-muted">Aucun document trouvé.</p>
          </div>
        ) : (
          <div className="border border-line rounded-xl overflow-x-auto bg-paper">
            <table className="w-full text-[12.5px] border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold">Fonds</th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-center whitespace-nowrap">Type</th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-center whitespace-nowrap">SFDR</th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-center whitespace-nowrap">SRI</th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-center whitespace-nowrap">DICI</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => (
                  <tr key={f.isin} className="border-b border-dashed border-line-soft hover:bg-cream transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink leading-tight truncate max-w-[320px]">
                        {decodeHtml(f.name)}
                      </div>
                      <div className="text-[11px] text-muted font-mono mt-0.5">
                        {f.isin}{f.gestionnaire ? ` · ${f.gestionnaire}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <TypeTag type={f.product_type} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <SfdrBadge article={f.sfdr_article} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <SriBadge sri={f.risk_score} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={f.kid_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line bg-paper-2 text-[11px] font-medium text-ink-2 hover:bg-accent-soft hover:border-accent/20 hover:text-accent-ink transition-colors"
                      >
                        <FileText size={11} />
                        DICI
                        <ExternalLink size={10} className="text-muted" />
                      </a>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link href={`/fonds/${f.isin}`} className="text-muted hover:text-ink transition-colors">
                        <ChevronRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-2 py-3 text-[11px] text-muted">
            <span>Page {page} / {totalPages}</span>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-line hover:bg-paper-2 disabled:opacity-40 transition-colors"
                aria-label="Page précédente"
              >
                <ArrowLeft size={13} />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded border border-line hover:bg-paper-2 disabled:opacity-40 transition-colors"
                aria-label="Page suivante"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
