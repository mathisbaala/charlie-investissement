"use client";

import Link from "next/link";
import { ArrowLeft, Download } from "@/components/ui/icons";
import { NavChart } from "@/components/fund/NavChart";
import { SfdrBadge, SriBadge, MorningstarBadge } from "@/components/ui/Badge";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import type { FundDetailHF } from "@/lib/types";
import { KpiStrip } from "./KpiStrip";
import { CharacteristicsCard } from "./CharacteristicsCard";
import { RisqueCard } from "./RisqueCard";
import { EnveloppesCard } from "./EnveloppesCard";
import { FeesCard } from "./FeesCard";
import { TrackingDifferenceCard } from "./TrackingDifferenceCard";
import { PerfNetteCard } from "./PerfNetteCard";
import { CompositionCard } from "./CompositionCard";
import { SimilarFundsCard } from "./SimilarFundsCard";
import { ReferencementCard } from "./ReferencementCard";

const LABEL_DISPLAY: Record<string, string> = {
  isr: "ISR",
  greenfin: "Greenfin",
  esg: "ESG",
  solidaire: "Solidaire",
  novethic: "Novethic",
  "towards-sustainability": "Towards Sustainability",
  "luxflag-esg": "LuxFLAG ESG",
  "luxflag-environment": "LuxFLAG Env.",
  "luxflag-climate-finance": "LuxFLAG Climat",
};

interface Props { fund: FundDetailHF; }

export function FundSheetClient({ fund }: Props) {
  return (
    <div className="h-full overflow-y-auto bg-cream">
      <div className="max-w-[1100px] mx-auto px-4 py-5 md:px-8 md:py-8">

        {/* Back link */}
        <Link
          href="/recherche"
          className="inline-flex items-center gap-1.5 text-label text-muted hover:text-ink-2 transition-colors mb-6"
        >
          <ArrowLeft size={12} />
          Retour à la recherche
        </Link>

        {/* Banner */}
        <Card className="px-5 py-5 md:px-7 md:py-6 mb-5">
          <div className="flex flex-col md:flex-row items-start gap-4 md:gap-6">
            <div className="flex-1 min-w-0">
              {/* Product type chip */}
              {fund.product_type && (
                <span className="inline-block text-caption uppercase tracking-widest font-semibold text-muted bg-paper-2 border border-line rounded-full px-2.5 py-0.5 mb-3">
                  {fund.product_type.toUpperCase()}
                </span>
              )}
              {/* Fund name */}
              <h1
                className="text-display leading-[1.2] text-ink font-normal"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {fund.name}
              </h1>
              {/* Gestionnaire + ISIN */}
              <div className="flex items-center gap-3 mt-2 text-meta text-muted">
                {fund.gestionnaire && <span>{fund.gestionnaire}</span>}
                <span className="font-mono text-muted-2">{fund.isin}</span>
                {fund.currency && (
                  <span className="bg-paper-2 border border-line rounded px-1.5 py-0.5 text-caption font-mono">
                    {fund.currency}
                  </span>
                )}
              </div>
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <SfdrBadge article={fund.sfdr_article} />
                <SriBadge sri={fund.risk_score} />
                <MorningstarBadge rating={fund.morningstar_rating} />
                {fund.labels && fund.labels.filter(l => LABEL_DISPLAY[l.toLowerCase()]).map(l => (
                  <span
                    key={l}
                    className="text-caption px-2 py-0.5 rounded-full font-medium border bg-ok-soft text-ok border-ok/20"
                  >
                    {LABEL_DISPLAY[l.toLowerCase()]}
                  </span>
                ))}
              </div>
            </div>
            {/* Actions */}
            <div className="flex flex-row flex-wrap md:flex-col gap-2 shrink-0 w-full md:w-auto">
              {fund.kid_url && (
                <Btn
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(fund.kid_url!, "_blank")}
                >
                  <Download size={13} />
                  DICI
                </Btn>
              )}
              <Btn
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/rapport/pdf?isins=${fund.isin}`, "_blank")}
              >
                <Download size={13} />
                Rapport PDF
              </Btn>
            </div>
          </div>

          {/* AUM quick stat */}
          {fund.aum_eur != null && (
            <div className="mt-4 pt-4 border-t border-line-soft flex flex-wrap items-center gap-x-5 gap-y-1 md:gap-6 text-label">
              <span className="text-muted">Encours</span>
              <span className="font-mono text-ink-2 font-medium">
                {fund.aum_eur >= 1_000_000_000
                  ? `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(fund.aum_eur / 1_000_000_000)} Md€`
                  : `${Math.round(fund.aum_eur / 1_000_000).toLocaleString("fr-FR")} M€`
                }
              </span>
              {fund.track_record_years != null && (
                <>
                  <span className="text-muted">Ancienneté</span>
                  <span className="font-mono text-ink-2 font-medium">{new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(fund.track_record_years)} ans</span>
                </>
              )}
              {fund.inception_date && (
                <>
                  <span className="text-muted">Création</span>
                  <span className="font-mono text-ink-2">{new Date(fund.inception_date).toLocaleDateString("fr-FR")}</span>
                </>
              )}
            </div>
          )}
        </Card>

        {/* KPI strip */}
        <KpiStrip fund={fund} />

        {/* NAV Chart */}
        {fund.nav_history.length > 1 && (
          <Card className="px-4 py-4 md:px-7 md:py-5 mt-5">
            <NavChart data={fund.nav_history} />
          </Card>
        )}

        {/* Grille de cartes : 1 colonne sur mobile, 2 sur desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 mt-5">
          <CharacteristicsCard fund={fund} />
          <RisqueCard fund={fund} />
          <EnveloppesCard fund={fund} />
          <ReferencementCard fund={fund} />
          <FeesCard fund={fund} />
          <TrackingDifferenceCard fund={fund} />
          <PerfNetteCard fund={fund} />
          <CompositionCard fund={fund} />
          <SimilarFundsCard isin={fund.isin} />
        </div>

      </div>
    </div>
  );
}
