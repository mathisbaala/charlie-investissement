import type { FundDetailHF } from "@/lib/types";

function EnvRow({
  label,
  eligible,
}: {
  label: string;
  eligible: boolean | null;
}) {
  if (eligible == null) return null;
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${eligible ? "bg-ok-soft/60" : "bg-paper-2"}`}>
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center text-label shrink-0 ${
          eligible ? "bg-ok text-paper" : "bg-paper-3 text-muted"
        }`}
      >
        {eligible ? "✓" : "×"}
      </div>
      <p className={`text-meta font-semibold ${eligible ? "text-ok" : "text-muted"}`}>{label}</p>
    </div>
  );
}

export function EnveloppesCard({ fund }: { fund: FundDetailHF }) {
  const allNull =
    fund.pea_eligible == null &&
    fund.per_eligible == null &&
    fund.av_lux_eligible == null &&
    fund.av_fr_eligible == null &&
    fund.pea_pme_eligible == null &&
    fund.cto_eligible == null;

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-4">Éligibilités</h3>
      {allNull ? (
        <p className="text-meta text-muted text-center py-4">Éligibilités non renseignées</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <EnvRow label="PEA"           eligible={fund.pea_eligible} />
          <EnvRow label="PEA-PME"       eligible={fund.pea_pme_eligible} />
          <EnvRow label="PER"           eligible={fund.per_eligible} />
          <EnvRow label="CTO"           eligible={fund.cto_eligible} />
          <EnvRow label="AV France"     eligible={fund.av_fr_eligible} />
          <EnvRow label="AV Luxembourg" eligible={fund.av_lux_eligible} />
        </div>
      )}
    </div>
  );
}
