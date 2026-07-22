import { pct } from "@/lib/format";
import { sfdrInfo, officialLabelsOf, exclusionEntries } from "@/lib/sustainability";
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
  const { excluded, notExcluded } = exclusionEntries(fund.esg_exclusions);
  const hasExclusions = excluded.length > 0 || notExcluded.length > 0;

  // Aucun signal de durabilité → on masque (jamais de mention de donnée absente).
  if (!sfdr && labels.length === 0 && !hasExclusions) return null;

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

      {hasExclusions && (
        <div className="mb-4">
          <p className="text-label text-muted mb-1.5">
            Politique d'exclusion déclarée
            {fund.esg_exclusions_updated_at && (
              <span className="font-normal"> · EET {fund.esg_exclusions_updated_at.slice(0, 7)}</span>
            )}
          </p>
          {excluded.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-1.5 mb-1.5">
              <span className="text-caption text-ok font-semibold">Exclut</span>
              {excluded.map((e) => (
                <span
                  key={e.key}
                  className="text-caption px-2 py-0.5 rounded-full font-medium border bg-ok-soft text-ok border-ok/20"
                >
                  {e.label}
                </span>
              ))}
            </div>
          )}
          {notExcluded.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-caption text-muted font-semibold">N'exclut pas</span>
              {notExcluded.map((e) => (
                <span
                  key={e.key}
                  className="text-caption px-2 py-0.5 rounded-full font-medium border bg-paper-2 text-muted border-line"
                >
                  {e.label}
                </span>
              ))}
            </div>
          )}
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
