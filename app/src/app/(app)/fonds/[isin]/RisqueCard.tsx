import { pct, fmtSharpe } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

function SriScale({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1 mt-1">
      {[1, 2, 3, 4, 5, 6, 7].map(n => (
        <div
          key={n}
          className={`flex-1 h-2 rounded-sm transition-all ${
            n <= value
              ? n <= 2 ? "bg-ok" : n <= 4 ? "bg-warn/60" : "bg-warn"
              : "bg-paper-3"
          }`}
        />
      ))}
      <span className="ml-2 text-[11px] font-mono text-ink-2">{value}/7</span>
    </div>
  );
}

export function RisqueCard({ fund }: { fund: FundDetailHF }) {
  const sri = fund.risk_score ?? fund.srri;
  const has3yData = (fund.track_record_years ?? 0) >= 3;
  const hasData =
    sri != null ||
    fund.volatility_1y != null ||
    fund.max_drawdown_1y != null ||
    fund.sharpe_1y != null;

  if (!hasData) {
    return (
      <div className="bg-paper rounded-2xl border border-line px-6 py-5 flex items-center justify-center text-muted text-[12px]">
        Données de risque non disponibles
      </div>
    );
  }

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Risque</h3>

      {sri != null && (
        <div className="mb-4">
          <p className="text-[11px] text-muted mb-1">SRI</p>
          <SriScale value={sri} />
        </div>
      )}

      <table className="w-full">
        <tbody>
          {fund.volatility_1y != null && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-[12px] text-muted pr-4">Volatilité 1A</td>
              <td className="py-2.5 text-[12px] text-ink-2 text-right font-mono font-medium">{pct(fund.volatility_1y)}</td>
            </tr>
          )}
          {fund.volatility_3y != null && has3yData && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-[12px] text-muted pr-4">Volatilité 3A</td>
              <td className="py-2.5 text-[12px] text-ink-2 text-right font-mono font-medium">{pct(fund.volatility_3y)}</td>
            </tr>
          )}
          {fund.max_drawdown_1y != null && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-[12px] text-muted pr-4">Max Drawdown 1A</td>
              <td className="py-2.5 text-[12px] text-warn text-right font-mono font-medium">{pct(fund.max_drawdown_1y)}</td>
            </tr>
          )}
          {fund.max_drawdown_3y != null && has3yData && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-[12px] text-muted pr-4">Max Drawdown 3A</td>
              <td className="py-2.5 text-[12px] text-warn text-right font-mono font-medium">{pct(fund.max_drawdown_3y)}</td>
            </tr>
          )}
          {fund.sharpe_1y != null && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-[12px] text-muted pr-4">Sharpe 1A</td>
              <td className="py-2.5 text-[12px] text-ink-2 text-right font-mono font-medium">{fmtSharpe(fund.sharpe_1y)}</td>
            </tr>
          )}
          {fund.sharpe_3y != null && has3yData && (
            <tr>
              <td className="py-2.5 text-[12px] text-muted pr-4">Sharpe 3A</td>
              <td className="py-2.5 text-[12px] text-ink-2 text-right font-mono font-medium">{fmtSharpe(fund.sharpe_3y)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
