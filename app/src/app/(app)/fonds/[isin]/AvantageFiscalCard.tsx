import type { FundDetailHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { nf } from "@/lib/format";

// Libellés des dispositifs de défiscalisation (colonne tax_scheme).
const SCHEME_LABELS: Record<string, string> = {
  fip:          "FIP",
  fip_corse:    "FIP Corse",
  fip_outremer: "FIP Outre-mer",
  fcpi:         "FCPI",
  fcpr:         "FCPR",
};

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2.5 text-meta text-muted pr-4 align-top">{label}</td>
      <td className="py-2.5 text-meta text-right font-medium text-ink-2">{value}</td>
    </tr>
  );
}

// Avantage fiscal des fonds de défiscalisation (FIP/FCPI/FCPR). Ne s'affiche que
// pour un fonds fiscal (tax_scheme renseigné). FCPR : pas de réduction d'IR à la
// souscription — l'avantage porte sur l'exonération des plus-values sous conditions.
export function AvantageFiscalCard({ fund }: { fund: FundDetailHF }) {
  const scheme = fund.tax_scheme;
  if (!scheme) return null;

  const dispositif = SCHEME_LABELS[scheme.toLowerCase()] ?? scheme.toUpperCase();
  const isFcpr = scheme.toLowerCase() === "fcpr";

  const reduction =
    !isFcpr && fund.tax_reduction_rate != null && fund.tax_reduction_rate > 0
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
          <Row label="Réduction d'IR à la souscription" value={reduction} />
          <Row label="Durée de blocage" value={blocage} />
          <Row label="Millésime" value={millesime} />
        </tbody>
      </table>
      {isFcpr && (
        <p className="text-caption text-muted mt-3">
          Pas de réduction d'IR à l'entrée ; exonération d'impôt sur les plus-values sous conditions de conservation.
        </p>
      )}
      <p className="text-caption text-muted-2 mt-3">
        Taux indicatif, sous réserve de la loi de finances.
      </p>
    </Card>
  );
}
