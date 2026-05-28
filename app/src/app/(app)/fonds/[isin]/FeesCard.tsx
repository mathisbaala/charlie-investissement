import React from "react";
import { pct } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

export function FeesCard({ fund }: { fund: FundDetailHF }) {
  const hasData = fund.ongoing_charges != null || fund.ter != null;

  if (!hasData) {
    return (
      <div className="bg-paper rounded-2xl border border-line px-6 py-5 flex items-center justify-center text-muted text-[12px]">
        Frais non renseignés
      </div>
    );
  }

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Frais</h3>
      <table className="w-full">
        <tbody>
          {fund.ongoing_charges != null && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-[12px] text-muted pr-4">Frais courants (OCF)</td>
              <td className="py-2.5 text-[12px] text-ink-2 text-right font-mono font-medium">{pct(fund.ongoing_charges)}</td>
            </tr>
          )}
          {fund.ter != null && fund.ter !== fund.ongoing_charges && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-[12px] text-muted pr-4">TER total</td>
              <td className="py-2.5 text-[12px] text-ink-2 text-right font-mono font-medium">{pct(fund.ter)}</td>
            </tr>
          )}
          <tr className="border-b border-line-soft">
            <td className="py-2.5 text-[12px] text-muted pr-4">Frais d&apos;entrée max</td>
            <td className="py-2.5 text-[12px] text-muted-2 text-right font-mono">N/A</td>
          </tr>
          <tr className="border-b border-line-soft">
            <td className="py-2.5 text-[12px] text-muted pr-4">Frais de sortie max</td>
            <td className="py-2.5 text-[12px] text-muted-2 text-right font-mono">N/A</td>
          </tr>
          <tr>
            <td className="py-2.5 text-[12px] text-muted pr-4">Commission de surperf.</td>
            <td className="py-2.5 text-[12px] text-muted-2 text-right font-mono">N/A</td>
          </tr>
        </tbody>
      </table>
      <p className="text-[10px] text-muted-2 mt-3 italic">
        * Frais d&apos;entrée/sortie et commission de surperformance non encore indexés.
      </p>
    </div>
  );
}
