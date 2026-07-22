import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { MorningstarBadge } from "@/components/ui/Badge";
import { X } from "@/components/ui/icons";
import type { AllocationPresentation } from "@/lib/allocationRationale";

// Restitution à l'écran d'une proposition d'allocation (miroir du PDF). Purement
// présentationnel : consomme la structure produite par buildPresentation(), aucun
// état ni fetch. La page conteneur gère la sélection de contrat/cibles et le fetch
// de /api/portfolio/optimize.

function fmtPct(n: number | null | undefined): string {
  return n == null ? "-" : `${n.toFixed(1)} %`;
}
function sfdrText(a: number | null | undefined): string {
  return a === 8 ? "Art. 8" : a === 9 ? "Art. 9" : "Art. 6";
}

const CLASS_COLOR: Record<string, string> = {
  Actions: "#8F4A31",
  "Obligations / Crédit": "#9A7B33",
  "Monétaire": "#7C7A76",
  "Allocations flexibles": "#3B3A38",
  "Immobilier (SCPI / SCI)": "#1E7A4F",
  "Crypto-actifs": "#6B4E9A",
  "Fonds Euros": "#2E6B8F",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-lg border border-line-soft bg-paper px-3 py-2.5">
      <div className="text-meta text-muted">{label}</div>
      <div className="text-title text-ink font-semibold">{value}</div>
    </div>
  );
}

export function AllocationReport({
  presentation,
  pdfHref,
  onRemoveLine,
}: {
  presentation: AllocationPresentation;
  pdfHref?: string;
  /** Si fourni : bouton « retirer ce fonds » sur chaque ligne du tableau. */
  onRemoveLine?: (isin: string) => void;
}) {
  const p = presentation;
  const maxSri = Math.max(1, ...p.riskProfile.sriDistribution.map((b) => b.weight));

  return (
    <div className="space-y-5" data-testid="allocation-report">
      {/* En-tête + KPI */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-heading text-ink font-semibold">{p.title}</h2>
          <p className="text-meta text-muted">{p.subtitle}</p>
        </div>
        {pdfHref && (
          <a href={pdfHref} target="_blank" rel="noopener">
            <Btn variant="outline" size="sm">Télécharger la présentation (PDF)</Btn>
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Stat label="Supports" value={String(p.headline.supports)} />
        <Stat label="SRI moyen" value={p.headline.weightedSri == null ? "-" : `${p.headline.weightedSri} / 7`} />
        <Stat label="Perf. cible / an" value={`~${p.headline.expectedReturnPct} %`} />
        <Stat label="Volatilité" value={`~${p.headline.volatilityPct} %`} />
      </div>

      {/* Objectifs */}
      <Card className="px-5 py-4">
        <h3 className="text-label text-ink font-semibold mb-2">Contexte et objectifs</h3>
        <ul className="space-y-1.5">
          {p.objectives.map((o, i) => (
            <li key={i} className="text-meta text-ink-2 flex gap-2">
              <span className="text-clay">•</span>
              <span>{o}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Répartition par classe */}
      <Card className="px-5 py-4">
        <h3 className="text-label text-ink font-semibold mb-3">Répartition par classe d'actifs</h3>
        <div className="space-y-2.5">
          {p.classBreakdown.map((c) => (
            <div key={c.assetClass} className="flex items-center gap-3">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CLASS_COLOR[c.label] ?? "#3B3A38" }} />
              <span className="w-40 shrink-0 text-meta text-ink font-medium">{c.label}</span>
              <span className="w-14 shrink-0 text-meta text-ink font-semibold text-right">{fmtPct(c.weight)}</span>
              <span className="flex-1 text-meta text-muted">{c.role}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Tableau détaillé */}
      <Card className="px-5 py-4 overflow-x-auto">
        <h3 className="text-label text-ink font-semibold mb-3">Portefeuille détaillé</h3>
        <table className="w-full text-meta">
          <thead>
            <tr className="text-muted border-b border-line-soft">
              <th className="text-left font-medium py-1.5 pr-2">#</th>
              <th className="text-left font-medium py-1.5 pr-2">Fonds</th>
              <th className="text-left font-medium py-1.5 pr-2">ISIN</th>
              <th className="text-left font-medium py-1.5 pr-2">Catégorie</th>
              <th className="text-right font-medium py-1.5 pr-2">Poids</th>
              <th className="text-center font-medium py-1.5 pr-2">SRI</th>
              <th className="text-center font-medium py-1.5 pr-2">SFDR</th>
              <th className="text-center font-medium py-1.5 pr-2">Notation</th>
              <th className="text-right font-medium py-1.5">Frais</th>
              {onRemoveLine && <th className="py-1.5" aria-label="Retirer" />}
            </tr>
          </thead>
          <tbody>
            {p.table.map((l, i) => (
              <tr key={l.isin} className="border-b border-line-soft/60">
                <td className="py-1.5 pr-2 text-muted">{i + 1}</td>
                <td className="py-1.5 pr-2">
                  <Link
                    href={`/fonds/${l.isin}`}
                    className="text-ink-2 hover:text-ink hover:underline underline-offset-2 transition-colors"
                    title={`Voir la fiche de ${l.name}`}
                  >
                    {l.name}
                  </Link>
                </td>
                <td className="py-1.5 pr-2 font-mono text-[11px] text-muted">{l.isin}</td>
                <td className="py-1.5 pr-2 text-ink-2">{l.category ?? "-"}</td>
                <td className="py-1.5 pr-2 text-right text-ink font-semibold">{fmtPct(l.weight)}</td>
                <td className="py-1.5 pr-2 text-center text-ink-2">{l.sri ?? "-"}</td>
                <td className="py-1.5 pr-2 text-center text-ink-2">{sfdrText(l.sfdr)}</td>
                <td className="py-1.5 pr-2 text-center whitespace-nowrap"><MorningstarBadge rating={l.rating} /></td>
                <td className="py-1.5 text-right text-ink-2">{l.ter == null ? "-" : `${(l.ter * 100).toFixed(2)} %`}</td>
                {onRemoveLine && (
                  <td className="py-1.5 pl-2 text-right">
                    <button
                      onClick={() => onRemoveLine(l.isin)}
                      aria-label={`Retirer ${l.name} du portefeuille`}
                      title="Retirer ce fonds et réoptimiser"
                      className="text-muted hover:text-danger transition-colors align-middle"
                    >
                      <X size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Profil de risque */}
      <Card className="px-5 py-4">
        <h3 className="text-label text-ink font-semibold mb-1">Profil de risque</h3>
        <p className="text-meta text-muted mb-3">
          SRI moyen pondéré ~{p.riskProfile.weightedSri ?? "-"} / 7 : {p.riskProfile.profileLabel}
        </p>
        <div className="space-y-1.5">
          {p.riskProfile.sriDistribution.map((b) => (
            <div key={b.sri} className="flex items-center gap-2">
              <span className="w-12 text-meta text-muted shrink-0">SRI {b.sri}</span>
              <div className="flex-1 h-2 rounded bg-paper-2 overflow-hidden">
                <div className="h-full rounded" style={{ width: `${(b.weight / maxSri) * 100}%`, backgroundColor: b.sri <= 2 ? "#1E7A4F" : b.sri <= 4 ? "#9A7B33" : "#8F4A31" }} />
              </div>
              <span className="w-12 text-meta text-ink-2 text-right shrink-0">{fmtPct(b.weight)}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {p.riskProfile.sfdrDistribution.map((d) => (
            <span key={String(d.article)} className="text-[11px] px-2 py-0.5 rounded-full border border-line text-ink-2 bg-paper-2">
              Art. {d.article} : {fmtPct(d.weight)}
            </span>
          ))}
        </div>
      </Card>

      {/* Justification par support et convictions : volontairement absentes à
          l'écran (destinées au client, pas au CGP) — elles restent dans le PDF. */}

      {/* Avertissements */}
      <Card className="px-5 py-4 bg-paper-2">
        <h3 className="text-label text-ink font-semibold mb-2">Avertissements</h3>
        <ul className="space-y-1">
          {p.disclaimers.map((d, i) => (
            <li key={i} className="text-[11px] text-muted leading-snug">• {d}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
