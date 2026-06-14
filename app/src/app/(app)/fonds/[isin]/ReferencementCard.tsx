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
            // `contracts` peut être null côté RPC (assureur référencé sans liste
            // de contrats détaillée) → garde obligatoire, sinon .filter crashe
            // la fiche entière (TypeError) au rendu SSR et client.
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
                  <p className="text-[12.5px] font-semibold text-ink">{r.company}</p>
                  {contracts.length > 0 && (
                    <span className="text-[10px] text-muted-2 shrink-0">
                      {contracts.length} contrat{contracts.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {shown.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {shown.map((c) => (
                      <span
                        key={c}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-paper-2 border border-line-soft text-muted"
                      >
                        {c}
                      </span>
                    ))}
                    {extra > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 text-muted-2">+{extra} autres</span>
                    )}
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
