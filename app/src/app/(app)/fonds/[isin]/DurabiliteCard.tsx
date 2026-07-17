import { pct } from "@/lib/format";
import { sfdrInfo, officialLabelsOf } from "@/lib/sustainability";
import type { FundDetailHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2.5 text-meta text-muted pr-4">{label}</td>
      <td className="py-2.5 text-meta text-right font-mono font-medium text-ink-2">{value}</td>
    </tr>
  );
}

// Durabilité exploitable pour le recueil DDA : classification SFDR + labels
// officiels, et les 3 catégories MiFID (taxonomie / investissement durable /
// PAI) quand elles sont renseignées. Aide à documenter le devoir de conseil.
export function DurabiliteCard({ fund }: { fund: FundDetailHF }) {
  const sfdr = sfdrInfo(fund.sfdr_article);
  const labels = officialLabelsOf(fund.labels);

  // Aucun signal de durabilité → on masque (jamais de mention de donnée absente).
  if (!sfdr && labels.length === 0) return null;

  const hasMifid =
    fund.taxonomy_alignment_pct != null ||
    fund.sustainable_investment_pct != null ||
    fund.pai_considered != null;

  return (
    <Card className="px-6 py-5 self-start">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-4">
        Durabilité · recueil DDA
      </h3>

      {sfdr && (
        <div className={labels.length > 0 || hasMifid ? "mb-4" : ""}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-caption px-2 py-0.5 rounded-full font-semibold border bg-ok-soft text-ok border-ok/20">
              SFDR {sfdr.tag}
            </span>
            <span className="text-meta text-ink-2 font-medium">{sfdr.title}</span>
          </div>
        </div>
      )}

      {labels.length > 0 && (
        <div className="mb-4">
          <p className="text-label text-muted mb-1.5">Labels officiels</p>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => (
              <span
                key={l.key}
                className="text-caption px-2 py-0.5 rounded-full font-medium border bg-paper-2 text-ink-2 border-line"
              >
                {l.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasMifid && (
        <table className="w-full">
          <tbody>
            {fund.taxonomy_alignment_pct != null && (
              <Row label="Aligné taxonomie UE" value={pct(fund.taxonomy_alignment_pct)} />
            )}
            {fund.sustainable_investment_pct != null && (
              <Row label="Investissement durable (SFDR)" value={pct(fund.sustainable_investment_pct)} />
            )}
            {fund.pai_considered != null && (
              <Row label="Prise en compte des PAI" value={fund.pai_considered ? "Oui" : "Non"} />
            )}
          </tbody>
        </table>
      )}
    </Card>
  );
}
