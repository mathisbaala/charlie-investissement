"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Kpi } from "@/components/ui/Kpi";
import type { Remuneration } from "@/lib/remuneration";

// Bloc PARTAGÉ « Coût client & rémunération cabinet » — la même restitution sur
// les deux parcours du portefeuille (construire ET déposer), pilotée par l'unique
// moteur lib/remuneration.buildRemuneration. Un seul rendu, un seul calcul : quel
// que soit le chemin d'entrée, le CGP voit exactement le même résultat.

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const PCT = (v: number, d = 1) => `${v.toFixed(d).replace(".", ",")} %`;

export function RemunerationSummary({
  remu,
  conventionLabel,
  multiContract = false,
}: {
  remu: Remuneration;
  /** Libellé du contrat dont la convention est appliquée (null = estimation de place). */
  conventionLabel: string | null;
  /** Plusieurs contrats distincts reconnus (la convention du 1er est appliquée). */
  multiContract?: boolean;
}) {
  return (
    <section data-testid="remu-section">
      <h2 className="text-title text-ink mb-1">Coût client &amp; rémunération cabinet</h2>
      <p className="text-caption text-muted mb-3">
        {conventionLabel ? (
          <>
            Selon la convention de <strong className="text-ink-2">{conventionLabel}</strong> saisie dans Mon cabinet
            {multiContract && " (plusieurs contrats reconnus — convention du premier appliquée)"}. Non contractuel.
          </>
        ) : (
          <>
            Estimation de place —{" "}
            <Link href="/cabinet" className="underline underline-offset-2 hover:text-ink">
              rattachez ce contrat dans Mon cabinet
            </Link>{" "}
            pour vos vrais taux. Non contractuel.
          </>
        )}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
        <Kpi label="Rému. récurrente" value={`${EUR.format(remu.recurringAnnual)}/an`} />
        <Kpi label="Taux de rétro" value={remu.retroRatePct != null ? PCT(remu.retroRatePct, 2) : "—"} />
        <Kpi label="Coût client (CTD)" value={remu.clientCostPct != null ? `${PCT(remu.clientCostPct, 2)}/an` : "—"} />
        <Kpi label="Part du coût captée" value={remu.captureSharePct != null ? PCT(remu.captureSharePct, 0) : "—"} />
      </div>

      <Card className="p-4 space-y-2">
        <p className="text-meta text-ink-2" data-testid="remu-summary">
          Récurrent : <strong>{EUR.format(remu.recurringAnnual)}/an</strong>{" "}
          ({EUR.format(remu.ucAnnual)} rétrocessions UC + {EUR.format(remu.contractAnnual)} part contrat)
          {remu.entryOnce > 0 && (
            <>, + {EUR.format(remu.entryOnce)} à la souscription (frais d&apos;entrée reversés)</>
          )}
        </p>
        {(remu.honoraireAnnuel > 0 || remu.honoraireForfait > 0) && (
          <p className="text-meta text-ink-2" data-testid="remu-honoraires">
            Honoraires de conseil :{" "}
            {remu.honoraireAnnuel > 0 && <strong>{EUR.format(remu.honoraireAnnuel)}/an</strong>}
            {remu.honoraireForfait > 0 && (
              <>{remu.honoraireAnnuel > 0 ? " + " : ""}<strong>{EUR.format(remu.honoraireForfait)}</strong> (forfait)</>
            )}
            {" "}facturés en sus (hors rétrocession). Revenu cabinet total :{" "}
            <strong>{EUR.format(remu.revenuRecurrentTotal)}/an</strong>
            {remu.revenuPonctuelTotal > 0 && <> + {EUR.format(remu.revenuPonctuelTotal)} ponctuel</>}.
          </p>
        )}
        {remu.clientCostAnnual != null && (
          <p className="text-caption text-muted">
            Coût client ~{EUR.format(remu.clientCostAnnual)}/an
            {" "}({PCT(remu.supportsPct ?? 0, 2)} frais fonds + {PCT(remu.contractPct, 2)} frais contrat
            {remu.contractSourced ? "" : " indicatif"})
            {remu.clientEntryOnce != null && remu.clientEntryOnce > 0 && (
              <> · + {EUR.format(remu.clientEntryOnce)} de frais d&apos;entrée du contrat ({PCT(remu.clientEntryPct ?? 0, 2)}) à la souscription</>
            )}
            {remu.captureSharePct != null && <> · vous en captez {PCT(remu.captureSharePct, 0)}</>}.
          </p>
        )}
        {remu.unknownRetroLines > 0 && (
          <p className="text-caption text-muted-2">
            {remu.unknownRetroLines} ligne{remu.unknownRetroLines > 1 ? "s" : ""} sans donnée de rétrocession.
          </p>
        )}

        {remu.lines.some((l) => l.retroFrac != null) && (
          <div className="overflow-x-auto pt-1">
            <table className="w-full text-caption">
              <thead>
                <tr className="text-left text-muted border-b border-line-soft">
                  <th className="py-1.5 pr-3 font-medium">Support</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Montant</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Rétro.</th>
                  <th className="py-1.5 font-medium text-right">Rému./an</th>
                </tr>
              </thead>
              <tbody>
                {remu.lines.map((l) => (
                  <tr key={l.isin} className="border-b border-line-soft/60">
                    <td className="py-1.5 pr-3 text-ink truncate max-w-[16rem]" title={l.name}>{l.name}</td>
                    <td className="py-1.5 pr-3 text-right text-muted">{EUR.format(l.amount)}</td>
                    <td className="py-1.5 pr-3 text-right text-muted">
                      {l.retroFrac != null ? (
                        <>
                          {PCT(l.retroFrac * 100, 2)}
                          {!l.sourced && <span className="text-muted-2"> ~</span>}
                        </>
                      ) : "—"}
                    </td>
                    <td className="py-1.5 text-right text-ink-2">
                      {l.retroAnnual > 0 ? `${EUR.format(l.retroAnnual)}/an` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-caption text-muted-2 mt-1.5">
              « ~ » = estimation de place (taux non fixé par votre convention).
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}
