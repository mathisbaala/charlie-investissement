"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileText,
  Search,
  Shield,
  Target,
  TrendingUp,
  Wallet,
  AlertTriangle,
} from "@/components/ui/icons";
import { Card } from "@/components/ui/Card";
import { NavChart } from "@/components/fund/NavChart";
import { CompositionCard } from "../fonds/[isin]/CompositionCard";
import { pct, dt, fmtSharpe, nf } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DiciScenario = {
  scenario: "stress" | "defavorable" | "intermediaire" | "favorable";
  return_pct: number | null;
  final_amount: number | null;
};

export interface DiciFiche {
  name: string;
  isin: string | null;
  gestionnaire: string | null;
  product_type: string | null;
  sfdr_article: number | null;
  sri: number | null;
  investment_objective: string | null;
  recommended_holding_period: string | null;
  entry_fees_max: string | null;
  exit_fees_max: string | null;
  ongoing_charges: number | null;
  performance_fees: string | null;
  target_investor: string | null;
  key_risks: string[] | null;
  benchmark: string | null;
  currency: string | null;
  domicile: string | null;
  inception_date: string | null;
  transaction_costs: number | null;
  total_costs: number | null;
  performance_scenarios: DiciScenario[] | null;
  // Reliure base de données : ISIN/nom du fonds retrouvé en base (null si introuvable).
  matched_isin: string | null;
  matched_name: string | null;
}

// ─── Petites primitives visuelles du rapport ─────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  etf: "ETF",
  opcvm: "OPCVM",
  scpi: "SCPI",
  fonds_euros: "Fonds euros",
  structured: "Produit structuré",
  autre: "Fonds",
};

function SectionTitle({
  icon,
  children,
  source,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  source?: "document" | "market";
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <h3 className="flex items-center gap-2 text-label uppercase tracking-widest font-semibold text-muted">
        {icon}
        {children}
      </h3>
      {source && (
        <span
          className={`text-caption font-medium rounded-full px-2 py-0.5 border ${
            source === "document"
              ? "bg-accent-soft text-accent-ink border-accent/20"
              : "bg-paper-2 text-muted border-line"
          }`}
        >
          {source === "document" ? "Issu du document" : "Données de marché"}
        </span>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  unit,
  tone = "ink",
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  tone?: "ink" | "ok" | "danger" | "warn";
}) {
  const toneCls =
    tone === "ok"
      ? "text-ok"
      : tone === "danger"
      ? "text-danger"
      : tone === "warn"
      ? "text-warn"
      : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3.5">
      <p className="text-caption uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span
          className={`text-title-lg font-medium ${toneCls}`}
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {value}
        </span>
        {unit && <span className="text-meta text-muted">{unit}</span>}
      </p>
    </div>
  );
}

// Jauge SRI 1-7, segmentée, avec curseur sur le niveau atteint.
function SriGauge({ sri }: { sri: number }) {
  const colorFor = (i: number) =>
    i <= 1 ? "var(--color-ok)" : i <= 3 ? "var(--color-warn)" : "var(--color-danger)";
  return (
    <div>
      <div className="flex gap-1">
        {Array.from({ length: 7 }, (_, i) => {
          const level = i + 1;
          const active = level === sri;
          return (
            <div key={i} className="flex-1">
              <div
                className="h-2.5 rounded-full transition-all"
                style={{
                  backgroundColor: level <= sri ? colorFor(i) : "var(--color-line)",
                  opacity: level <= sri ? 1 : 1,
                }}
              />
              <p
                className={`mt-1 text-center text-caption font-mono ${
                  active ? "text-ink font-bold" : "text-muted-2"
                }`}
              >
                {level}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-caption text-muted">
        <span>Risque faible</span>
        <span>Risque élevé</span>
      </div>
    </div>
  );
}

// Barres horizontales des scénarios de performance du KID.
function ScenarioChart({ scenarios }: { scenarios: DiciScenario[] }) {
  const order: DiciScenario["scenario"][] = [
    "favorable",
    "intermediaire",
    "defavorable",
    "stress",
  ];
  const meta: Record<DiciScenario["scenario"], { label: string; color: string }> = {
    favorable: { label: "Favorable", color: "var(--color-ok)" },
    intermediaire: { label: "Intermédiaire", color: "var(--color-accent)" },
    defavorable: { label: "Défavorable", color: "var(--color-warn)" },
    stress: { label: "Tensions", color: "var(--color-danger)" },
  };
  const sorted = order
    .map((k) => scenarios.find((s) => s.scenario === k))
    .filter((s): s is DiciScenario => Boolean(s));
  if (!sorted.length) return null;

  const amounts = sorted.map((s) => s.final_amount).filter((a): a is number => a != null);
  const maxAmount = amounts.length ? Math.max(...amounts, 10000) : 0;

  return (
    <div className="space-y-3">
      {sorted.map((s) => {
        const m = meta[s.scenario];
        const widthPct =
          maxAmount && s.final_amount != null
            ? Math.max(6, (s.final_amount / maxAmount) * 100)
            : null;
        const gain = s.return_pct != null && s.return_pct >= 0;
        return (
          <div key={s.scenario}>
            <div className="flex items-center justify-between text-meta mb-1">
              <span className="font-medium text-ink-2">{m.label}</span>
              <span className="flex items-center gap-3 font-mono">
                {s.return_pct != null && (
                  <span className={gain ? "text-ok" : "text-danger"}>
                    {pct(s.return_pct, true)}/an
                  </span>
                )}
                {s.final_amount != null && (
                  <span className="text-ink-2">{nf.format(Math.round(s.final_amount))} €</span>
                )}
              </span>
            </div>
            <div className="h-3 rounded-full bg-paper-2 overflow-hidden">
              {widthPct != null && (
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${widthPct}%`, backgroundColor: m.color }}
                />
              )}
            </div>
          </div>
        );
      })}
      <p className="text-caption text-muted pt-1">
        Projection réglementaire pour 10&nbsp;000&nbsp;€ investis sur la durée de détention
        recommandée. Ces scénarios ne sont pas un indicateur exact ; les performances futures
        peuvent différer.
      </p>
    </div>
  );
}

// Une ligne de frais dans le tableau visuel.
function FeeLine({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-line-soft last:border-0">
      <div>
        <span className="text-meta text-ink-2">{label}</span>
        {hint && <p className="text-caption text-muted">{hint}</p>}
      </div>
      <span className="text-subhead font-mono font-medium text-ink-2 shrink-0">{value}</span>
    </div>
  );
}

// ─── Rapport principal ───────────────────────────────────────────────────────

export function DiciReport({ fiche, onReset }: { fiche: DiciFiche; onReset: () => void }) {
  const router = useRouter();
  const [fund, setFund] = useState<FundDetailHF | null>(null);
  const [fundLoading, setFundLoading] = useState(false);

  // Enrichissement : si le DICI est rattaché à un fonds en base, on récupère ses
  // données de marché (historique de VL, sous-jacents, volatilité…) pour des
  // visuels que le document seul ne contient pas.
  useEffect(() => {
    if (!fiche.matched_isin) {
      setFund(null);
      return;
    }
    let cancelled = false;
    setFundLoading(true);
    fetch(`/api/funds/${fiche.matched_isin}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setFund(j?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setFund(null);
      })
      .finally(() => {
        if (!cancelled) setFundLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fiche.matched_isin]);

  const typeLabel = fiche.product_type
    ? TYPE_LABELS[fiche.product_type] ?? fiche.product_type.toUpperCase()
    : null;

  const scenarios = fiche.performance_scenarios?.filter(
    (s) => s.return_pct != null || s.final_amount != null,
  );

  const sriTone = (sri: number) => (sri <= 2 ? "ok" : sri <= 4 ? "warn" : "danger");

  return (
    <div className="space-y-5">
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden px-6 py-6 md:px-8 md:py-7">
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{
            background:
              "linear-gradient(90deg, var(--color-accent) 0%, var(--color-ok) 100%)",
          }}
        />
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {typeLabel && (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-label font-semibold uppercase tracking-wide bg-accent-soft text-accent-ink">
                  {typeLabel}
                </span>
              )}
              {fiche.sfdr_article && (
                <span
                  className={`inline-flex px-2.5 py-0.5 rounded-full text-label font-medium border ${
                    fiche.sfdr_article === 9
                      ? "bg-ok-soft text-ok border-ok/20"
                      : fiche.sfdr_article === 8
                      ? "bg-accent-soft text-accent-ink border-accent/20"
                      : "bg-paper-2 text-muted border-line"
                  }`}
                >
                  Article {fiche.sfdr_article}
                </span>
              )}
              {fiche.currency && (
                <span className="text-caption font-mono bg-paper-2 border border-line rounded px-1.5 py-0.5 text-ink-2">
                  {fiche.currency}
                </span>
              )}
            </div>
            <h2
              className="text-display-md leading-[1.1] text-ink font-medium"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {fiche.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-meta text-muted">
              {fiche.gestionnaire && <span>{fiche.gestionnaire}</span>}
              {fiche.isin && (
                <span className="font-mono text-muted-2">{fiche.isin}</span>
              )}
              {fiche.domicile && <span>· {fiche.domicile}</span>}
              {fiche.inception_date && <span>· depuis {dt(fiche.inception_date)}</span>}
            </div>
          </div>

          {/* Synthèse risque/frais à droite */}
          <div className="flex gap-6 shrink-0">
            {fiche.sri != null && (
              <div className="text-center">
                <p className="text-caption uppercase tracking-widest text-muted">Risque</p>
                <p
                  className={`text-display-md font-medium ${
                    sriTone(fiche.sri) === "ok"
                      ? "text-ok"
                      : sriTone(fiche.sri) === "warn"
                      ? "text-warn"
                      : "text-danger"
                  }`}
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {fiche.sri}
                  <span className="text-title text-muted">/7</span>
                </p>
              </div>
            )}
            {fiche.ongoing_charges != null && (
              <div className="text-center">
                <p className="text-caption uppercase tracking-widest text-muted">Frais/an</p>
                <p
                  className="text-display-md font-medium text-ink"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {nf.format(fiche.ongoing_charges)}
                  <span className="text-title text-muted">%</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Bandeau KPI ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {fiche.ongoing_charges != null && (
          <KpiTile label="Frais courants" value={nf.format(fiche.ongoing_charges)} unit="%/an" />
        )}
        {fiche.sri != null && (
          <KpiTile
            label="Indicateur de risque"
            value={`${fiche.sri}/7`}
            tone={sriTone(fiche.sri)}
          />
        )}
        {fiche.recommended_holding_period && (
          <KpiTile label="Durée recommandée" value={fiche.recommended_holding_period} />
        )}
        {fund?.performance_5y != null ? (
          <KpiTile
            label="Perf. 5 ans (annual.)"
            value={pct(fund.performance_5y, true)}
            tone={fund.performance_5y >= 0 ? "ok" : "danger"}
          />
        ) : fiche.benchmark ? (
          <KpiTile label="Indice de référence" value={<span className="text-body">{fiche.benchmark}</span>} />
        ) : fiche.domicile ? (
          <KpiTile label="Domiciliation" value={<span className="text-body">{fiche.domicile}</span>} />
        ) : null}
      </div>

      {/* ── Objectif ────────────────────────────────────────────────────────── */}
      {(fiche.investment_objective || fiche.target_investor) && (
        <Card className="px-6 py-5">
          <SectionTitle icon={<Target size={13} />} source="document">
            Objectif d'investissement
          </SectionTitle>
          {fiche.investment_objective && (
            <p className="text-body text-ink-2 leading-relaxed">{fiche.investment_objective}</p>
          )}
          {fiche.target_investor && (
            <div className="mt-4 pt-4 border-t border-line-soft">
              <p className="text-caption uppercase tracking-widest text-muted mb-1">
                Investisseur cible
              </p>
              <p className="text-meta text-ink-2 leading-relaxed">{fiche.target_investor}</p>
            </div>
          )}
        </Card>
      )}

      {/* ── Scénarios de performance (document) ─────────────────────────────── */}
      {scenarios && scenarios.length > 0 && (
        <Card className="px-6 py-5">
          <SectionTitle icon={<TrendingUp size={13} />} source="document">
            Scénarios de performance
          </SectionTitle>
          <ScenarioChart scenarios={scenarios} />
        </Card>
      )}

      {/* ── Performance historique (données de marché) ──────────────────────── */}
      {fund && fund.nav_history && fund.nav_history.length > 1 && (
        <Card className="px-4 py-4 md:px-6 md:py-5">
          <SectionTitle icon={<TrendingUp size={13} />} source="market">
            Performance historique
          </SectionTitle>
          <NavChart data={fund.nav_history} />
          {(fund.performance_1y != null ||
            fund.performance_3y != null ||
            fund.performance_5y != null) && (
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-line-soft">
              {[
                { label: "1 an", v: fund.performance_1y },
                { label: "3 ans (ann.)", v: fund.performance_3y },
                { label: "5 ans (ann.)", v: fund.performance_5y },
              ].map((p) => (
                <div key={p.label} className="text-center">
                  <p className="text-caption uppercase tracking-widest text-muted">{p.label}</p>
                  <p
                    className={`text-subhead font-mono font-medium ${
                      p.v == null ? "text-muted" : p.v >= 0 ? "text-ok" : "text-danger"
                    }`}
                  >
                    {p.v == null ? "-" : pct(p.v, true)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Risque & métriques ──────────────────────────────────────────────── */}
      {(fiche.sri != null || fund) && (
        <Card className="px-6 py-5">
          <SectionTitle icon={<Shield size={13} />} source={fund ? "market" : "document"}>
            Profil de risque
          </SectionTitle>
          {fiche.sri != null && (
            <div className="mb-5">
              <SriGauge sri={fiche.sri} />
            </div>
          )}
          {fund && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {fund.volatility_1y != null && (
                <div>
                  <p className="text-caption uppercase tracking-widest text-muted">Volatilité 1A</p>
                  <p className="text-subhead font-mono font-medium text-ink-2">
                    {pct(fund.volatility_1y)}
                  </p>
                </div>
              )}
              {fund.sharpe_1y != null && (
                <div>
                  <p className="text-caption uppercase tracking-widest text-muted">Ratio de Sharpe</p>
                  <p className="text-subhead font-mono font-medium text-ink-2">
                    {fmtSharpe(fund.sharpe_1y)}
                  </p>
                </div>
              )}
              {(fund.max_drawdown_3y ?? fund.max_drawdown_1y) != null && (
                <div>
                  <p className="text-caption uppercase tracking-widest text-muted">
                    Perte max. {fund.max_drawdown_3y != null ? "3A" : "1A"}
                  </p>
                  <p className="text-subhead font-mono font-medium text-danger">
                    {pct(fund.max_drawdown_3y ?? fund.max_drawdown_1y)}
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── Frais (document) ────────────────────────────────────────────────── */}
      {(fiche.entry_fees_max ||
        fiche.exit_fees_max ||
        fiche.ongoing_charges != null ||
        fiche.transaction_costs != null ||
        fiche.total_costs != null ||
        fiche.performance_fees) && (
        <Card className="px-6 py-5">
          <SectionTitle icon={<Wallet size={13} />} source="document">
            Frais
          </SectionTitle>
          <div className="grid md:grid-cols-2 gap-x-8">
            <div>
              {fiche.entry_fees_max && (
                <FeeLine label="Frais d'entrée (max)" value={fiche.entry_fees_max} />
              )}
              {fiche.ongoing_charges != null && (
                <FeeLine
                  label="Frais courants"
                  value={`${nf.format(fiche.ongoing_charges)} %`}
                  hint="Prélevés chaque année"
                />
              )}
              {fiche.exit_fees_max && (
                <FeeLine label="Frais de sortie (max)" value={fiche.exit_fees_max} />
              )}
            </div>
            <div>
              {fiche.transaction_costs != null && (
                <FeeLine
                  label="Coûts de transaction"
                  value={`${nf.format(fiche.transaction_costs)} %`}
                />
              )}
              {fiche.performance_fees && (
                <FeeLine label="Commission de performance" value={fiche.performance_fees} />
              )}
              {fiche.total_costs != null && (
                <FeeLine
                  label="Coût total annuel"
                  value={`${nf.format(fiche.total_costs)} %`}
                  hint="Réduction de rendement"
                />
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Sous-jacents (données de marché) ────────────────────────────────── */}
      {fund && <CompositionCard fund={fund} />}

      {/* ── Risques ─────────────────────────────────────────────────────────── */}
      {fiche.key_risks && fiche.key_risks.length > 0 && (
        <Card className="px-6 py-5">
          <SectionTitle icon={<AlertTriangle size={13} />} source="document">
            Principaux risques
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {fiche.key_risks.map((r, i) => (
              <span
                key={i}
                className="text-label bg-warn-soft border border-warn/15 text-warn-dark rounded-lg px-3 py-1.5"
              >
                {r}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* ── Reliure & actions ───────────────────────────────────────────────── */}
      {fiche.matched_isin ? (
        <div className="flex items-start gap-2.5 bg-ok-soft border border-ok/20 rounded-xl px-4 py-3">
          <span className="text-ok text-body-lg shrink-0 leading-5">✓</span>
          <p className="text-meta text-ink-2 leading-relaxed">
            Fonds identifié dans la base&nbsp;:{" "}
            <span className="font-medium">{fiche.matched_name}</span>{" "}
            <span className="font-mono text-muted">{fiche.matched_isin}</span>. Le rapport est
            enrichi des données de marché ci-dessus.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 bg-paper-2 border border-line rounded-xl px-4 py-3">
          <span className="text-muted text-body-lg shrink-0 leading-5">○</span>
          <p className="text-meta text-muted leading-relaxed">
            Ce fonds n'a pas été retrouvé dans la base&nbsp;: le rapport se limite aux données du
            document. Vous pouvez le rechercher dans le screener.
          </p>
        </div>
      )}

      {fundLoading && (
        <p className="text-meta text-muted text-center">Enrichissement des données de marché…</p>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {fiche.matched_isin ? (
          <button
            onClick={() => router.push(`/fonds/${fiche.matched_isin}`)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-meta font-medium bg-ink text-paper hover:bg-ink-strong transition-colors active:translate-y-px"
          >
            <ArrowRight size={14} />
            Voir la fiche produit complète
          </button>
        ) : (
          <button
            onClick={() =>
              router.push(`/recherche?q=${encodeURIComponent(fiche.isin ?? fiche.name)}`)
            }
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-meta font-medium bg-ink text-paper hover:bg-ink-strong transition-colors active:translate-y-px"
          >
            <Search size={13} />
            Rechercher ce fonds
          </button>
        )}
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-meta font-medium border border-line bg-paper text-ink-2 hover:bg-paper-2 transition-colors"
        >
          <FileText size={13} />
          Analyser un autre document
        </button>
      </div>
    </div>
  );
}
