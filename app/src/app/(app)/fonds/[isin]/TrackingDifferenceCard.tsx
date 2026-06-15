import { pct } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";

// Un ETF / fonds indiciel : la tracking difference n'a de sens que pour une
// gestion qui réplique un indice (pas pour un fonds actif sans benchmark TR).
export function isIndexTracker(fund: FundDetailHF): boolean {
  if (fund.product_type === "etf") return true;
  const s = (fund.management_style ?? "").toLowerCase();
  return s === "passif" || s === "index" || s === "smart_beta";
}

function TdRow({ label, value }: { label: string; value: number | null }) {
  // Convention : TD négative = l'ETF fait moins bien que son indice (coût implicite).
  // On colore la sous-performance en warn, la (rare) surperformance en ok.
  const color =
    value == null ? "text-muted-2" : value < 0 ? "text-warn" : "text-ok";
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2.5 text-meta text-muted pr-4">{label}</td>
      <td className={`py-2.5 text-meta text-right font-mono font-medium ${color}`}>
        {value == null ? "—" : pct(value, true)}
      </td>
    </tr>
  );
}

const VARIANT_LABEL: Record<string, string> = {
  net: "indice net TR",
  gross: "indice brut TR",
  price: "indice prix (approx.)",
};

export function TrackingDifferenceCard({ fund }: { fund: FundDetailHF }) {
  if (!isIndexTracker(fund)) return null;

  const hasTd =
    fund.tracking_diff_1y != null ||
    fund.tracking_diff_3y != null ||
    fund.tracking_diff_5y != null;

  const variant = fund.benchmark_variant
    ? VARIANT_LABEL[fund.benchmark_variant] ?? fund.benchmark_variant
    : "indice net TR";

  return (
    <Card className="px-6 py-5">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-2">
        Coût réel · Tracking difference
      </h3>

      {/* Le message clé : les frais courants ne disent pas le coût réel d'un ETF. */}
      <p className="text-label text-ink-2 leading-snug mb-4">
        Pour un ETF, les frais courants (TER) ne reflètent pas le coût réel. Ce
        dernier se mesure à la <span className="font-semibold">tracking difference</span> :
        l&apos;écart de performance avec son {variant}, qui intègre frais, fiscalité
        des dividendes et qualité de réplication.
      </p>

      {hasTd ? (
        <>
          {fund.benchmark_index && (
            <p className="text-label text-muted mb-2">
              Indice de référence : <span className="text-ink-2 font-medium">{fund.benchmark_index}</span>
            </p>
          )}
          <table className="w-full">
            <tbody>
              <TdRow label="TD 1 an"            value={fund.tracking_diff_1y} />
              <TdRow label="TD 3 ans (annualisée)" value={fund.tracking_diff_3y} />
              <TdRow label="TD 5 ans (annualisée)" value={fund.tracking_diff_5y} />
            </tbody>
          </table>
          <p className="text-caption text-muted-2 mt-3 leading-snug">
            TD = performance de l&apos;ETF − performance de l&apos;indice. Une valeur
            négative signale une sous-performance (coût implicite) ; une valeur
            légèrement positive, une réplication optimisée (swap, prêt de titres).
            Estimation indicative, calculée vs l&apos;indice {variant} converti dans
            la devise de la part — à confirmer par la donnée officielle de l&apos;émetteur.
          </p>
        </>
      ) : (
        <p className="text-label text-muted-2 italic leading-snug">
          Tracking difference en cours de collecte pour ce support. Comparez la
          performance de l&apos;ETF à celle de son indice net TR avant de conclure
          sur son coût.
        </p>
      )}
    </Card>
  );
}
