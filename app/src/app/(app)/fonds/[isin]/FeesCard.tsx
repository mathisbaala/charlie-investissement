import { pct } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";

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
      <td className="py-2.5 text-meta text-muted pr-4">{label}</td>
      <td className={`py-2.5 text-meta text-right font-mono font-medium ${
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
      <Card className="px-6 py-5 flex items-center justify-center text-muted text-meta">
        Frais non renseignés
      </Card>
    );
  }

  const ter = fund.ongoing_charges ?? fund.ter;

  return (
    <Card className="px-6 py-5">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-4">Frais</h3>
      <table className="w-full">
        <tbody>
          {ter != null && (
            <tr className="border-b border-line-soft">
              <td className="py-2.5 text-meta text-muted pr-4">Frais courants (OCF/TER)</td>
              <td className="py-2.5 text-meta text-ink-2 text-right font-mono font-medium">{pct(ter)}</td>
            </tr>
          )}
          <FeeRow label="Frais d'entrée max"        value={fund.entry_fee_max} />
          <FeeRow label="Frais de sortie max"        value={fund.exit_fee_max} />
          <FeeRow label="Commission de surperf."     value={fund.performance_fee} />
          <FeeRow label="Rétrocession CGP"           value={fund.retrocession_cgp} highlight />
          {fund.holding_period_years != null && (
            <tr>
              <td className="py-2.5 text-meta text-muted pr-4">Durée recommandée</td>
              <td className="py-2.5 text-meta text-ink-2 text-right font-mono font-medium">
                {fund.holding_period_years} ans
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
