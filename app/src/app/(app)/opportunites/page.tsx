"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, ChevronRight } from "@/components/ui/icons";
import { pct } from "@/lib/format";
import type { Fund } from "@/lib/types";

const nfEur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const ENVELOPES = [
  { key: "per",    param: "per=true",    label: "PER",           desc: "Plan d'Épargne Retraite" },
  { key: "av_lux", param: "av_lux=true", label: "AV Luxembourg", desc: "Assurance-Vie luxembourgeoise" },
  { key: "av_fr",  param: "av_fr=true",  label: "AV France",     desc: "Assurance-Vie française" },
  { key: "cto",    param: "cto=true",    label: "CTO",           desc: "Compte-Titres Ordinaire" },
] as const;

type EnvKey = (typeof ENVELOPES)[number]["key"];

function fetchRetro(extra = "", limit = 10) {
  const base =
    `/api/screener/funds?types=opcvm&sort_by=retrocession_cgp&sort_dir=desc` +
    `&retrocession_min=0.01&min_completeness=60&per_page=${limit}&deduplicate=true`;
  return fetch(extra ? `${base}&${extra}` : base)
    .then((r) => r.json())
    .then((d) => (d.data ?? []) as Fund[])
    .catch(() => [] as Fund[]);
}

function FundRow({ fund, aum }: { fund: Fund; aum: number | null }) {
  const retro = fund.retrocession_cgp ?? 0;
  const rev = aum != null ? aum * retro : null;

  return (
    <Link
      href={`/fonds/${fund.isin}`}
      className="group flex items-center gap-5 px-5 py-3.5 border-b border-dashed border-line-soft hover:bg-cream transition-colors last:border-0"
    >
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-ink leading-tight truncate group-hover:text-accent transition-colors">
          {fund.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted font-mono">{fund.isin}</span>
          {fund.gestionnaire && <span className="text-[10px] text-muted-2">· {fund.gestionnaire}</span>}
        </div>
      </div>

      <div className="flex items-center gap-5 shrink-0 text-right">
        {(fund.ongoing_charges ?? fund.ter) != null && (
          <div className="w-14">
            <p className="text-[9px] text-muted uppercase tracking-wider">TER</p>
            <p className="text-[12px] font-mono text-ink-2">{pct(fund.ongoing_charges ?? fund.ter)}</p>
          </div>
        )}
        {fund.performance_3y != null && (
          <div className="w-14">
            <p className="text-[9px] text-muted uppercase tracking-wider">Perf 3A</p>
            <p className={`text-[12px] font-mono font-medium ${fund.performance_3y >= 0 ? "text-ok" : "text-warn"}`}>
              {pct(fund.performance_3y, true)}
            </p>
          </div>
        )}
        <div className="w-16">
          <p className="text-[9px] text-muted uppercase tracking-wider">Rétro. CGP</p>
          <p className="text-[16px] font-bold font-mono text-accent">{pct(retro * 100)}</p>
        </div>
        {rev != null && (
          <div className="w-20">
            <p className="text-[9px] text-muted uppercase tracking-wider">Revenu/an</p>
            <p className="text-[13px] font-semibold text-accent font-mono">{nfEur.format(rev)}</p>
          </div>
        )}
      </div>

      <ChevronRight size={14} className="text-muted group-hover:text-accent transition-colors shrink-0" />
    </Link>
  );
}

function EnvSection({ env, funds, aum }: { env: typeof ENVELOPES[number]; funds: Fund[]; aum: number | null }) {
  return (
    <div className="bg-paper rounded-2xl border border-line overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft">
        <div>
          <p className="text-[13px] font-semibold text-ink">{env.label}</p>
          <p className="text-[10px] text-muted mt-0.5">{env.desc}</p>
        </div>
        <Link
          href={`/recherche?q=OPCVM+r%C3%A9trocession+${encodeURIComponent(env.label)}&sort_by=retrocession_cgp`}
          className="text-[10px] text-muted hover:text-accent transition-colors flex items-center gap-0.5"
        >
          Voir tout <ChevronRight size={10} />
        </Link>
      </div>
      {funds.length === 0 ? (
        <p className="px-5 py-5 text-[12px] text-muted italic text-center">
          Aucun OPCVM avec rétrocession pour cette enveloppe.
        </p>
      ) : (
        funds.map((f) => <FundRow key={f.isin} fund={f} aum={aum} />)
      )}
    </div>
  );
}

export default function OpportunitesPage() {
  const [aumInput, setAumInput] = useState("100000");
  const [topAll,   setTopAll]   = useState<Fund[]>([]);
  const [byEnv,    setByEnv]    = useState<Record<EnvKey, Fund[]>>({ per: [], av_lux: [], av_fr: [], cto: [] });
  const [loading,  setLoading]  = useState(true);

  const aum = aumInput ? (parseFloat(aumInput.replace(/\s/g, "").replace(",", ".")) || null) : null;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchRetro("", 10),
      ...ENVELOPES.map((e) => fetchRetro(e.param, 4)),
    ]).then(([all, ...envResults]) => {
      setTopAll(all);
      const map = {} as Record<EnvKey, Fund[]>;
      ENVELOPES.forEach((e, i) => { map[e.key] = envResults[i]; });
      setByEnv(map);
      setLoading(false);
    });
  }, []);

  const top5 = topAll.slice(0, 5).filter((f) => (f.retrocession_cgp ?? 0) > 0);
  const avgTop5 = top5.length > 0
    ? top5.reduce((s, f) => s + (f.retrocession_cgp ?? 0), 0) / top5.length
    : null;

  return (
    <div className="h-full overflow-y-auto bg-cream px-8 py-8">
      <div className="max-w-[1040px] mx-auto">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-1">
            <TrendingUp size={18} className="text-accent" strokeWidth={2} />
            <h1 className="text-[28px] text-ink italic" style={{ fontFamily: "var(--font-serif)" }}>
              Opportunités rétrocession CGP
            </h1>
          </div>
          <p className="text-[12px] text-muted">
            Les OPCVM les plus rémunérateurs en rétrocession de frais de gestion, triés par taux annuel.
          </p>
        </div>

        {/* Calculateur */}
        <div className="bg-accent/10 border border-accent/20 rounded-2xl px-6 py-5 mb-7">
          <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-4">
            Simulateur de revenu CGP
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={aumInput}
                onChange={(e) => setAumInput(e.target.value)}
                placeholder="100000"
                className="w-36 border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
              />
              <span className="text-[13px] text-muted shrink-0">€ investis par client</span>
            </div>
            {aum != null && topAll[0]?.retrocession_cgp != null && (
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-[10px] text-muted mb-0.5">N°1 disponible</p>
                  <p className="text-[22px] font-semibold text-accent font-mono leading-none" style={{ fontFamily: "var(--font-serif)" }}>
                    {nfEur.format(aum * topAll[0].retrocession_cgp)}
                    <span className="text-[11px] font-normal text-muted-2 ml-1">/an</span>
                  </p>
                </div>
                {avgTop5 != null && (
                  <>
                    <span className="text-muted-2 text-[13px]">·</span>
                    <div>
                      <p className="text-[10px] text-muted mb-0.5">Moyenne top 5</p>
                      <p className="text-[22px] font-semibold text-accent-ink font-mono leading-none" style={{ fontFamily: "var(--font-serif)" }}>
                        {nfEur.format(aum * avgTop5)}
                        <span className="text-[11px] font-normal text-muted-2 ml-1">/an</span>
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Top 10 global */}
        <div className="bg-paper rounded-2xl border border-line mb-7 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="text-[15px] font-semibold text-ink" style={{ fontFamily: "var(--font-serif)" }}>
              Top 10 OPCVM · Rétrocession CGP
            </h2>
            <Link
              href="/recherche?q=OPCVM+r%C3%A9trocession+CGP&sort_by=retrocession_cgp"
              className="text-[11px] text-muted hover:text-accent transition-colors flex items-center gap-1"
            >
              Voir tout <ChevronRight size={11} />
            </Link>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : topAll.length === 0 ? (
            <p className="px-5 py-8 text-[12px] text-muted text-center italic">Aucun fonds disponible.</p>
          ) : (
            topAll.map((f) => <FundRow key={f.isin} fund={f} aum={aum} />)
          )}
        </div>

        {/* Par enveloppe */}
        <h2 className="text-[15px] font-semibold text-ink mb-4" style={{ fontFamily: "var(--font-serif)" }}>
          Meilleures rétrocessions par enveloppe
        </h2>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5">
            {ENVELOPES.map((e) => (
              <EnvSection key={e.key} env={e} funds={byEnv[e.key]} aum={aum} />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
