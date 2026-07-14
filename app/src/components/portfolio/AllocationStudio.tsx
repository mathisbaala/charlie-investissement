"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { X, ChevronDown, ChevronRight } from "@/components/ui/icons";
import { PageShell } from "@/components/ui/Page";
import { ClientProfileForm } from "@/components/profile/ClientProfileForm";
import { AllocationReport } from "@/components/portfolio/AllocationReport";
import { MarkowitzChart } from "@/components/portfolio/MarkowitzChart";
import { PortfolioBacktest } from "@/components/portfolio/PortfolioBacktest";
import { FundAdder } from "@/components/portfolio/FundAdder";
import { covarianceMatrix, classCorrelation } from "@/lib/correlation";
import {
  COMMISSION_TIE_BREAK_TOL,
  DEFAULT_CONSTRAINTS,
  optimizeAllocation,
  reweightAllocation,
  type AllocationMethod,
  type AllocationResult,
} from "@/lib/optimizer";
import { buildPresentation, profileFromSri, type AllocationPresentation } from "@/lib/allocationRationale";
import { profileToConstraints, filterUniverse, GEO_TO_REGIONS } from "@/lib/profileToConstraints";
import { SAMPLE_UNIVERSE, sampleCorrelation, SAMPLE_CONTRACT } from "@/lib/sampleUniverse";
import {
  loadStoredProfile,
  EMPTY_PROFILE,
  GOAL_PRIORITY_LABELS,
  type RichClientProfile,
  type ClientGoal,
} from "@/lib/clientProfile";
import {
  goalToPlan,
  requiredAnnualReturn,
  goalSuccessProbabilityMC,
  pocketSriCap,
} from "@/lib/goalPlanning";
import {
  EMPTY_CABINET,
  loadStoredCabinet,
  cabinetContract,
  resolveFundRetrocession,
  type CabinetSettings,
} from "@/lib/cabinet";

// Plateforme d'allocation : réutilise le PROFIL CLIENT saisi à l'accueil (même
// formulaire, mêmes données, partagées via le stockage local) → génère
// automatiquement l'allocation optimisée + la présentation. Pas de re saisie.
// Branchée sur /api/portfolio/optimize (fonds réels du contrat) ; si la base
// n'est pas joignable (dev local sans secrets), repli sur l'univers d'exemple.
// Interactif : chaque changement (profil, SRI, zones, exclusions, ajouts)
// relance l'optimisation automatiquement après la première génération.

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const RISK_LABEL: Record<string, string> = {
  prudent: "Prudent", modere: "Modéré", equilibre: "Équilibré",
  dynamique: "Dynamique", offensif: "Offensif",
};
const ESG_LABEL: Record<string, string> = {
  indifferent: "Indifférent", art8: "Art. 8+", art9: "Art. 9", labelise: "Labellisé",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-meta text-muted">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "border border-line rounded-lg px-3 py-2 text-meta text-ink bg-paper focus:outline-none focus:border-clay";

function profileSummary(p: RichClientProfile, dropped: number): string {
  const bits: string[] = [];
  bits.push(`Profil ${RISK_LABEL[p.risk_profile ?? "equilibre"] ?? "Équilibré"}`);
  if (p.asset_classes.length) bits.push(`classes : ${p.asset_classes.join(", ")}`);
  if (p.geographies.length) bits.push(`zones : ${p.geographies.join(", ")}`);
  if (p.esg && p.esg !== "indifferent") bits.push(`ESG ${ESG_LABEL[p.esg]}`);
  if (p.max_ter != null) bits.push(`frais max ${p.max_ter} %`);
  if (p.perte_max && p.perte_max !== "illimitee") bits.push(`perte max ${p.perte_max} %`);
  if (dropped > 0) bits.push(`${dropped} fonds écartés par les filtres`);
  return bits.join("  ·  ");
}

// ─── Matrice de corrélation des lignes retenues ───────────────────────────────

function corrStyle(c: number | null): React.CSSProperties {
  if (c == null) return { background: "transparent", color: "#B9B7B2" };
  const x = Math.max(-1, Math.min(1, c));
  if (x >= 0) return { background: `oklch(0.62 ${0.15 * x} 40 / ${0.10 + 0.55 * x})`, color: x > 0.6 ? "#fff" : "#3A3A37" };
  const a = -x;
  return { background: `oklch(0.70 ${0.13 * a} 150 / ${0.10 + 0.45 * a})`, color: "#3A3A37" };
}

function shortName(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
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
                  {c == null ? "—" : c.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Projets du client : une POCHE par projet ─────────────────────────────────
// Chaque projet est évalué avec SES moyens (capital affecté + épargne mensuelle,
// jamais mis en commun avec les autres projets) et SA poche : une allocation
// dédiée, calibrée sur son horizon et sa priorité (plafond SRI de poche).
// Probabilité par simulation Monte Carlo (2 000 trajectoires mensuelles).

/** Poche d'un projet : plafond SRI + profil (μ, σ) de l'allocation dédiée. */
export interface PocketStats {
  sriCap: number;
  mu: number;
  sigma: number;
  /** true = la poche n'a pas pu être calculée (repli sur le portefeuille global). */
  fallback: boolean;
  /** Plafond initial quand il a dû être assoupli faute de fonds assez défensifs. */
  relaxedFrom?: number;
}

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
      <h2 className="text-label text-ink font-semibold mb-1">Projets du client — une poche par projet</h2>
      <p className="text-meta text-muted mb-4">
        Chaque projet est évalué avec ses seuls moyens (capital affecté + épargne mensuelle)
        et une poche dédiée, calibrée sur son horizon et sa priorité. Les moyens d&apos;un projet
        ne financent jamais un autre. Probabilités par simulation Monte Carlo
        (2 000 trajectoires) — hors frais et fiscalité, performances non garanties.
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
                    Hors de portée avec les moyens affectés — augmenter l&apos;épargne ou revoir la cible.
                  </span>
                ) : (
                  <>
                    <span className="text-meta text-ink-2">
                      Rendement requis :{" "}
                      <strong>{rReq <= 0 ? "aucun (objectif sécurisé)" : `${(rReq * 100).toFixed(1)} %/an`}</strong>
                    </span>
                    {prob != null && (
                      <span className={`text-meta font-semibold ${probTone(prob).cls}`}>
                        {(prob * 100).toFixed(0)} % de chances — {probTone(prob).label}
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

// Poche démo : ré-optimise l'univers d'exemple sous le plafond SRI de la poche.
// Renvoie le profil (μ, σ) de l'allocation dédiée, ou null si l'univers restant
// est trop pauvre (le conteneur replie alors sur le portefeuille global).
function demoPocketStats(
  p: RichClientProfile,
  pocketCap: number,
  method: AllocationMethod,
  maxAssetsN: number,
  maxPerFundN: number,
  excludedIsins: string[],
): { mu: number; sigma: number } | null {
  const base = profileToConstraints(p);
  let funds = filterUniverse(SAMPLE_UNIVERSE, {
    maxTer: p.max_ter,
    esg: p.esg,
    geographies: p.geographies,
    sriMax: pocketCap,
    exclude: excludedIsins,
  }).funds;
  if (funds.length < 4) {
    // Préférences trop restrictives pour cette poche : on ne garde que le
    // plafond SRI (contrainte de la poche) et les exclusions manuelles.
    funds = filterUniverse(SAMPLE_UNIVERSE, { sriMax: pocketCap, exclude: excludedIsins }).funds;
  }
  if (funds.length < 2) return null;
  const res = optimizeAllocation(funds, sampleCorrelation, {
    ...base,
    maxWeightedSri: pocketCap,
    minAssets: Math.min(4, funds.length),
    maxAssets: maxAssetsN,
    maxWeightPerFund: maxPerFundN,
    method,
  });
  if (res.lines.length === 0) return null;
  return { mu: res.expectedReturn, sigma: res.volatility };
}

// ─── Studio ───────────────────────────────────────────────────────────────────

interface SimilarSuggestion {
  isin: string;
  name: string;
}

interface RemovedInfo {
  isin: string;
  name: string;
  similars: SimilarSuggestion[];
}

type OptimizeApiResponse = {
  allocation: AllocationResult;
  presentation: AllocationPresentation;
  correlations?: { isins: string[]; names: string[]; matrix: (number | null)[][] };
  meta?: { droppedByPreferences?: number; universe?: number };
};

export function AllocationStudio() {
  const [maxPerFund, setMaxPerFund] = useState("25");
  const [maxAssets, setMaxAssets] = useState("7");
  const [advisor, setAdvisor] = useState("");
  const [contract, setContract] = useState(SAMPLE_CONTRACT);
  // Méthode de pondération : max-Sharpe (compromis rendement/risque) ou HRP
  // (budgets de risque hiérarchiques — robuste quand les données sont bruitées).
  const [method, setMethod] = useState<AllocationMethod>("sharpe");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Départage rémunération cabinet : à adéquation client équivalente, préférer
  // le fonds à la meilleure rétrocession (estimée). Choix du CONSEILLER.
  const [retroTilt, setRetroTilt] = useState(false);

  // Données CABINET (onglet « Mon cabinet », localStorage) : contrats distribués
  // → sélecteur de contrat direct ; conventions → rémunération sur vrais taux ;
  // nom du cabinet → pré-rempli.
  const [cabinet, setCabinet] = useState<CabinetSettings>(EMPTY_CABINET);
  useEffect(() => {
    const cab = loadStoredCabinet();
    setCabinet(cab);
    if (cab.cabinetName.trim()) setAdvisor((a) => (a.trim() ? a : cab.cabinetName));
    if (cab.contracts.length > 0) setContract((c) => (c === SAMPLE_CONTRACT ? cab.contracts[0].key : c));
  }, []);
  const convention = useMemo(() => cabinetContract(cabinet, contract), [cabinet, contract]);

  // Profil client synchronisé avec le formulaire (persisté en localStorage).
  const [profile, setProfile] = useState<RichClientProfile>(EMPTY_PROFILE);
  const onProfileChange = useCallback((p: RichClientProfile) => setProfile(p), []);

  // Plafond de SRI ajustable par le conseiller (null = déduit du profil).
  const [sriOverride, setSriOverride] = useState<number | null>(null);
  // Fonds écartés à la main + fonds imposés (ajoutés au départ ou en remplacement).
  const [excluded, setExcluded] = useState<SimilarSuggestion[]>([]);
  const [included, setIncluded] = useState<SimilarSuggestion[]>([]);
  const [lastRemoved, setLastRemoved] = useState<RemovedInfo | null>(null);

  const [presentation, setPresentation] = useState<AllocationPresentation | null>(null);
  const [result, setResult] = useState<AllocationResult | null>(null);
  // Poches par projet (goal.id → plafond SRI + μ/σ de l'allocation dédiée).
  const [pockets, setPockets] = useState<Record<string, PocketStats>>({});
  // Poids simulés par le conseiller (curseurs du plan de Markowitz), en
  // pourcentages ; null = allocation optimale intacte. Remontés ici pour que
  // TOUT le rapport (profil de risque, répartition SRI, projection, projets,
  // exports) suive les curseurs, pas seulement le graphique.
  const [simWeights, setSimWeights] = useState<number[] | null>(null);
  // Options de restitution du dernier calcul (nécessaires pour reconstruire la
  // présentation quand les poids simulés changent).
  const [presOpts, setPresOpts] = useState<Parameters<typeof buildPresentation>[1] | null>(null);
  const [corr, setCorr] = useState<{ names: string[]; matrix: (number | null)[][] } | null>(null);
  const [source, setSource] = useState<"api" | "demo" | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [amountEur, setAmountEur] = useState<number | null>(null);
  const [horizon, setHorizon] = useState<number>(8);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pptBusy, setPptBusy] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Plafond SRI dérivé du profil (tolérance + perte max), pour l'affichage.
  const profileSriCap = useMemo(
    () => profileToConstraints(profile).maxWeightedSri ?? 7,
    [profile],
  );
  const effectiveSri = sriOverride ?? profileSriCap;

  // Chaque calcul est numéroté : une réponse obsolète (recalcul déclenché entre
  // temps) est ignorée au lieu d'écraser la plus récente.
  const runIdRef = useRef(0);
  // Signature des entrées du dernier calcul lancé : le recalcul automatique ne
  // se déclenche que si quelque chose a réellement changé depuis.
  const lastSigRef = useRef<string | null>(null);
  const inputsSig = useMemo(
    () => JSON.stringify({ profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor, method, retroTilt, cabinet }),
    [profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor, method, retroTilt, cabinet],
  );

  const compute = useCallback(async () => {
    const runId = ++runIdRef.current;
    lastSigRef.current = JSON.stringify({ profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor, method, retroTilt, cabinet });
    setBusy(true);
    setErrorMsg(null);
    // Le profil de l'état est déjà synchronisé par le formulaire ; on relit le
    // stockage en secours (première génération avant tout onChange).
    const p = profile !== EMPTY_PROFILE ? profile : loadStoredProfile();
    setAmountEur(p.amount_eur);
    setHorizon(p.horizon_years ?? 8);

    const base = profileToConstraints(p);
    const sriMax = sriOverride ?? base.maxWeightedSri ?? null;
    const maxAssetsN = Math.min(Math.max(Number(maxAssets) || 7, 4), 10);
    const maxPerFundN = Math.min(Math.max(Number(maxPerFund) || 25, 10), 100) / 100;
    const mustIsins = included.map((f) => f.isin);
    const excludedIsins = excluded.map((f) => f.isin);

    const now = new Date();
    const asOfLabel = `${MONTHS_FR[now.getMonth()]} ${now.getFullYear()}`;
    const contractName = contract.includes("::") ? contract.split("::")[1] : contract;
    const profileLabel = p.risk_profile ? RISK_LABEL[p.risk_profile] : undefined;

    // Construit la query d'optimisation ; les poches réutilisent le même
    // constructeur avec leur propre plafond SRI (et sans fonds imposés).
    const buildQs = (maxSriParam: number | null, sriMaxParam: number | null, must: string[]) => {
      const qs = new URLSearchParams({
        contract,
        min: "4",
        max: String(maxAssetsN),
      });
      const targets = Object.entries(base.classTargets ?? {})
        .filter(([, v]) => (v ?? 0) > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(",");
      if (targets) qs.set("targets", targets);
      if (maxSriParam != null) qs.set("maxSri", String(maxSriParam));
      if (sriMaxParam != null) qs.set("sriMax", String(sriMaxParam));
      if (p.geographies.length) qs.set("geo", p.geographies.join(","));
      if (p.esg === "art8" || p.esg === "art9") qs.set("esg", p.esg);
      if (p.max_ter != null) qs.set("terMax", String(p.max_ter));
      if (must.length) qs.set("must", must.join(","));
      if (excludedIsins.length) qs.set("exclude", excludedIsins.join(","));
      if (advisor.trim()) qs.set("advisor", advisor.trim());
      if (method !== "sharpe") qs.set("method", method);
      if (retroTilt) qs.set("retro", "1");
      // Convention du cabinet pour ce contrat : le taux UC remplace l'estimation.
      if (convention?.ucRetroShare != null) {
        qs.set("ucShare", String(Math.round(convention.ucRetroShare * 10000) / 100));
      }
      qs.set("asOf", asOfLabel);
      return qs;
    };

    // Projets valides → plafond SRI de leur poche.
    const goalRows = p.goals
      .map((g) => ({ g, plan: goalToPlan(g) }))
      .filter((x): x is { g: ClientGoal; plan: NonNullable<ReturnType<typeof goalToPlan>> } => x.plan !== null)
      .map(({ g, plan }) => ({
        g,
        plan,
        cap: pocketSriCap(plan.years, g.priority, sriMax),
        // Poche identique au portefeuille global → pas de recalcul.
        sameAsGlobal: sriMax != null ? pocketSriCap(plan.years, g.priority, sriMax) === sriMax : pocketSriCap(plan.years, g.priority, sriMax) >= 7,
      }));

    // 1) Base réelle : /api/portfolio/optimize (fonds du contrat, corrélations DB).
    let api: OptimizeApiResponse | null = null;
    if (contract.includes("::") && contract !== SAMPLE_CONTRACT) {
      try {
        const res = await fetch(`/api/portfolio/optimize?${buildQs(base.maxWeightedSri ?? null, sriMax, mustIsins).toString()}`);
        if (res.ok) {
          api = (await res.json()) as OptimizeApiResponse;
        } else {
          // La base répond mais refuse (ex. univers insuffisant après filtres) :
          // on affiche la raison au lieu de basculer sur l'univers d'exemple.
          const j = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
          if (runId !== runIdRef.current) return;
          setErrorMsg(j?.detail || j?.error || "Optimisation impossible avec ces réglages.");
          setBusy(false);
          setHasGenerated(true);
          return;
        }
      } catch {
        /* base non joignable → repli démo ci-dessous */
      }
    }
    if (runId !== runIdRef.current) return; // un recalcul plus récent a pris la main

    if (api) {
      setResult(api.allocation);
      setPresentation(api.presentation);
      setSimWeights(null); // nouvelle allocation → simulation remise à zéro
      setPresOpts({
        contractName,
        universeSize: api.meta?.universe ?? api.allocation.lines.length,
        advisorName: advisor.trim() || null,
        asOfLabel,
        profileLabel: profileLabel ?? profileFromSri(api.allocation.weightedSri),
      });
      setCorr(
        api.correlations
          ? { names: api.correlations.names, matrix: api.correlations.matrix }
          : null,
      );
      setSource("api");
      setSummary(profileSummary(p, api.meta?.droppedByPreferences ?? 0));
      setBusy(false);
      setHasGenerated(true);

      // Poches par projet : une optimisation dédiée par plafond SRI de poche,
      // APRÈS l'affichage du résultat principal (les cartes se précisent quand
      // les poches arrivent). Échec d'une poche → repli global, signalé.
      const globalStats = { mu: api.allocation.expectedReturn, sigma: api.allocation.volatility };
      const capMax = sriMax ?? 7;
      const entries = await Promise.all(
        goalRows.map(async ({ g, cap, sameAsGlobal }) => {
          if (sameAsGlobal) {
            return [g.id, { sriCap: cap, ...globalStats, fallback: false } satisfies PocketStats] as const;
          }
          // Assouplissement cran par cran si l'univers manque de fonds assez
          // défensifs (ex. plafond 1 sur un contrat sans monétaire) — sans
          // jamais dépasser le plafond global du client.
          for (let c = cap; c <= capMax; c++) {
            try {
              const r = await fetch(`/api/portfolio/optimize?${buildQs(c, c, []).toString()}`);
              if (!r.ok) continue;
              const j = (await r.json()) as OptimizeApiResponse;
              const entry: PocketStats = {
                sriCap: c,
                mu: j.allocation.expectedReturn,
                sigma: j.allocation.volatility,
                fallback: false,
                ...(c > cap ? { relaxedFrom: cap } : {}),
              };
              return [g.id, entry] as const;
            } catch {
              break; // réseau indisponible : inutile d'insister
            }
          }
          return [g.id, { sriCap: cap, ...globalStats, fallback: true } satisfies PocketStats] as const;
        }),
      );
      if (runId !== runIdRef.current) return;
      setPockets(Object.fromEntries(entries));
      return;
    }

    // 2) Repli démo : même pipeline, univers d'exemple côté navigateur.
    const filterOpts = {
      maxTer: p.max_ter,
      esg: p.esg,
      geographies: p.geographies,
      sriMax,
      exclude: excludedIsins,
    };
    const notes: string[] = [];
    let geoActive = p.geographies.length > 0;
    let filtered = filterUniverse(SAMPLE_UNIVERSE, filterOpts);
    if (filtered.funds.length < 4 && geoActive) {
      const retry = filterUniverse(SAMPLE_UNIVERSE, { ...filterOpts, geographies: [] });
      if (retry.funds.length >= 4) {
        filtered = retry;
        geoActive = false;
        notes.push("Zones géographiques trop restrictives sur l'univers d'exemple : contrainte levée pour préserver la diversification.");
      }
    }
    if (filtered.funds.length < 4) {
      const bare = filterUniverse(SAMPLE_UNIVERSE, { exclude: excludedIsins });
      filtered = bare;
      geoActive = false;
      notes.push("Filtres du profil trop restrictifs sur l'univers d'exemple : allocation calculée sur l'univers complet.");
    }
    // Les fonds imposés restent dans l'univers même si un filtre les écarte.
    const universe = [...filtered.funds];
    const excludedSet = new Set(excludedIsins);
    for (const isin of mustIsins) {
      if (excludedSet.has(isin) || universe.some((f) => f.isin === isin)) continue;
      const f = SAMPLE_UNIVERSE.find((x) => x.isin === isin);
      if (f) universe.push(f);
    }

    const res = optimizeAllocation(universe, sampleCorrelation, {
      ...base,
      maxWeightedSri: sriMax,
      minAssets: 4,
      maxAssets: maxAssetsN,
      maxWeightPerFund: maxPerFundN,
      mustInclude: mustIsins,
      method,
      commissionTieBreak: retroTilt ? COMMISSION_TIE_BREAK_TOL : 0,
      // Chaque zone demandée doit être représentée (tant que le filtre géo est actif).
      coverRegions: geoActive
        ? p.geographies
            .map((g) => ({ zone: g, regions: GEO_TO_REGIONS[g] ?? [] }))
            .filter((z) => z.regions.length > 0)
        : undefined,
    });
    res.notes.unshift(
      ...notes,
      "Mode démonstration : base non connectée, univers d'exemple. En production : les fonds réels du contrat.",
    );

    const demoPresOpts = {
      contractName,
      universeSize: universe.length,
      advisorName: advisor.trim() || null,
      asOfLabel,
      profileLabel: profileLabel ?? profileFromSri(res.weightedSri),
    };
    const pres = buildPresentation(res, demoPresOpts);

    if (runId !== runIdRef.current) return;
    setResult(res);
    setPresentation(pres);
    setSimWeights(null); // nouvelle allocation → simulation remise à zéro
    setPresOpts(demoPresOpts);
    setCorr({
      names: res.lines.map((l) => l.name),
      matrix: res.lines.map((a) => res.lines.map((b) => (a.isin === b.isin ? 1 : sampleCorrelation(a.isin, b.isin)))),
    });
    setSource("demo");
    setSummary(profileSummary(p, filtered.dropped));

    // Poches par projet sur l'univers d'exemple (synchrone), avec le même
    // assouplissement cran par cran que la voie API.
    const demoGlobal = { mu: res.expectedReturn, sigma: res.volatility };
    const demoCapMax = sriMax ?? 7;
    const pocketMap: Record<string, PocketStats> = {};
    for (const { g, cap, sameAsGlobal } of goalRows) {
      if (sameAsGlobal) {
        pocketMap[g.id] = { sriCap: cap, ...demoGlobal, fallback: false };
        continue;
      }
      let entry: PocketStats | null = null;
      for (let c = cap; c <= demoCapMax && !entry; c++) {
        const stats = demoPocketStats(p, c, method, maxAssetsN, maxPerFundN, excludedIsins);
        if (stats) {
          entry = { sriCap: c, ...stats, fallback: false, ...(c > cap ? { relaxedFrom: cap } : {}) };
        }
      }
      pocketMap[g.id] = entry ?? { sriCap: cap, ...demoGlobal, fallback: true };
    }
    setPockets(pocketMap);
    setBusy(false);
    setHasGenerated(true);
  }, [profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor, method, retroTilt, cabinet, convention]);

  // Recalcul automatique (débouncé) après la première génération : jouer avec le
  // SRI, les zones géographiques, les frais, l'ESG ou la composition met le
  // résultat à jour tout seul.
  useEffect(() => {
    if (!hasGenerated) return;
    if (lastSigRef.current === inputsSig) return; // rien n'a changé depuis le dernier calcul
    const t = setTimeout(() => { void compute(); }, 400);
    return () => clearTimeout(t);
  }, [compute, inputsSig, hasGenerated]);

  // ─── Retrait / ajout de fonds ───────────────────────────────────────────────

  function removeFund(isin: string) {
    const line = result?.lines.find((l) => l.isin === isin);
    const name = line?.name ?? isin;
    setExcluded((prev) => (prev.some((f) => f.isin === isin) ? prev : [...prev, { isin, name }]));
    setIncluded((prev) => prev.filter((f) => f.isin !== isin));
    setLastRemoved({ isin, name, similars: [] });

    // Suggestions de remplacement « similaire » : base réelle si branchée,
    // sinon heuristique locale (même classe d'actifs, volatilité proche).
    if (source === "api") {
      fetch(`/api/fonds/${isin}/similar?limit=3`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { data?: { isin: string; name: string }[] } | null) => {
          const sims = (j?.data ?? []).map((f) => ({ isin: f.isin, name: f.name }));
          setLastRemoved((cur) => (cur && cur.isin === isin ? { ...cur, similars: sims } : cur));
        })
        .catch(() => {});
    } else {
      const ref = SAMPLE_UNIVERSE.find((f) => f.isin === isin);
      const inLines = new Set((result?.lines ?? []).map((l) => l.isin));
      const alreadyOut = new Set(excluded.map((f) => f.isin));
      const sims = SAMPLE_UNIVERSE
        .filter((f) => f.isin !== isin && !inLines.has(f.isin) && !alreadyOut.has(f.isin) && f.assetClass === ref?.assetClass)
        .sort((a, b) => Math.abs(a.volatility - (ref?.volatility ?? 0)) - Math.abs(b.volatility - (ref?.volatility ?? 0)))
        .slice(0, 3)
        .map((f) => ({ isin: f.isin, name: f.name }));
      setLastRemoved({ isin, name, similars: sims });
    }
  }

  function includeFund(isin: string, name: string) {
    setExcluded((prev) => prev.filter((f) => f.isin !== isin));
    setIncluded((prev) => (prev.some((f) => f.isin === isin) ? prev : [...prev, { isin, name }]));
    setLastRemoved(null);
  }

  function restoreFund(isin: string) {
    setExcluded((prev) => prev.filter((f) => f.isin !== isin));
    setLastRemoved((cur) => (cur && cur.isin === isin ? null : cur));
  }

  // ─── Exports ────────────────────────────────────────────────────────────────

  async function downloadPdf() {
    const pres = effectivePresentation ?? presentation;
    if (!pres) return;
    setPdfBusy(true);
    try {
      const [{ pdf }, { default: AllocationReportPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/AllocationReportPDF"),
      ]);
      const blob = await pdf(<AllocationReportPDF presentation={pres} />).toBlob();
      triggerDownload(blob, `allocation-${pres.headline.profileLabel.toLowerCase()}.pdf`);
    } catch {
      window.print();
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadPptx() {
    const pres = effectivePresentation ?? presentation;
    if (!pres) return;
    setPptBusy(true);
    try {
      const { buildAllocationDeck } = await import("@/lib/allocationPptx");
      await buildAllocationDeck(pres).writeFile({
        fileName: `allocation-${pres.headline.profileLabel.toLowerCase()}.pptx`,
      });
    } catch {
      /* génération navigateur indisponible : le PDF reste dispo */
    } finally {
      setPptBusy(false);
    }
  }

  function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Covariance des lignes retenues (pour le plan de Markowitz interactif),
  // reconstruite depuis la matrice de corrélation affichée (démo ou base).
  const resultCov = useMemo(() => {
    if (!result || result.lines.length === 0 || !corr) return null;
    if (corr.matrix.length !== result.lines.length) return null;
    const lines = result.lines;
    return covarianceMatrix(
      lines.map((l) => l.volatility),
      corr.matrix,
      // Paires sans corrélation observée : même prior de classe que le moteur.
      (i, j) => classCorrelation(lines[i].assetClass, lines[j].assetClass),
    );
  }, [result, corr]);

  const linesIsins = useMemo(() => new Set((result?.lines ?? []).map((l) => l.isin)), [result]);

  // Résultat EFFECTIF : l'allocation optimale, ou sa version repondérée par les
  // curseurs du conseiller. Tout ce qui est affiché/exporté en dessous du
  // graphique suit ce résultat-là (profil de risque, SRI, projection, projets).
  const effectiveResult = useMemo(() => {
    if (!result || !simWeights || !resultCov) return result;
    return reweightAllocation(result, simWeights, resultCov, DEFAULT_CONSTRAINTS.riskFree);
  }, [result, simWeights, resultCov]);
  const effectivePresentation = useMemo(() => {
    if (!presentation || !effectiveResult || !result) return presentation;
    if (effectiveResult === result || !presOpts) return presentation;
    return buildPresentation(effectiveResult, presOpts);
  }, [presentation, effectiveResult, result, presOpts]);

  const projected =
    effectiveResult && amountEur && amountEur > 0
      ? amountEur * Math.pow(1 + effectiveResult.expectedReturn, Math.max(1, horizon))
      : null;

  return (
    <PageShell className="space-y-5">
      <h1 className="text-heading text-ink font-semibold">Portefeuille</h1>

      {/* Étape 1 — Profil du client (données CLIENT). Depuis la refonte de nav,
          le profil ne se saisit plus qu'ici (retiré de l'accueil). */}
      <Card className="px-5 py-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-brown text-paper text-caption font-semibold shrink-0">1</span>
          <h2 className="text-body-lg text-ink font-semibold">Profil du client</h2>
        </div>
        <ClientProfileForm showSearchCta={false} onChange={onProfileChange} />
      </Card>

      {/* Étape 2 — Portefeuille : réglages du CONSEILLER puis génération. */}
      <Card className="px-5 py-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-brown text-paper text-caption font-semibold shrink-0">2</span>
          <h2 className="text-body-lg text-ink font-semibold">Portefeuille</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Contrat">
              {cabinet.contracts.length > 0 ? (
                <select
                  className={inputCls}
                  value={contract}
                  aria-label="Contrat du cabinet"
                  onChange={(e) => setContract(e.target.value)}
                >
                  {cabinet.contracts.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.key.replace("::", " — ")}
                    </option>
                  ))}
                  <option value={SAMPLE_CONTRACT}>Contrat démo (univers d&apos;exemple)</option>
                </select>
              ) : (
                <>
                  <input className={inputCls} value={contract} onChange={(e) => setContract(e.target.value)} />
                  <span className="text-caption text-muted-2">
                    Renseignez vos contrats dans l&apos;onglet <a href="/cabinet" className="underline underline-offset-2 hover:text-ink">Mon cabinet</a> pour les retrouver ici.
                  </span>
                </>
              )}
            </Field>
            <Field label="Poids max. par fonds (%)">
              <input className={inputCls} type="number" min={10} max={100} value={maxPerFund} onChange={(e) => setMaxPerFund(e.target.value)} />
            </Field>
            <Field label="Nombre max. de supports">
              <input className={inputCls} type="number" min={4} max={10} value={maxAssets} onChange={(e) => setMaxAssets(e.target.value)} />
            </Field>
            <Field label="Cabinet / conseiller (optionnel)">
              <input className={inputCls} value={advisor} onChange={(e) => setAdvisor(e.target.value)} placeholder="Ex. Métagram Gestion Privée" />
            </Field>
          </div>

          {/* Risque : plafond SRI jouable par le conseiller */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-meta text-muted">
                Risque maximal (SRI par fonds) : <strong className="text-ink">{effectiveSri} / 7</strong>
                {sriOverride == null && <span> (déduit du profil)</span>}
              </span>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={7}
                  step={1}
                  value={effectiveSri}
                  aria-label="Plafond SRI par fonds"
                  onChange={(e) => setSriOverride(Number(e.target.value))}
                  className="w-56"
                  style={{ accentColor: "var(--color-accent)" }}
                />
                {sriOverride != null && (
                  <button
                    className="text-meta text-muted hover:text-ink underline underline-offset-2"
                    onClick={() => setSriOverride(null)}
                  >
                    Revenir au profil
                  </button>
                )}
              </div>
            </div>

            {/* Ajout d'un fonds imposé, dès le départ */}
            <div className="flex flex-col gap-1">
              <span className="text-meta text-muted">Imposer un fonds dans l&apos;allocation</span>
              {source === "demo" ? (
                <select
                  className={inputCls}
                  value=""
                  aria-label="Imposer un fonds (univers d'exemple)"
                  onChange={(e) => {
                    const f = SAMPLE_UNIVERSE.find((x) => x.isin === e.target.value);
                    if (f) includeFund(f.isin, f.name);
                  }}
                >
                  <option value="">Choisir dans l&apos;univers d&apos;exemple…</option>
                  {SAMPLE_UNIVERSE.filter((f) => !linesIsins.has(f.isin) && !included.some((i) => i.isin === f.isin)).map((f) => (
                    <option key={f.isin} value={f.isin}>{f.name}</option>
                  ))}
                </select>
              ) : (
                <FundAdder
                  onAdd={(isin, name) => includeFund(isin, name)}
                  existing={new Set([...included.map((f) => f.isin), ...linesIsins])}
                />
              )}
              {included.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {included.map((f) => (
                    <span key={f.isin} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-line text-ink-2 bg-paper-2">
                      {shortName(f.name, 28)}
                      <button
                        aria-label={`Ne plus imposer ${f.name}`}
                        onClick={() => setIncluded((prev) => prev.filter((x) => x.isin !== f.isin))}
                        className="text-muted hover:text-danger"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Réglages avancés : moteur de pondération + départage rétrocessions,
              repliés par défaut pour ne montrer d'emblée que l'essentiel. */}
          <div className="mt-4 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="inline-flex items-center gap-1.5 text-meta text-ink-2 font-medium hover:text-ink transition-colors"
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Réglages avancés
              {!showAdvanced && (method !== "sharpe" || retroTilt) && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-accent" aria-label="réglages personnalisés actifs" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-4">
                {/* Méthode de pondération : deux moteurs, mêmes contraintes. */}
                <div className="flex flex-col gap-1">
                  <span className="text-meta text-muted">Moteur de pondération</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMethod("sharpe")}
                      className={`px-3.5 py-2 rounded-lg text-meta font-medium border transition-all ${
                        method === "sharpe"
                          ? "bg-brown text-paper border-brown shadow-sm"
                          : "bg-paper text-ink-2 border-line hover:border-brown/30"
                      }`}
                    >
                      Max-Sharpe
                    </button>
                    <button
                      type="button"
                      onClick={() => setMethod("hrp")}
                      className={`px-3.5 py-2 rounded-lg text-meta font-medium border transition-all ${
                        method === "hrp"
                          ? "bg-brown text-paper border-brown shadow-sm"
                          : "bg-paper text-ink-2 border-line hover:border-brown/30"
                      }`}
                    >
                      HRP
                    </button>
                  </div>
                  <span className="text-meta text-muted">
                    {method === "sharpe"
                      ? "Optimise le couple rendement/risque."
                      : "Répartit le risque par familles corrélées."}
                  </span>
                </div>

                {/* Départage rémunération cabinet : l'adéquation client reste première,
                    la rétrocession ne départage que des fonds quasi équivalents. */}
                <div className="flex flex-col gap-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={retroTilt}
                      onChange={(e) => setRetroTilt(e.target.checked)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span className="text-meta text-ink font-medium">
                      Départage rémunération cabinet (rétrocessions)
                    </span>
                  </label>
                  <span className="text-meta text-muted">
                    À adéquation équivalente, retient la meilleure rétrocession — jamais au détriment du client.
                  </span>
                </div>
              </div>
            )}
          </div>

        <div className="mt-5 flex items-center gap-3">
          <Btn variant="primary" size="md" loading={busy} onClick={() => void compute()}>
            Générer l&apos;allocation
          </Btn>
          <span className="text-meta text-muted">
            {source === "api"
              ? "Fonds réels du contrat (base connectée)."
              : source === "demo"
                ? `Univers de démonstration (${SAMPLE_UNIVERSE.length} fonds) : base non connectée.`
                : "Le résultat se met ensuite à jour à chaque réglage."}
          </span>
        </div>
      </Card>

      {errorMsg && (
        <Card className="px-5 py-3">
          <span className="text-meta text-danger">ⓘ {errorMsg}</span>
        </Card>
      )}

      {/* Résultat */}
      {presentation && result && (
        <>
          {summary && (
            <Card className="px-5 py-3 bg-paper-2">
              <span className="text-meta text-ink-2">Profil utilisé — {summary}</span>
            </Card>
          )}

          {/* Fonds retiré : suggestion d'un remplaçant similaire */}
          {lastRemoved && (
            <Card className="px-5 py-3 border-clay/40">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-meta text-ink-2">
                  <strong>{shortName(lastRemoved.name, 34)}</strong> retiré de l&apos;allocation.
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
                Projection indicative : {amountEur!.toLocaleString("fr-FR")} € à ~{((effectiveResult ?? result).expectedReturn * 100).toFixed(1)} %/an
                sur {horizon} ans ≈ <strong>{Math.round(projected).toLocaleString("fr-FR")} €</strong>
                {" "}(hors frais et fiscalité, performances non garanties).
              </span>
            </Card>
          )}
          {/* Rémunération cabinet (visible seulement si le départage est activé).
              Cascade complète côté affichage : exception par fonds (convention)
              → rétro de la ligne (convention contrat côté serveur, sinon
              estimation) ; plus la part des frais de gestion du contrat. */}
          {retroTilt && amountEur != null && amountEur > 0 && (() => {
            const lines = (effectiveResult ?? result).lines;
            const known = lines.filter((l) => l.retrocession != null);
            if (known.length === 0 && convention?.contractFeeShare == null) return null;
            const ucAnnual = lines.reduce((s, l) => {
              const retro = resolveFundRetrocession(convention, l.isin, l.ter ?? null, l.retrocession ?? null);
              return s + (l.weight / 100) * (retro ?? 0) * amountEur;
            }, 0);
            const contractAnnual = (convention?.contractFeeShare ?? 0) * amountEur;
            const total = ucAnnual + contractAnnual;
            const hasConvention = convention != null &&
              (convention.ucRetroShare != null || convention.contractFeeShare != null || convention.fundOverrides.length > 0);
            return (
              <Card className="px-5 py-4 bg-paper-2">
                <span className="text-meta text-ink-2">
                  Rémunération cabinet estimée : <strong>~{Math.round(total).toLocaleString("fr-FR")} €/an</strong>
                  {" "}sur {amountEur.toLocaleString("fr-FR")} € investis
                  {contractAnnual > 0 && (
                    <> ({Math.round(contractAnnual).toLocaleString("fr-FR")} € part contrat
                    {" "}+ {Math.round(ucAnnual).toLocaleString("fr-FR")} € rétrocessions UC)</>
                  )}
                  {known.length < lines.length ? ` — ${lines.length - known.length} ligne(s) sans donnée` : ""}
                  {" "}— {hasConvention
                    ? "selon vos conventions saisies dans Mon cabinet, non contractuel."
                    : "estimation à défaut des conventions réelles (à saisir dans Mon cabinet), non contractuelle."}
                </span>
              </Card>
            );
          })()}
          {/* Projets du client : une poche dédiée par projet (capital, épargne
              et allocation propres — jamais mis en commun entre projets). */}
          <GoalsCard
            goals={profile.goals}
            globalMu={(effectiveResult ?? result).expectedReturn}
            globalSigma={(effectiveResult ?? result).volatility}
            pockets={pockets}
            amountEur={amountEur}
          />
          {(effectiveResult ?? result).notes.length > 0 && (
            <Card className="px-5 py-3">
              <ul className="space-y-1">
                {(effectiveResult ?? result).notes.map((n, i) => (
                  <li key={i} className="text-meta text-muted">ⓘ {n}</li>
                ))}
              </ul>
            </Card>
          )}
          <div className="flex justify-end gap-2">
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
          {corr && <CorrelationCard names={corr.names} matrix={corr.matrix} />}
          {/* Back-test historique : rejoue la performance réelle des supports
              retenus (aux poids courants, curseurs Markowitz compris) face à un
              indice. Réservé aux données réelles du contrat — l'univers de
              démonstration n'a pas de séries de prix. */}
          {source === "api" && (
            <PortfolioBacktest
              holdings={(effectiveResult ?? result).lines.map((l) => ({ isin: l.isin, weight: l.weight }))}
            />
          )}
          <AllocationReport presentation={effectivePresentation ?? presentation} onRemoveLine={removeFund} />
        </>
      )}
    </PageShell>
  );
}
