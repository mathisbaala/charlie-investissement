"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Star, Download } from "@/components/ui/icons";
import { NavChart } from "@/components/fund/NavChart";
import { SfdrBadge, SriBadge, MorningstarBadge } from "@/components/ui/Badge";
import { Btn } from "@/components/ui/Btn";
import { addFavorite, removeFavorite, isFavorite } from "@/lib/favorites";
import { useToast } from "@/components/ui/Toast";
import type { FundDetailHF } from "@/lib/types";
import { KpiStrip } from "./KpiStrip";
import { CharacteristicsCard } from "./CharacteristicsCard";
import { RisqueCard } from "./RisqueCard";
import { EnveloppesCard } from "./EnveloppesCard";
import { FeesCard } from "./FeesCard";
import { CompositionCard } from "./CompositionCard";
import { SimilarFundsCard } from "./SimilarFundsCard";

interface Props { fund: FundDetailHF; }

export function FundSheetClient({ fund }: Props) {
  const [fav, setFav] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setFav(isFavorite(fund.isin));
  }, [fund.isin]);

  function toggleFav() {
    if (fav) {
      removeFavorite(fund.isin);
      setFav(false);
      toast({ title: "Retiré des favoris", tone: "default" });
    } else {
      addFavorite({
        isin: fund.isin,
        name: fund.name,
        gestionnaire: fund.gestionnaire,
        sfdr_article: fund.sfdr_article,
        risk_score: fund.risk_score,
        performance_3y: fund.performance_3y,
        ongoing_charges: fund.ongoing_charges,
        pea_eligible: fund.pea_eligible,
        pea_pme_eligible: fund.pea_pme_eligible,
        per_eligible: fund.per_eligible,
        av_fr_eligible: fund.av_fr_eligible,
        av_lux_eligible: fund.av_lux_eligible,
        cto_eligible: fund.cto_eligible,
        morningstar_rating: fund.morningstar_rating,
        added_at: new Date().toISOString(),
      });
      setFav(true);
      toast({ title: "Ajouté aux favoris", tone: "ok" });
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-cream">
      <div className="max-w-[1100px] mx-auto px-8 py-8">

        {/* Back link */}
        <Link
          href="/recherche"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted hover:text-ink-2 transition-colors mb-6"
        >
          <ArrowLeft size={12} />
          Retour à la recherche
        </Link>

        {/* Banner */}
        <div className="bg-paper rounded-2xl border border-line px-7 py-6 mb-5">
          <div className="flex items-start gap-6">
            <div className="flex-1 min-w-0">
              {/* Product type chip */}
              {fund.product_type && (
                <span className="inline-block text-[10px] uppercase tracking-widest font-semibold text-muted bg-paper-2 border border-line rounded-full px-2.5 py-0.5 mb-3">
                  {fund.product_type.toUpperCase()}
                </span>
              )}
              {/* Fund name */}
              <h1
                className="text-[28px] leading-[1.2] text-ink font-normal"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {fund.name}
              </h1>
              {/* Gestionnaire + ISIN */}
              <div className="flex items-center gap-3 mt-2 text-[12px] text-muted">
                {fund.gestionnaire && <span>{fund.gestionnaire}</span>}
                <span className="font-mono text-muted-2">{fund.isin}</span>
                {fund.currency && (
                  <span className="bg-paper-2 border border-line rounded px-1.5 py-0.5 text-[10px] font-mono">
                    {fund.currency}
                  </span>
                )}
              </div>
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <SfdrBadge article={fund.sfdr_article} />
                <SriBadge sri={fund.risk_score} />
                <MorningstarBadge rating={fund.morningstar_rating} />
                {fund.labels && fund.labels.slice(0, 3).map(l => {
                  const isNeg = /cost|fee|institutional/i.test(l);
                  return (
                    <span
                      key={l}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                        isNeg
                          ? "bg-warn/10 text-warn border-warn/20"
                          : "bg-ok-soft text-ok border-ok/20"
                      }`}
                    >
                      {l}
                    </span>
                  );
                })}
              </div>
            </div>
            {/* Actions */}
            <div className="flex flex-col gap-2 shrink-0">
              <Btn
                variant={fav ? "accent-soft" : "outline"}
                size="sm"
                onClick={toggleFav}
              >
                <Star size={13} className={fav ? "fill-current" : ""} />
                {fav ? "En favoris" : "Favoris"}
              </Btn>
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
            <div className="mt-4 pt-4 border-t border-line-soft flex items-center gap-6 text-[11px]">
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
        </div>

        {/* KPI strip */}
        <KpiStrip fund={fund} />

        {/* NAV Chart */}
        {fund.nav_history.length > 1 && (
          <div className="bg-paper rounded-2xl border border-line px-7 py-5 mt-5">
            <h2 className="text-[13px] font-semibold text-ink mb-4">Historique de la valeur liquidative</h2>
            <NavChart data={fund.nav_history} />
          </div>
        )}

        {/* 2-col grid of cards */}
        <div className="grid grid-cols-2 gap-5 mt-5">
          <CharacteristicsCard fund={fund} />
          <RisqueCard fund={fund} />
          <EnveloppesCard fund={fund} />
          <FeesCard fund={fund} />
          <CompositionCard fund={fund} />
          <SimilarFundsCard isin={fund.isin} />
        </div>

      </div>
    </div>
  );
}
