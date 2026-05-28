import React from "react";
import { dt, productTypeLabel, capitalize, fmtYears } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2.5 text-[12px] text-muted pr-4 align-top">{label}</td>
      <td className="py-2.5 text-[12px] text-ink-2 text-right font-medium">{value}</td>
    </tr>
  );
}

export function CharacteristicsCard({ fund }: { fund: FundDetailHF }) {
  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Caractéristiques</h3>
      <table className="w-full">
        <tbody>
          <Row label="Type" value={productTypeLabel(fund.product_type)} />
          <Row label="Classe d'actif" value={capitalize(fund.asset_class)} />
          <Row label="Catégorie" value={capitalize(fund.category_normalized)} />
          <Row label="Zone géographique" value={capitalize(fund.region_normalized)} />
          <Row label="Devise" value={fund.currency} />
          <Row label="Gestionnaire" value={fund.gestionnaire ?? fund.management_company} />
          <Row label="Création" value={fund.inception_date ? dt(fund.inception_date) : null} />
          <Row label="Ancienneté" value={fmtYears(fund.track_record_years)} />
        </tbody>
      </table>
    </div>
  );
}
