import React from "react";
import { pct } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

const nfEur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function FeeRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | null;
  highlight?: boolean;
}) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2.5 text-[12px] text-muted pr-4">{label}</td>
      <td className={`py-2.5 text-[12px] text-right font-mono font-medium ${
        value == null
          ? "text-muted-2"
          : highlight
          ? "text-accent"
          : "text-ink-2"
      }`}>
        {value == null ? "—" : pct(value * 100)}
      </td>
    </tr>
  );
}

export function FeesCard({ fund }: { fund: FundDetailHF }) {
  const hasData =
    fund.ongoing_charges != null ||
    fund.ter != null ||
    fund.entry_fee_max != null ||
    fund.exit_fee_max != null ||
    fund.performance_fee != null ||
    fund.retrocession_cgp != null;

  if (!hasData) {
    return (
      <div className="bg-paper rounded-2xl border border-line px-6 py-5 flex items-center justify-center text-muted text-[12px]">
        Frais non renseignés
      </div>
    );
  }

  const ter = fund.ongoing_charges ?? fund.ter;

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Frais</h3>
      <table className="w-full">
        <tbody>
          {ter != null && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-[12px] text-muted pr-4">Frais courants (OCF/TER)</td>
              <td className="py-2.5 text-[12px] text-ink-2 text-right font-mono font-medium">{pct(ter)}</td>
            </tr>
          )}
          <FeeRow label="Frais d'entrée max"        value={fund.entry_fee_max} />
          <FeeRow label="Frais de sortie max"        value={fund.exit_fee_max} />
          <FeeRow label="Commission de surperf."     value={fund.performance_fee} />
          <FeeRow label="Rétrocession CGP"           value={fund.retrocession_cgp} highlight />
          {fund.holding_period_years != null && (
            <tr>
              <td className="py-2.5 text-[12px] text-muted pr-4">Durée recommandée</td>
              <td className="py-2.5 text-[12px] text-ink-2 text-right font-mono font-medium">
                {fund.holding_period_years} ans
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {fund.retrocession_cgp != null && fund.retrocession_cgp > 0 && (
        <div className="mt-4 pt-3.5 border-t border-dashed border-line-soft">
          <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-2">
            Revenu CGP estimé
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted">Pour 100 000 € investis</span>
            <span className="text-[13px] font-semibold text-accent font-mono">
              {nfEur.format(100_000 * fund.retrocession_cgp)}<span className="text-[10px] font-normal text-muted-2">/an</span>
            </span>
          </div>
          {ter != null && (
            <div className="flex items-center justify-between gap-3 mt-1.5">
              <span className="text-[11px] text-muted">Coût net client (TER − rétro.)</span>
              <span className="text-[12px] font-mono text-ink-2">
                {pct(ter - fund.retrocession_cgp * 100)}
              </span>
            </div>
          )}
        </div>
      )}
      {(fund.entry_fee_max == null || fund.exit_fee_max == null) && (
        <p className="text-[10px] text-muted-2 mt-3 italic">
          * Frais transactionnels extraits des KIDs — incomplets pour certains fonds.
        </p>
      )}
    </div>
  );
}
