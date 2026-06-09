import type { FundDetailHF } from "@/lib/types";

export function ReferencementCard({ fund }: { fund: FundDetailHF }) {
  const refs = fund.insurers ?? [];

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">
        Référencement assureur
      </h3>

      {refs.length === 0 ? (
        <p className="text-[12px] text-muted text-center py-4">Aucun référencement renseigné</p>
      ) : (
        <div className="space-y-3">
          {refs.map((r) => {
            // Contrats à montrer (on masque le cas redondant où le seul "contrat"
            // reprend le nom de l'assureur, fréquent côté AV Luxembourg).
            const contracts = r.contracts.filter(
              (c) => c && !(r.contracts.length === 1 && c === r.company),
            );
            return (
              <div key={r.company}>
                <p className="text-[12.5px] font-semibold text-ink">{r.company}</p>
                {contracts.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {contracts.map((c) => (
                      <span
                        key={c}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-paper-2 border border-line-soft text-muted"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-muted-2 mt-4 leading-snug">
        Donnée partielle. L&apos;absence d&apos;un assureur ne signifie pas que le fonds n&apos;y est pas
        référencé.
      </p>
    </div>
  );
}
