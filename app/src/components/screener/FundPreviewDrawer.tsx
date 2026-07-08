"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X, Download, Check, ChevronRight } from "@/components/ui/icons";
import { SfdrBadge, SriBadge, MorningstarBadge } from "@/components/ui/Badge";
import { InsurerChips } from "@/components/screener/InsurerChips";
import { Btn } from "@/components/ui/Btn";
import { useSelection } from "@/components/SelectionProvider";
import { Sparkline } from "@/components/ui/Sparkline";
import { pct, fmtAum, dt } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

interface FundPreviewDrawerProps {
  isin: string | null;
  onClose: () => void;
}

function KpiTile({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean | null }) {
  return (
    <div className="flex-1 bg-paper-2 rounded-lg p-3 min-w-0">
      <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-1">{label}</p>
      <p
        className={`text-subhead leading-none font-medium ${
          ok == null ? "text-ink" : ok ? "text-ok" : "text-danger"
        }`}
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {value}
      </p>
      {sub && <p className="text-caption text-muted font-mono mt-1">{sub}</p>}
    </div>
  );
}

export function FundPreviewDrawer({ isin, onClose }: FundPreviewDrawerProps) {
  const [fund, setFund] = useState<FundDetailHF | null>(null);
  const [loading, setLoading] = useState(false);
  const { toggle, isSelected } = useSelection();

  useEffect(() => {
    if (!isin) { setFund(null); return; }
    // Guard d'annulation : sur clics rapides (ligne A puis B), la réponse de A
    // ne doit pas écraser le fonds B affiché (sinon mauvais référencement montré).
    let cancelled = false;
    setLoading(true);
    fetch(`/api/funds/${isin}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setFund(d.data ?? null); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isin]);

  if (!isin) return null;

  const sel = isin ? isSelected(isin) : false;

  return (
    <div className="c-slide-in flex flex-col shrink-0 bg-paper border border-line overflow-y-auto fixed inset-0 z-[60] w-full rounded-none md:static md:z-auto md:inset-auto md:w-[380px] md:rounded-xl">
      {/* Head */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-line shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-1">Aperçu</p>
          {loading ? (
            <div className="h-5 w-3/4 bg-paper-2 rounded animate-pulse" />
          ) : (
            <p className="text-body-lg font-medium text-ink leading-tight truncate" style={{ fontFamily: "var(--font-sans)" }}>
              {fund?.name ?? "—"}
            </p>
          )}
        </div>
        {/* Compare pill */}
        <button
          onClick={() => fund && toggle({
            isin: fund.isin, name: fund.name, gestionnaire: fund.gestionnaire,
            sfdr_article: fund.sfdr_article, risk_score: fund.risk_score,
            performance_1y: fund.performance_1y, performance_3y: fund.performance_3y,
            performance_5y: fund.performance_5y, ongoing_charges: fund.ongoing_charges,
            volatility_1y: fund.volatility_1y, sharpe_1y: fund.sharpe_1y,
            max_drawdown_3y: fund.max_drawdown_3y, morningstar_rating: fund.morningstar_rating,
            track_record_years: fund.track_record_years, aum_eur: fund.aum_eur,
            retrocession_cgp: fund.retrocession_cgp,
            pea_eligible: fund.pea_eligible, pea_pme_eligible: fund.pea_pme_eligible,
            per_eligible: fund.per_eligible,
            av_fr_eligible: fund.av_fr_eligible, av_lux_eligible: fund.av_lux_eligible,
            cto_eligible: fund.cto_eligible,
          })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-label font-medium border transition-colors shrink-0 ${
            sel
              ? "bg-accent-soft text-accent-ink border-accent/30"
              : "border-line text-ink-2 hover:border-accent/40"
          }`}
        >
          {sel ? <Check size={11} /> : null}
          {sel ? "Sélectionné" : "Comparer"}
        </button>
        <button onClick={onClose} className="text-muted hover:text-ink transition-colors shrink-0">
          <X size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : fund ? (
        <div className="flex-1 px-4 py-3 space-y-4">
          {/* Actions — DICI uniquement si disponible */}
          {fund.kid_url && (
            <Btn
              variant="outline"
              size="sm"
              onClick={() => window.open(fund.kid_url!, "_blank")}
              className="w-full"
            >
              <Download size={13} />
              Télécharger le DICI
            </Btn>
          )}

          {/* Meta */}
          <div className="space-y-0.5 text-label text-ink-2">
            <p className="font-mono text-muted">{fund.isin}</p>
            {fund.gestionnaire && <p>{fund.gestionnaire}</p>}
            {fund.category_normalized && <p>{fund.category_normalized}</p>}
            {fund.inception_date && <p>Création {dt(fund.inception_date)}</p>}
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5">
            <SfdrBadge article={fund.sfdr_article} />
            <SriBadge sri={fund.risk_score} />
            <MorningstarBadge rating={fund.morningstar_rating} />
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-2">
            <KpiTile label="Perf 1A" value={pct(fund.performance_1y, true)} ok={fund.performance_1y != null ? fund.performance_1y >= 0 : null} />
            {(fund.track_record_years ?? 0) >= 3
              ? <KpiTile label="Perf 3A" value={pct(fund.performance_3y, true)} ok={fund.performance_3y != null ? fund.performance_3y >= 0 : null} />
              : <KpiTile label="Vol 1A" value={pct(fund.volatility_1y)} />
            }
            <KpiTile label="TER" value={pct(fund.ongoing_charges ?? fund.ter)} />
            {(fund.track_record_years ?? 0) >= 3
              ? <KpiTile label="Vol 1A" value={pct(fund.volatility_1y)} />
              : <KpiTile label="Sharpe 1A" value={fund.sharpe_1y?.toFixed(2) ?? "—"} />
            }
          </div>

          {/* Sparkline */}
          {fund.nav_history.length > 1 && (
            <div className="bg-paper-2 rounded-lg p-3">
              <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-2">Historique VL</p>
              <Sparkline data={fund.nav_history} width={320} height={50} />
            </div>
          )}

          {/* Éligibilités */}
          <div>
            <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-2">Éligibilités</p>
            <div className="flex gap-2 flex-wrap">
              {fund.pea_eligible     && <span className="text-label text-ok bg-ok-soft px-2 py-0.5 rounded font-medium">✓ PEA</span>}
              {fund.pea_pme_eligible && <span className="text-label text-ok bg-ok-soft px-2 py-0.5 rounded font-medium">✓ PEA-PME</span>}
              {fund.per_eligible     && <span className="text-label text-ok bg-ok-soft px-2 py-0.5 rounded font-medium">✓ PER</span>}
              {fund.av_fr_eligible   && <span className="text-label text-ok bg-ok-soft px-2 py-0.5 rounded font-medium">✓ AV France</span>}
              {fund.av_lux_eligible  && <span className="text-label text-ok bg-ok-soft px-2 py-0.5 rounded font-medium">✓ AV Lux</span>}
              {fund.cto_eligible     && <span className="text-label text-ok bg-ok-soft px-2 py-0.5 rounded font-medium">✓ CTO</span>}
              {!fund.pea_eligible && !fund.pea_pme_eligible && !fund.per_eligible && !fund.av_fr_eligible && !fund.av_lux_eligible && !fund.cto_eligible && (
                <span className="text-label text-muted">Aucune éligibilité confirmée</span>
              )}
            </div>
          </div>

          {/* Référencement assureur : « chez quel(s) assureur(s) le fonds est
              référencé » (réponse au retour CGP). Noms d'assureurs en chips,
              cohérent avec le tableau et la fiche. */}
          <div>
            <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-2">Référencement assureur</p>
            {(fund.insurers ?? []).length > 0 ? (
              <InsurerChips insurers={(fund.insurers ?? []).map((r) => r.company)} max={6} />
            ) : (
              <p className="text-label text-muted">Aucun référencement renseigné</p>
            )}
          </div>

          {/* Caractéristiques */}
          <div>
            <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-2">Caractéristiques</p>
            <table className="w-full text-label">
              <tbody>
                {[
                  ["AUM", fmtAum(fund.aum_eur)],
                  ["Track record", fund.track_record_years ? `${fund.track_record_years} ans` : "—"],
                  ["Devise", fund.currency ?? "—"],
                  ["Sharpe 1A", fund.sharpe_1y?.toFixed(2) ?? "—"],
                  ["Max DD 3A", pct(fund.max_drawdown_3y)],
                ].map(([l, v]) => (
                  <tr key={l} className="border-b border-line-soft">
                    <td className="py-1.5 text-muted">{l}</td>
                    <td className="py-1.5 text-right text-ink-2 font-mono">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* CTA */}
          <Link
            href={`/fonds/${fund.isin}`}
            className="flex items-center justify-between w-full bg-paper-2 hover:bg-accent-soft/40 border border-line hover:border-accent/30 rounded-lg px-4 py-3 transition-colors group"
          >
            <span className="text-meta font-medium text-ink" style={{ fontFamily: "var(--font-sans)" }}>
              Voir la fiche complète
            </span>
            <ChevronRight size={15} className="text-muted group-hover:text-accent-ink transition-colors" />
          </Link>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted text-body-lg">
          Fonds introuvable
        </div>
      )}
    </div>
  );
}
