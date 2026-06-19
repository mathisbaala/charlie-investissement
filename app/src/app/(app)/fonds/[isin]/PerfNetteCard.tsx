"use client";

import { useState } from "react";
import { pct, perfNetteClient, CONTRACT_FEE_DEFAULTS, CONTRACT_FEE_LABELS } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";

// Enveloppes proposées, dans l'ordre d'affichage du sélecteur.
const ENVELOPES = ["AV-FR", "AV-LUX", "PER", "PEA", "PEA-PME", "CTO"] as const;

// Choisit l'enveloppe par défaut selon l'éligibilité du fonds (la plus courante
// d'abord). Fallback AV-FR (cas le plus fréquent en distribution CGP).
function defaultEnvelope(fund: FundDetailHF): string {
  if (fund.av_fr_eligible) return "AV-FR";
  if (fund.av_lux_eligible) return "AV-LUX";
  if (fund.per_eligible) return "PER";
  if (fund.pea_eligible) return "PEA";
  if (fund.pea_pme_eligible) return "PEA-PME";
  if (fund.cto_eligible) return "CTO";
  return "AV-FR";
}

function NetRow({ label, gross, fee }: { label: string; gross: number | null; fee: number }) {
  const net = perfNetteClient(gross, fee);
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2.5 text-meta text-muted pr-4">{label}</td>
      <td className="py-2.5 text-meta text-right font-mono text-muted-2">
        {gross == null ? "—" : pct(gross, true)}
      </td>
      <td className={`py-2.5 text-meta text-right font-mono font-medium ${net == null ? "text-muted-2" : net < 0 ? "text-warn" : "text-ink"}`}>
        {net == null ? "—" : pct(net, true)}
      </td>
    </tr>
  );
}

export function PerfNetteCard({ fund }: { fund: FundDetailHF }) {
  const [env, setEnv] = useState<string>(() => defaultEnvelope(fund));

  // Rien à montrer sans aucune performance (on masque, sans le signaler).
  if (fund.performance_1y == null && fund.performance_3y == null && fund.performance_5y == null) {
    return null;
  }

  const fee = CONTRACT_FEE_DEFAULTS[env] ?? 0;
  const retro = fund.retrocession_cgp; // fraction en base (0.005 = 0,5 %)

  return (
    <Card className="px-6 py-5">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-2">
        Performance nette pour le client
      </h3>

      <p className="text-label text-ink-2 leading-snug mb-4">
        La performance affichée est déjà nette des frais du fonds (la VL les
        intègre). On déduit ici les <span className="font-semibold">frais de gestion du contrat</span>{" "}
        selon l&apos;enveloppe, pour estimer ce que perçoit réellement le client.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <label htmlFor="env-select" className="text-label text-muted">Enveloppe</label>
        <select
          id="env-select"
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          className="text-meta border border-line rounded-md px-2 py-1 bg-paper-2 text-ink-2"
        >
          {ENVELOPES.map((e) => (
            <option key={e} value={e}>{CONTRACT_FEE_LABELS[e]}</option>
          ))}
        </select>
        <span className="text-label text-muted-2 font-mono">
          {fee > 0 ? `− ${pct(fee)}/an` : "0 %/an"}
        </span>
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <th className="py-1.5 text-caption uppercase tracking-wider text-muted-2 text-left font-medium"></th>
            <th className="py-1.5 text-caption uppercase tracking-wider text-muted-2 text-right font-medium">Brut fonds</th>
            <th className="py-1.5 text-caption uppercase tracking-wider text-muted-2 text-right font-medium">Net contrat</th>
          </tr>
        </thead>
        <tbody>
          <NetRow label="1 an"            gross={fund.performance_1y} fee={fee} />
          <NetRow label="3 ans (annualisé)" gross={fund.performance_3y} fee={fee} />
          <NetRow label="5 ans (annualisé)" gross={fund.performance_5y} fee={fee} />
        </tbody>
      </table>

      {retro != null && (
        <p className="text-caption text-muted-2 mt-3 leading-snug">
          Rétrocession CGP : {pct(retro * 100)} — incluse dans les frais courants
          du fonds (déjà reflétés par la VL), donc non déduite ici.
        </p>
      )}
      <p className="text-caption text-muted-2 mt-2 leading-snug">
        Frais de gestion du contrat indicatifs ({pct(fee)}/an pour {CONTRACT_FEE_LABELS[env]}).
        Le taux réel dépend du contrat retenu.
      </p>
    </Card>
  );
}
