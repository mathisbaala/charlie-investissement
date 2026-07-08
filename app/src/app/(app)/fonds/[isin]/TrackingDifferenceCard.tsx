import { pct } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";

// Un ETF / fonds indiciel : la comparaison est un ÉCART DE RÉPLICATION (coût
// réel) plutôt qu'un alpha de gestion. Sert à choisir le bon vocabulaire.
function isIndexTracker(fund: FundDetailHF): boolean {
  if (fund.product_type === "etf") return true;
  const s = (fund.management_style ?? "").toLowerCase();
  return s === "passif" || s === "index" || s === "smart_beta";
}

function AlphaRow({ label, value }: { label: string; value: number | null }) {
  // alpha > 0 = surperformance vs indice (ok) ; < 0 = sous-performance (warn).
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
  // alpha_* est la mesure généralisée ; tracking_diff_* reste lu en repli pour
  // les ETF pas encore recalculés par l'enricher (legacy, même grandeur).
  const a1 = fund.alpha_1y ?? fund.tracking_diff_1y;
  const a3 = fund.alpha_3y ?? fund.tracking_diff_3y;
  const a5 = fund.alpha_5y ?? fund.tracking_diff_5y;
  const hasData = a1 != null || a3 != null || a5 != null;

  // Aucun benchmark / aucune donnée → on masque la carte (jamais de mention de
  // donnée manquante). Rien à dire de pertinent au CGP dans ce cas.
  if (!fund.benchmark_index || !hasData) return null;

  const passive = isIndexTracker(fund) && fund.benchmark_is_category !== true;
  const variant = fund.benchmark_variant
    ? VARIANT_LABEL[fund.benchmark_variant] ?? fund.benchmark_variant
    : "indice net TR";

  const title = passive ? "Coût réel · écart de réplication" : "Alpha · performance vs indice";

  return (
    <Card className="px-6 py-5">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-2">
        {title}
      </h3>

      <p className="text-label text-ink-2 leading-snug mb-4">
        {passive ? (
          <>
            Pour un ETF, les frais courants (TER) ne reflètent pas le coût réel. Ce
            dernier se mesure à l&apos;<span className="font-semibold">écart de réplication</span> :
            la performance face à son {variant}, qui intègre frais, fiscalité des
            dividendes et qualité de réplication.
          </>
        ) : (
          <>
            L&apos;<span className="font-semibold">alpha</span> mesure la performance
            du fonds, nette de frais, au-delà de son indice de référence. Positif, la
            gestion crée de la valeur face au marché ; négatif, elle en détruit.
          </>
        )}
      </p>

      <p className="text-label text-muted mb-2">
        Indice de référence : <span className="text-ink-2 font-medium">{fund.benchmark_index}</span>
        {fund.benchmark_is_category && (
          <span className="ml-2 text-caption px-2 py-0.5 rounded-full font-medium border bg-paper-2 text-muted border-line">
            indice de catégorie
          </span>
        )}
      </p>

      <table className="w-full">
        <tbody>
          <AlphaRow label={passive ? "1 an" : "Alpha 1 an"} value={a1} />
          <AlphaRow label={passive ? "3 ans (annualisé)" : "Alpha 3 ans (annualisé)"} value={a3} />
          <AlphaRow label={passive ? "5 ans (annualisé)" : "Alpha 5 ans (annualisé)"} value={a5} />
        </tbody>
      </table>

      {fund.benchmark_perf_3y != null && (
        <p className="text-caption text-muted-2 mt-3 leading-snug">
          {variant.charAt(0).toUpperCase() + variant.slice(1)} sur 3 ans : {pct(fund.benchmark_perf_3y, true)}/an.
        </p>
      )}
      <p className="text-caption text-muted-2 mt-2 leading-snug">
        {passive
          ? <>Écart = performance de l&apos;ETF − performance de l&apos;indice. Estimation indicative, vs l&apos;{variant} converti dans la devise de la part. À confirmer par la donnée officielle de l&apos;émetteur.</>
          : <>Alpha = performance du fonds − performance de l&apos;indice, sur fenêtres alignées. {fund.benchmark_is_category && "Indice de catégorie (proxy), pas l'indice exact du fonds. "}Estimation indicative.</>}
      </p>
    </Card>
  );
}
