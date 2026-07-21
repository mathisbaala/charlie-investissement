"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { ArrowLeft } from "@/components/ui/icons";
import { PageShell } from "@/components/ui/Page";
import { AllocationReport } from "@/components/portfolio/AllocationReport";
import { MarkowitzChart } from "@/components/portfolio/MarkowitzChart";
import { PortfolioExposure } from "@/components/portfolio/PortfolioExposure";
import { PortfolioBacktest } from "@/components/portfolio/PortfolioBacktest";
import { SupportsHistory } from "@/components/portfolio/SupportsHistory";
import { DEFAULT_CONSTRAINTS } from "@/lib/optimizer";
import { GOAL_PRIORITY_LABELS, type ClientGoal } from "@/lib/clientProfile";
import { goalToPlan, requiredAnnualReturn, goalSuccessProbabilityMC } from "@/lib/goalPlanning";
import { hasAnyConvention, loadStoredCabinet } from "@/lib/cabinet";
import { saveLastPortfolio } from "@/lib/lastPortfolio";
import { buildRemuneration } from "@/lib/remuneration";
import { RemunerationSummary } from "@/components/portfolio/RemunerationSummary";
import type { ContractType } from "@/lib/insurer-envelope";
import { usePortfolioStudio, shortName, type PocketStats } from "@/components/portfolio/PortfolioStudioContext";

// ─── Matrice de corrélation des lignes retenues ───────────────────────────────

function corrStyle(c: number | null): React.CSSProperties {
  if (c == null) return { background: "transparent", color: "#B9B7B2" };
  const x = Math.max(-1, Math.min(1, c));
  if (x >= 0) return { background: `oklch(0.62 ${0.15 * x} 40 / ${0.10 + 0.55 * x})`, color: x > 0.6 ? "#fff" : "#3A3A37" };
  const a = -x;
  return { background: `oklch(0.70 ${0.13 * a} 150 / ${0.10 + 0.45 * a})`, color: "#3A3A37" };
}

function CorrelationCard({ names, matrix }: { names: string[]; matrix: (number | null)[][] }) {
  if (names.length < 2) return null;
  return (
    <Card className="px-5 py-5 overflow-x-auto">
      <h2 className="text-label text-ink font-semibold mb-3">Corrélation des supports retenus</h2>
      <table className="border-collapse text-caption tabular-nums">
        <thead>
          <tr>
            <th className="p-1.5" />
            {names.map((n, i) => (
              <th key={i} className="p-1.5 text-muted font-normal text-left whitespace-nowrap" title={n}>
                {shortName(n, 14)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((n, ri) => (
            <tr key={ri}>
              <td className="p-1.5 text-ink-2 whitespace-nowrap pr-3" title={n}>{shortName(n)}</td>
              {matrix[ri]?.map((c, ci) => (
                <td key={ci} className="p-1.5 text-center rounded w-12" style={corrStyle(c)}>
                  {c == null ? "-" : c.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Projets du client : une poche par projet ─────────────────────────────────

function probTone(p: number): { cls: string; label: string } {
  if (p >= 0.75) return { cls: "text-ok", label: "en bonne voie" };
  if (p >= 0.5) return { cls: "text-warn", label: "atteignable, à surveiller" };
  return { cls: "text-danger", label: "compromis en l'état" };
}

const eur = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;

function GoalsCard({
  goals,
  globalMu,
  globalSigma,
  pockets,
  amountEur,
}: {
  goals: ClientGoal[];
  globalMu: number;
  globalSigma: number;
  pockets: Record<string, PocketStats>;
  amountEur: number | null;
}) {
  const rows = useMemo(
    () =>
      goals
        .map((g) => ({ goal: g, plan: goalToPlan(g) }))
        .filter((r) => r.plan !== null)
        .map(({ goal, plan }) => {
          const pocket = pockets[goal.id] ?? null;
          const mu = pocket?.mu ?? globalMu;
          const sigma = pocket?.sigma ?? globalSigma;
          return {
            goal,
            plan: plan!,
            pocket,
            rReq: requiredAnnualReturn(plan!),
            prob: goalSuccessProbabilityMC(plan!, mu, sigma),
            mu,
            sigma,
          };
        }),
    [goals, pockets, globalMu, globalSigma],
  );
  if (rows.length === 0) return null;

  // Cohérence des moyens : la somme des capitaux affectés aux poches ne peut pas
  // dépasser le montant à investir du client.
  const totalAffected = rows.reduce((s, r) => s + r.plan.initial, 0);
  const overAllocated = amountEur != null && totalAffected > amountEur + 0.5;

  return (
    <Card className="px-5 py-5">
      <h2 className="text-label text-ink font-semibold mb-1">Projets du client</h2>
      <p className="text-meta text-muted mb-4">
        Une poche dédiée par projet. Probabilités par simulation Monte Carlo,
        hors frais et fiscalité, performances non garanties.
      </p>
      {overAllocated && (
        <p className="text-meta text-warn mb-3">
          ⚠ Les capitaux affectés aux projets ({eur(totalAffected)}) dépassent le montant à
          investir du client ({eur(amountEur!)}) : revoir la répartition.
        </p>
      )}
      <div className="space-y-3">
        {rows.map(({ goal, plan, pocket, rReq, prob }) => {
          const label = goal.label.trim() || "Projet";
          return (
            <div key={goal.id} className="border-t border-line-soft pt-3 first:border-t-0 first:pt-0 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-meta font-semibold text-ink">{label}</span>
                <span className="text-meta text-muted">
                  {eur(plan.target)} à {plan.years} ans · {GOAL_PRIORITY_LABELS[goal.priority]}
                  {" "}· avec {eur(plan.initial)} affectés
                  {plan.monthly > 0 ? ` + ${eur(plan.monthly)}/mois` : ""}
                </span>
                {rReq === null ? (
                  <span className="text-meta text-danger">
                    Hors de portée avec les moyens affectés. Augmenter l&apos;épargne ou revoir la cible.
                  </span>
                ) : (
                  <>
                    <span className="text-meta text-ink-2">
                      Rendement requis :{" "}
                      <strong>{rReq <= 0 ? "aucun (objectif sécurisé)" : `${(rReq * 100).toFixed(1)} %/an`}</strong>
                    </span>
                    {prob != null && (
                      <span className={`text-meta font-semibold ${probTone(prob).cls}`}>
                        {(prob * 100).toFixed(0)} % de chances, {probTone(prob).label}
                      </span>
                    )}
                  </>
                )}
              </div>
              {pocket && (
                <div className="text-meta text-muted">
                  Poche dédiée : SRI ≤ {pocket.sriCap} · ~{(pocket.mu * 100).toFixed(1)} %/an ·
                  volatilité {(pocket.sigma * 100).toFixed(1)} %
                  {pocket.relaxedFrom != null &&
                    ` (assoupli depuis SRI ≤ ${pocket.relaxedFrom} : pas assez de fonds aussi défensifs dans cet univers)`}
                  {pocket.fallback && " (poche indisponible sur cet univers : portefeuille global utilisé)"}
                </div>
              )}
              {rReq !== null && prob != null && prob < 0.5 && (
                <div className="text-meta text-muted">
                  Leviers : épargner plus, allonger l&apos;horizon, revoir la cible ou accepter plus de risque.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Page dédiée au portefeuille : toutes les métriques ───────────────────────

export function StudioResults() {
  const router = useRouter();
  const {
    presentation, result, pockets, simWeights, setSimWeights,
    corr, summary, amountEur, horizon, lastRemoved, excluded, profile,
    removeFund, includeFund, restoreFund,
    resultCov, effectiveResult, effectivePresentation, projected,
    pdfBusy, pptBusy, downloadPdf, downloadPptx, convention, contract, source,
    errorMsg,
  } = usePortfolioStudio();

  // Accès direct / rechargement sans portefeuille généré → retour aux réglages.
  useEffect(() => {
    if (!result || !presentation) router.replace("/portefeuille/construire");
  }, [result, presentation, router]);

  // Frais du contrat SÉLECTIONNÉ (av_contract_terms) pour un coût client exact,
  // comme le parcours « déposer » : mêmes données, même calcul. Repli indicatif
  // si le contrat n'est pas en base (ou mode démo sans clé "::").
  const [contractTerms, setContractTerms] = useState<{
    fee: number | null; entry: number | null; types: ContractType[] | null;
  }>({ fee: null, entry: null, types: null });
  useEffect(() => {
    if (!contract || !contract.includes("::")) {
      setContractTerms({ fee: null, entry: null, types: null });
      return;
    }
    let alive = true;
    fetch(`/api/contract/terms?key=${encodeURIComponent(contract)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        if (!alive) return;
        setContractTerms(
          t?.found
            ? { fee: t.frais_gestion_uc_pct ?? null, entry: t.frais_entree_pct ?? null, types: (t.types ?? null) as ContractType[] | null }
            : { fee: null, entry: null, types: null },
        );
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [contract]);

  const shownLines = (effectiveResult ?? result)?.lines ?? [];
  // Coût client + rémunération cabinet, MÊME moteur (lib/remuneration) et MÊME
  // rendu (RemunerationSummary) que le parcours « déposer ». Snapshot au montant
  // du projet client ; null tant qu'aucun montant n'est saisi.
  const remu = useMemo(() => {
    if (amountEur == null || amountEur <= 0 || shownLines.length === 0) return null;
    const totalW = shownLines.reduce((s, l) => s + Math.max(0, l.weight), 0) || 1;
    const holdings = shownLines.map((l) => ({
      isin: l.isin,
      name: l.name,
      amount: amountEur * (Math.max(0, l.weight) / totalW),
      terFrac: l.ter ?? null,
      retroFallbackFrac: l.retrocession ?? null,
    }));
    const terKnown = shownLines.filter((l) => l.ter != null);
    const wSum = terKnown.reduce((s, l) => s + Math.max(0, l.weight), 0);
    const terMoyenPct = wSum > 0
      ? (terKnown.reduce((s, l) => s + (l.ter as number) * Math.max(0, l.weight), 0) / wSum) * 100
      : null;
    const cab = loadStoredCabinet();
    return buildRemuneration(holdings, convention, {
      terMoyenPct,
      contractFeePct: contractTerms.fee,
      contractEntryPct: contractTerms.entry,
      contractTypes: contractTerms.types,
      honoraireForfait: cab.honoraireForfait,
      honoraireAnnuel: cab.honoraireAnnuel,
    });
  }, [shownLines, amountEur, convention, contractTerms]);
  const conventionLabel = hasAnyConvention(convention)
    ? (contract.includes("::") ? contract.split("::")[1] : contract)
    : null;

  // Mémorise le portefeuille affiché → importable depuis l'onglet « Frais »
  // (le contexte du studio ne survit pas au changement d'onglet).
  useEffect(() => {
    const lines = (effectiveResult ?? result)?.lines ?? [];
    if (lines.length === 0) return;
    saveLastPortfolio({
      lines: lines.map((l) => ({ isin: l.isin, name: l.name, weight: l.weight })),
      montant: amountEur,
      contract,
    });
  }, [effectiveResult, result, amountEur, contract]);

  if (!presentation || !result) return null;

  const shown = effectiveResult ?? result;

  return (
    <PageShell className="space-y-5">
      <Link
        href="/portefeuille/construire"
        className="inline-flex items-center gap-1 text-meta text-muted hover:text-ink transition-colors w-fit"
      >
        <ArrowLeft size={14} /> Réglages
      </Link>

      {/* Erreur d'un recalcul déclenché depuis cette page (retrait d'un fonds
          rendant l'univers du contrat insuffisant, mode API) : le portefeuille
          précédent reste affiché en dessous. */}
      {errorMsg && (
        <Card className="px-5 py-3">
          <span className="text-meta text-danger">ⓘ {errorMsg}</span>
        </Card>
      )}

      {summary && (
        <Card className="px-5 py-3 bg-paper-2">
          <span className="text-meta text-ink-2">Profil utilisé : {summary}</span>
        </Card>
      )}

      {/* Fonds retiré : suggestion d'un remplaçant similaire */}
      {lastRemoved && (
        <Card className="px-5 py-3 border-clay/40">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-meta text-ink-2">
              <strong>{shortName(lastRemoved.name, 34)}</strong> retiré du portefeuille.
            </span>
            {lastRemoved.similars.length > 0 && (
              <>
                <span className="text-meta text-muted">Remplacer par un fonds similaire :</span>
                {lastRemoved.similars.map((s) => (
                  <button
                    key={s.isin}
                    onClick={() => includeFund(s.isin, s.name)}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-line text-ink-2 bg-paper-2 hover:border-clay hover:text-ink transition-colors"
                    title={s.isin}
                  >
                    + {shortName(s.name, 30)}
                  </button>
                ))}
              </>
            )}
            <button
              className="text-meta text-muted hover:text-ink underline underline-offset-2 ml-auto"
              onClick={() => restoreFund(lastRemoved.isin)}
            >
              Annuler le retrait
            </button>
          </div>
        </Card>
      )}

      {/* Fonds écartés (réintégrables) */}
      {excluded.length > 0 && (
        <Card className="px-5 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-muted mr-1">Fonds écartés :</span>
            {excluded.map((f) => (
              <span key={f.isin} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-line text-muted bg-paper-2">
                {shortName(f.name, 28)}
                <button
                  aria-label={`Réintégrer ${f.name}`}
                  title="Réintégrer ce fonds"
                  onClick={() => restoreFund(f.isin)}
                  className="text-muted hover:text-ok"
                >
                  ↩
                </button>
              </span>
            ))}
          </div>
        </Card>
      )}

      {projected != null && (
        <Card className="px-5 py-4 bg-paper-2">
          <span className="text-meta text-ink-2">
            Projection indicative : {amountEur!.toLocaleString("fr-FR")} € à ~{(shown.expectedReturn * 100).toFixed(1)} %/an
            sur {horizon} ans ≈ <strong>{Math.round(projected).toLocaleString("fr-FR")} €</strong>
            {" "}(hors frais et fiscalité, performances non garanties).
          </span>
        </Card>
      )}

      {/* Coût client & rémunération cabinet — bloc PARTAGÉ avec le parcours
          « déposer » (même moteur, même rendu). Visible dès qu'un montant de
          projet client est saisi ; indépendant du départage rémunération. */}
      {remu && (
        <RemunerationSummary remu={remu} conventionLabel={conventionLabel} />
      )}

      {/* Projets du client : une poche dédiée par projet. */}
      <GoalsCard
        goals={profile.goals}
        globalMu={shown.expectedReturn}
        globalSigma={shown.volatility}
        pockets={pockets}
        amountEur={amountEur}
      />

      {shown.notes.length > 0 && (() => {
        // En mode démo, un fonds imposé « introuvable dans l'univers » vient
        // presque toujours d'une sélection du screener (base réelle) posée sur
        // l'univers d'exemple, qui ne la contient pas. On garde la note factuelle
        // mais on ajoute une consigne : choisir son contrat pour les retrouver.
        const hasUnresolvedImposed =
          source === "demo" &&
          shown.notes.some((n) => n.includes("introuvable dans l'univers"));
        return (
          <Card className="px-5 py-3">
            <ul className="space-y-1">
              {shown.notes.map((n, i) => (
                <li key={i} className="text-meta text-muted">ⓘ {n}</li>
              ))}
            </ul>
            {hasUnresolvedImposed && (
              <p className="text-meta text-ink-2 mt-2">
                Ces fonds proviennent de votre recherche : l’univers d’exemple ne
                les contient pas. Sélectionnez votre contrat dans les réglages
                pour les intégrer au portefeuille.
              </p>
            )}
          </Card>
        );
      })()}

      <div className="flex justify-end gap-2">
        {/* Passe le portefeuille généré au simulateur de frais : lignes (poids
            déjà en %) + montant du projet client. */}
        <Link href={`/simulateur?isins=${shown.lines.map((l) => l.isin).join(",")}&weights=${shown.lines.map((l) => l.weight).join(",")}${amountEur && amountEur > 0 ? `&montant=${amountEur}` : ""}${contract.includes("::") ? `&contract=${encodeURIComponent(contract)}` : ""}`}>
          <Btn variant="outline" size="sm">Simuler les frais</Btn>
        </Link>
        <Btn variant="primary" size="sm" loading={pptBusy} onClick={downloadPptx}>Télécharger (PowerPoint)</Btn>
        <Btn variant="outline" size="sm" loading={pdfBusy} onClick={downloadPdf}>Télécharger (PDF)</Btn>
      </div>

      {resultCov && (
        <MarkowitzChart
          lines={result.lines}
          cov={resultCov}
          riskFree={DEFAULT_CONSTRAINTS.riskFree}
          weights={simWeights}
          onWeightsChange={setSimWeights}
        />
      )}

      {/* Répartitions géo / secteurs de l'allocation courante, recalculées en
          direct quand le conseiller ajuste les poids simulés ci-dessus
          (shown.lines reflète déjà la pondération simulée). */}
      <PortfolioExposure lines={shown.lines} />

      {corr && <CorrelationCard names={corr.names} matrix={corr.matrix} />}

      {/* Back-test historique : réservé aux données réelles du contrat —
          l'univers de démonstration n'a pas de séries de prix. */}
      {source === "api" && (
        <PortfolioBacktest
          holdings={shown.lines.map((l) => ({ isin: l.isin, weight: l.weight }))}
        />
      )}

      {/* Historique PAR SUPPORT (graphe base 100 + tableau par horizon/année) :
          directement visible sous le backtest, mêmes sources de données. */}
      {source === "api" && (
        <SupportsHistory
          holdings={shown.lines.map((l) => ({ isin: l.isin, weight: l.weight }))}
        />
      )}

      <AllocationReport presentation={effectivePresentation ?? presentation} onRemoveLine={removeFund} />
    </PageShell>
  );
}
