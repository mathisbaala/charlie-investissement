import React from "react";
import { dt, productTypeLabel, capitalize, fmtYears, fmtAumShort } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

const STYLE_LABELS: Record<string, string> = {
  actif:      "Gestion active",
  passif:     "Gestion passive (index)",
  smart_beta: "Smart beta",
  alternatif: "Gestion alternative",
};

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2.5 text-[12px] text-muted pr-4 align-top">{label}</td>
      <td className="py-2.5 text-[12px] text-ink-2 text-right font-medium">{value}</td>
    </tr>
  );
}

const LABEL_COLORS: Record<string, string> = {
  ISR: "bg-ok-soft text-ok border-ok/20",
  Greenfin: "bg-ok-soft text-ok border-ok/20",
  "Towards Sustainability": "bg-ok-soft text-ok border-ok/20",
  "FNG Label": "bg-ok-soft text-ok border-ok/20",
};

function LabelsRow({ labels }: { labels: string[] | null }) {
  if (!labels || labels.length === 0) return null;
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2.5 text-[12px] text-muted pr-4 align-top">Labels</td>
      <td className="py-2.5 text-right">
        <div className="flex flex-wrap gap-1 justify-end">
          {labels.map(l => (
            <span
              key={l}
              className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                LABEL_COLORS[l] ?? "bg-paper-2 text-muted border-line"
              }`}
            >
              {l}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

function MorningstarRow({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2.5 text-[12px] text-muted pr-4">Morningstar</td>
      <td className="py-2.5 text-right">
        <span className="text-[14px] text-warn leading-none">
          {"★".repeat(rating)}
          <span className="text-muted-2">{"★".repeat(5 - rating)}</span>
        </span>
      </td>
    </tr>
  );
}

export function CharacteristicsCard({ fund }: { fund: FundDetailHF }) {
  const styleLabel = fund.management_style ? (STYLE_LABELS[fund.management_style] ?? capitalize(fund.management_style)) : null;

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Caractéristiques</h3>
      <table className="w-full">
        <tbody>
          <Row label="Type" value={productTypeLabel(fund.product_type)} />
          <Row label="Style" value={styleLabel} />
          <Row label="Classe d'actif" value={capitalize(fund.asset_class)} />
          <Row label="Catégorie" value={capitalize(fund.category_normalized)} />
          <Row label="Zone géographique" value={capitalize(fund.region_normalized)} />
          <Row label="Devise" value={fund.currency} />
          <Row label="Gestionnaire" value={fund.gestionnaire ?? fund.management_company} />
          <Row label="Encours" value={fmtAumShort(fund.aum_eur)} />
          <Row label="Création" value={fund.inception_date ? dt(fund.inception_date) : null} />
          <Row label="Ancienneté" value={fmtYears(fund.track_record_years)} />
          <MorningstarRow rating={fund.morningstar_rating} />
          <LabelsRow labels={fund.labels} />
        </tbody>
      </table>
    </div>
  );
}
