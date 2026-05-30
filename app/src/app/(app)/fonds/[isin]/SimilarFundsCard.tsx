"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { pct } from "@/lib/format";
import { SfdrBadge, SriBadge } from "@/components/ui/Badge";
import type { SimilarFund } from "@/lib/types";

interface Props { isin: string }

export function SimilarFundsCard({ isin }: Props) {
  const [funds, setFunds] = useState<SimilarFund[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/fonds/${isin}/similar?limit=4`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(json => setFunds(json.data ?? []))
      .catch(() => setFunds([]))
      .finally(() => setLoading(false));
  }, [isin]);

  if (loading || funds.length === 0) return null;

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5 col-span-2">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">
        Fonds similaires
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {funds.map(f => (
          <Link
            key={f.isin}
            href={`/fonds/${f.isin}`}
            className="group flex flex-col gap-2 p-3 rounded-xl border border-line-soft hover:border-line hover:bg-cream transition-all"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-ink leading-tight truncate group-hover:text-accent transition-colors">
                  {f.name}
                </p>
                <p className="text-[10px] text-muted font-mono mt-0.5">{f.isin}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <SfdrBadge article={f.sfdr_article} />
                <SriBadge sri={f.risk_score} />
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] flex-wrap">
              {f.ter != null && (
                <span className="text-muted">
                  TER <span className="font-mono text-ink-2">{pct(f.ter)}</span>
                </span>
              )}
              {f.performance_3y != null && (
                <span className={`font-mono font-medium ${f.performance_3y >= 0 ? "text-ok" : "text-warn"}`}>
                  {pct(f.performance_3y, true)} 3A
                </span>
              )}
              {f.performance_1y != null && f.performance_3y == null && (
                <span className={`font-mono font-medium ${f.performance_1y >= 0 ? "text-ok" : "text-warn"}`}>
                  {pct(f.performance_1y, true)} 1A
                </span>
              )}
              {f.retrocession_cgp != null && f.retrocession_cgp > 0 && (
                <span className="font-mono font-medium text-accent">
                  Rétro. {pct(f.retrocession_cgp * 100)}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
