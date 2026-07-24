import type { FundDetailHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { nf } from "@/lib/format";
import { taxSchemeLabel, taxRegimeLabel, hasIrReduction } from "@/lib/defisc";

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2.5 text-meta text-muted pr-4 align-top">{label}</td>
      <td className="py-2.5 text-meta text-right font-medium text-ink-2">{value}</td>
    </tr>
  );
}

// Avantage fiscal des fonds de défiscalisation (FIP/FCPI/FCPR/FPCI). Ne s'affiche
// que pour un fonds fiscal (tax_scheme renseigné). Le régime (tax_regime_detail)
// distingue la réduction d'IR (FIP/FCPI) de l'exonération de plus-values
// (FCPR / FPCI apport-cession). Le quota d'investissement statutaire est rappelé
// en pied de carte.
export function AvantageFiscalCard({ fund }: { fund: FundDetailHF }) {
  const scheme = fund.tax_scheme;
  if (!scheme) return null;

  const dispositif = taxSchemeLabel(scheme);
  const regime = fund.tax_regime_detail;
  const irReduction = hasIrReduction(regime);

  const reduction =
    irReduction && fund.tax_reduction_rate != null && fund.tax_reduction_rate > 0
      ? `${nf.format(fund.tax_reduction_rate * 100)} %`
      : null;

  const blocage =
    fund.tax_lock_up_years != null ? `${fund.tax_lock_up_years} ans min` : null;

  const millesime = fund.vintage_year != null ? String(fund.vintage_year) : null;

  return (
    <Card className="px-6 py-5 self-start">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-4">
        Avantage fiscal
      </h3>
      <table className="w-full">
        <tbody>
          <Row label="Dispositif" value={dispositif} />
          <Row label="Régime fiscal" value={taxRegimeLabel(regime)} />
          <Row label="Réduction d'IR à la souscription" value={reduction} />
          <Row label="Durée de blocage" value={blocage} />
          <Row label="Millésime" value={millesime} />
        </tbody>
      </table>
      {!irReduction && regime && (
        <p className="text-caption text-muted mt-3">
          Pas de réduction d'IR à l'entrée ; l'avantage porte sur l'exonération
          d'impôt sur les plus-values sous conditions de conservation.
        </p>
      )}
      {fund.investment_quota_note && (
        <p className="text-caption text-muted-2 mt-3">
          <span className="font-medium text-muted">Quota d'investissement&nbsp;:</span>{" "}
          {fund.investment_quota_note}
        </p>
      )}
      <p className="text-caption text-muted-2 mt-3">
        Taux et quotas indicatifs, sous réserve de la loi de finances et du règlement du fonds.
      </p>
    </Card>
  );
}
