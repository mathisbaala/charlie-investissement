import Link from "next/link";
import type { FundDetailHF, FundContractTerms } from "@/lib/types";
import { Card } from "@/components/ui/Card";

// Frais contrat en pourcentage direct (0.65 = 0,65 %) → format 2 décimales, sans ×100.
function fmtPct(v: number | null | undefined): string | null {
  if (v == null) return null;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v) + " %";
}

export function ReferencementCard({ fund }: { fund: FundDetailHF }) {
  const refs = fund.insurers ?? [];
  const terms = fund.contract_terms ?? [];
  const termsByKey = new Map<string, FundContractTerms>(terms.map((t) => [t.key, t]));

  // Fourchette de frais de gestion d'enveloppe sur tous les contrats sourcés du
  // fonds : donne au CGP le coût annuel « selon le contrat » d'un coup d'œil.
  const gestion = terms
    .map((t) => t.frais_gestion_uc_pct)
    .filter((v): v is number => v != null);
  const gMin = gestion.length ? Math.min(...gestion) : null;
  const gMax = gestion.length ? Math.max(...gestion) : null;

  return (
    <Card className="px-6 py-5 self-start">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-4">
        Référencement partenaire
      </h3>

      {refs.length === 0 ? (
        <p className="text-meta text-muted text-center py-4">Aucun référencement renseigné</p>
      ) : (
        <>
          {gMin != null && (
            <div className="flex items-baseline justify-between gap-2 mb-4 pb-3 border-b border-line-soft">
              <span className="text-meta text-muted">Frais de gestion d'enveloppe</span>
              <span className="text-meta font-mono font-medium text-ink-2">
                {gMin === gMax ? fmtPct(gMin) : `${fmtPct(gMin)} – ${fmtPct(gMax)}/an`}
              </span>
            </div>
          )}

          <div className="space-y-3">
            {refs.map((r) => {
              // Contrats à montrer (on masque le cas redondant où le seul "contrat"
              // reprend le nom de l'assureur, fréquent côté AV Luxembourg).
              // `contracts` peut être null côté RPC → garde obligatoire.
              const all = r.contracts ?? [];
              const contracts = all.filter(
                (c) => c && !(all.length === 1 && c === r.company),
              );
              const MAX = 6;
              const shown = contracts.slice(0, MAX);
              const extra = contracts.length - shown.length;
              return (
                <div key={r.company}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-meta font-semibold text-ink">{r.company}</p>
                    {contracts.length > 0 && (
                      <span className="text-caption text-muted-2 shrink-0">
                        {contracts.length} contrat{contracts.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {shown.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {shown.map((c) => {
                        const t = termsByKey.get(`${r.company}::${c}`);
                        const fee = fmtPct(t?.frais_gestion_uc_pct);
                        return (
                          <Link
                            key={c}
                            href={`/partenaires/contrat?key=${encodeURIComponent(`${r.company}::${c}`)}`}
                            className="group flex items-baseline justify-between gap-2 rounded px-1.5 py-1 -mx-1.5 hover:bg-paper-2 transition-colors"
                          >
                            <span className="text-caption text-muted group-hover:text-ink-2 truncate">
                              {c}
                            </span>
                            {fee && (
                              <span className="text-caption font-mono text-muted-2 shrink-0">
                                {fee}/an
                              </span>
                            )}
                          </Link>
                        );
                      })}
                      {extra > 0 && (
                        <span className="text-caption px-1.5 text-muted-2">+{extra} autres contrats</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
