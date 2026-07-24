"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  type RichClientProfile,
  type ClientGoal,
} from "@/lib/clientProfile";
import { goalToPlan, pocketSriCap } from "@/lib/goalPlanning";
import {
  EMPTY_CABINET,
  loadStoredCabinet,
  cabinetContract,
  type CabinetSettings,
} from "@/lib/cabinet";
// Types UNIQUEMENT (import type = effacé au build) : le module serveur
// allocationReview importe le SDK Anthropic, qui ne doit pas partir au client.
import type { AllocationReview, ReviewIssue, ReviewClientContext } from "@/lib/allocationReview";

// Contexte de l'atelier Portefeuille : porte TOUT l'état et le moteur d'optimisation,
// monté au niveau du layout /portefeuille/construire pour survivre à la navigation
// entre la page de réglages (/portefeuille/construire) et la page dédiée au
// portefeuille (/portefeuille/construire/resultat). Réutilise le PROFIL CLIENT saisi à l'accueil (même
// formulaire, mêmes données, partagées via le stockage local). Branché sur
// /api/portfolio/optimize (fonds réels du contrat) ; si la base n'est pas
// joignable (dev local sans secrets), repli sur l'univers d'exemple. Interactif :
// après la première génération, tout changement (profil, SRI, zones, exclusions,
// ajouts) relance l'optimisation automatiquement.

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export const RISK_LABEL: Record<string, string> = {
  prudent: "Prudent", modere: "Modéré", equilibre: "Équilibré",
  dynamique: "Dynamique", offensif: "Offensif",
};
export const ESG_LABEL: Record<string, string> = {
  indifferent: "Indifférent", art8: "Art. 8+", art9: "Art. 9", labelise: "Labellisé",
};

export function shortName(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

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

// ─── Projets du client : une POCHE par projet ─────────────────────────────────
// Chaque projet est évalué avec SES moyens (capital affecté + épargne mensuelle,
// jamais mis en commun avec les autres projets) et SA poche : une allocation
// dédiée, calibrée sur son horizon et sa priorité (plafond SRI de poche).

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
    exclusions: p.exclusions,
  }).funds;
  if (funds.length < 4) {
    // Préférences trop restrictives pour cette poche : on ne garde que le
    // plafond SRI (contrainte de la poche), les exclusions manuelles et les
    // exclusions éthiques (mandat du client, jamais assouplies).
    funds = filterUniverse(SAMPLE_UNIVERSE, {
      sriMax: pocketCap,
      exclude: excludedIsins,
      exclusions: p.exclusions,
    }).funds;
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

// ─── Vérification IA ──────────────────────────────────────────────────────────
// Après le moteur, l'IA relit l'allocation (grille type Finary) et peut demander
// des corrections (exclusions, cibles de classes) que le MOTEUR ré-exécute.
// L'état ci-dessous résume la revue pour l'affichage : verdict, constats,
// corrections appliquées et coût API cumulé (transparence dépense).

export interface AiReviewState {
  status: "done" | "unavailable";
  /** conforme = validé tel quel ; corrige = corrections appliquées par le moteur ;
   *  reserves = corrections demandées mais re-calcul impossible (allocation initiale). */
  verdict?: "conforme" | "corrige" | "reserves";
  /** Constats de la revue — journal des corrections (et signalements « info »). */
  issues: ReviewIssue[];
  /** Corrections appliquées, en clair pour le CGP. */
  corrections: string[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Nombre d'appels LLM effectués (1 seul : pas de contre-vérification). */
  calls: number;
  model?: string;
  /** Raison si status = unavailable (clé absente, service en erreur…). */
  error?: string;
}

async function postReview(body: {
  allocation: AllocationResult;
  client: ReviewClientContext;
  engineTargets?: Record<string, number>;
  mustInclude: string[];
}): Promise<AllocationReview> {
  const res = await fetch("/api/portfolio/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => null)) as { review?: AllocationReview; error?: string } | null;
  if (!res.ok || !j?.review) throw new Error(j?.error ?? "Vérification IA indisponible.");
  return j.review;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

function useStudioState() {
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
  // Vérification IA post-moteur (revue + corrections). Activée par défaut :
  // se dégrade en « indisponible » si la clé API n'est pas configurée.
  const [aiVerify, setAiVerify] = useState(true);
  const [aiReview, setAiReview] = useState<AiReviewState | null>(null);

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
  // ISIN des fonds imposés NON référencés dans le contrat courant : ils reçoivent
  // une pastille « non référencé » et bloquent la génération tant qu'ils ne sont
  // pas retirés. Vide en mode démo (l'univers d'exemple n'a pas de référencement).
  const [unreferencedIsins, setUnreferencedIsins] = useState<Set<string>>(new Set());

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

  // Référencement des supports imposés : à chaque changement de contrat OU de
  // liste imposée, on vérifie côté base lesquels sont réellement référencés dans
  // le contrat courant. Couvre les deux parcours (contrat d'abord → pastille dès
  // l'ajout ; fonds d'abord → pastille dès que le contrat est renseigné). La
  // démo (pas de « :: ») est exemptée. Réseau KO → aucune pastille (fail-open :
  // on ne bloque jamais abusivement la génération).
  useEffect(() => {
    const isReal = contract.includes("::") && contract !== SAMPLE_CONTRACT;
    const isins = included.map((f) => f.isin);
    if (!isReal || isins.length === 0) {
      setUnreferencedIsins((prev) => (prev.size ? new Set() : prev));
      return;
    }
    const ac = new AbortController();
    const qs = new URLSearchParams({ contract, isins: isins.join(",") });
    fetch(`/api/portfolio/referencing?${qs.toString()}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http"))))
      .then((j: { referenced?: string[] }) => {
        const ref = new Set((j.referenced ?? []).map((s) => s.toUpperCase()));
        setUnreferencedIsins(new Set(isins.filter((i) => !ref.has(i.toUpperCase()))));
      })
      .catch(() => {
        if (!ac.signal.aborted) setUnreferencedIsins((prev) => (prev.size ? new Set() : prev));
      });
    return () => ac.abort();
  }, [contract, included]);

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
    () => JSON.stringify({ profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor, method, retroTilt, cabinet, aiVerify }),
    [profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor, method, retroTilt, cabinet, aiVerify],
  );

  // Renvoie true quand une allocation a été produite (→ affichage / navigation),
  // false sur erreur ou calcul obsolète.
  const compute = useCallback(async (): Promise<boolean> => {
    // Garde : un support imposé non référencé dans le contrat bloque la
    // génération (y compris le recalcul auto) tant qu'il n'est pas retiré.
    if (included.some((f) => unreferencedIsins.has(f.isin))) return false;
    const runId = ++runIdRef.current;
    lastSigRef.current = JSON.stringify({ profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor, method, retroTilt, cabinet, aiVerify });
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
      // Exclusions éthiques du client (armes, tabac, fossiles…) : contrainte de
      // mandat appliquée par le moteur, jamais assouplie.
      if (p.exclusions.length) qs.set("exclusions", p.exclusions.join(","));
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
          if (runId !== runIdRef.current) return false;
          setErrorMsg(j?.detail || j?.error || "Optimisation impossible avec ces réglages.");
          setBusy(false);
          setHasGenerated(true);
          return false;
        }
      } catch {
        /* base non joignable → repli démo ci-dessous */
      }
    }
    if (runId !== runIdRef.current) return false; // un recalcul plus récent a pris la main

    if (api) {
      let alloc = api;

      // ── Vérification IA (post-moteur) ────────────────────────────────────
      // Un SEUL appel : l'IA relit l'allocation et, si elle demande des
      // corrections (exclusions / cibles), le MOTEUR est ré-exécuté avec ces
      // contraintes — le CGP reçoit un portefeuille déjà corrigé, pas des
      // recommandations. Pas de contre-vérification (latence et coût divisés
      // par deux) ; toute erreur IA laisse l'allocation intacte.
      let reviewState: AiReviewState | null = null;
      if (aiVerify) {
        const clientCtx: ReviewClientContext = {
          age: p.age,
          horizonYears: p.horizon_years,
          objectif: p.objectif,
          riskProfile: p.risk_profile,
          perteMax: p.perte_max,
          incomeNeed: p.income_need,
          esg: p.esg,
          geographies: p.geographies,
          exclusions: p.exclusions,
        };
        try {
          const first = await postReview({
            allocation: alloc.allocation,
            client: clientCtx,
            engineTargets: base.classTargets as Record<string, number> | undefined,
            mustInclude: mustIsins,
          });
          let verdict: NonNullable<AiReviewState["verdict"]> = "conforme";
          const corrections: string[] = [];

          if (first.verdict === "a_corriger") {
            const qs2 = buildQs(base.maxWeightedSri ?? null, sriMax, mustIsins);
            if (first.actions.exclude.length) {
              qs2.set("exclude", [...excludedIsins, ...first.actions.exclude].join(","));
              const names = first.actions.exclude.map(
                (i) => alloc.allocation.lines.find((l) => l.isin === i)?.name ?? i,
              );
              corrections.push(`Fonds écartés : ${names.join(", ")}`);
            }
            if (first.actions.classTargets) {
              const entries = Object.entries(first.actions.classTargets).filter(([, v]) => (v ?? 0) > 0);
              qs2.set("targets", entries.map(([k, v]) => `${k}:${v}`).join(","));
              corrections.push(`Cibles ajustées : ${entries.map(([k, v]) => `${k} ${v} %`).join(", ")}`);
            }
            const res2 = await fetch(`/api/portfolio/optimize?${qs2.toString()}`);
            if (res2.ok) {
              alloc = (await res2.json()) as OptimizeApiResponse;
              verdict = "corrige";
            } else {
              verdict = "reserves";
              corrections.push(
                "Correction impossible avec l'univers de ce contrat : allocation initiale conservée.",
              );
            }
          }
          reviewState = {
            status: "done", verdict, issues: first.issues, corrections,
            costUsd: first.usage.costUsd, inputTokens: first.usage.inputTokens,
            outputTokens: first.usage.outputTokens, calls: 1, model: first.model,
          };
        } catch (e) {
          reviewState = {
            status: "unavailable", issues: [], corrections: [],
            costUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0,
            error: e instanceof Error ? e.message : "Vérification IA indisponible.",
          };
        }
      }
      // La revue n'est PAS montrée au CGP (le portefeuille arrive déjà
      // corrigé) : trace console pour l'équipe — verdict, constats, coût.
      if (reviewState) console.info("[vérification IA]", reviewState);
      if (runId !== runIdRef.current) return false;
      setAiReview(reviewState);
      setResult(alloc.allocation);
      setPresentation(alloc.presentation);
      setSimWeights(null); // nouvelle allocation → simulation remise à zéro
      setPresOpts({
        contractName,
        universeSize: alloc.meta?.universe ?? alloc.allocation.lines.length,
        advisorName: advisor.trim() || null,
        asOfLabel,
        profileLabel: profileLabel ?? profileFromSri(alloc.allocation.weightedSri),
      });
      setCorr(
        alloc.correlations
          ? { names: alloc.correlations.names, matrix: alloc.correlations.matrix }
          : null,
      );
      setSource("api");
      setSummary(profileSummary(p, alloc.meta?.droppedByPreferences ?? 0));
      setBusy(false);
      setHasGenerated(true);

      // Poches par projet : une optimisation dédiée par plafond SRI de poche, en
      // tâche de fond (les cartes se précisent quand les poches arrivent). Échec
      // d'une poche → repli global, signalé.
      void (async () => {
        const globalStats = { mu: alloc.allocation.expectedReturn, sigma: alloc.allocation.volatility };
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
      })();
      return true;
    }

    // 2) Repli démo : même pipeline, univers d'exemple côté navigateur.
    // Pas d'exclusions sectorielles ici : l'univers d'exemple ne porte ni
    // esg_exclusions ni labels — les appliquer viderait la démo.
    const filterOpts = {
      maxTer: p.max_ter,
      esg: p.esg,
      geographies: p.geographies,
      sriMax,
      exclude: excludedIsins,
      exclusions: p.exclusions,
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
      // Comme côté API : les exclusions éthiques survivent au repli.
      const bare = filterUniverse(SAMPLE_UNIVERSE, { exclude: excludedIsins, exclusions: p.exclusions });
      filtered = bare;
      geoActive = false;
      notes.push("Filtres du profil trop restrictifs sur l'univers d'exemple : portefeuille calculé sur l'univers complet.");
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
    res.notes.unshift(...notes);

    const demoPresOpts = {
      contractName,
      universeSize: universe.length,
      advisorName: advisor.trim() || null,
      asOfLabel,
      profileLabel: profileLabel ?? profileFromSri(res.weightedSri),
    };
    const pres = buildPresentation(res, demoPresOpts);

    if (runId !== runIdRef.current) return false;
    setAiReview(null); // pas de vérification IA sur l'univers d'exemple
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
    return true;
  }, [profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor, method, retroTilt, cabinet, convention, unreferencedIsins, aiVerify]);

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

  const linesIsins = useMemo(() => new Set((result?.lines ?? []).map((l) => l.isin)), [result]);

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

  // Présentation ENRICHIE pour les documents remis au client : tout ce que
  // l'atelier affiche (répartitions look-through, projets, corrélation,
  // projection, back-test) suit dans le PDF et le PowerPoint. Chaque brique est
  // optionnelle : une collecte partielle produit un document partiel, jamais
  // d'échec du téléchargement.
  async function presentationForExport(): Promise<AllocationPresentation | null> {
    const pres = effectivePresentation ?? presentation;
    const shown = effectiveResult ?? result;
    if (!pres || !shown) return pres;
    try {
      const [{ collectPresentationExtras }, { weightedTer }] = await Promise.all([
        import("@/lib/presentationExtras"),
        import("@/lib/allocationRationale"),
      ]);
      const extras = await collectPresentationExtras({
        lines: shown.lines,
        goals: profile.goals ?? [],
        pockets,
        globalMu: shown.expectedReturn,
        globalSigma: shown.volatility,
        correlation: corr,
        amountEur,
        horizonYears: Math.max(1, horizon),
        projectedEur: projected,
        effectiveHoldings: shown.diversification?.effectiveHoldings ?? null,
        avgTer: weightedTer(shown.lines),
        includeBacktest: source === "api",
      });
      return { ...pres, extras };
    } catch {
      return pres; // extras indisponibles : document de base quand même
    }
  }

  async function downloadPdf() {
    if (!(effectivePresentation ?? presentation)) return;
    setPdfBusy(true);
    try {
      const [{ pdf }, { default: AllocationReportPDF }, { getLogoDataUri }, { setBrandAccent }, brandingMod, pres] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("@/lib/AllocationReportPDF"),
          import("@/lib/pdf/logoClient"),
          import("@/lib/pdf/theme"),
          import("@/lib/branding"),
          presentationForExport(),
        ]);
      if (!pres) return;
      // Marque du cabinet importée : le PDF prend sa couleur, son logo et son nom.
      const branding = brandingMod.loadStoredBranding();
      const active = branding.enabled;
      setBrandAccent(active ? branding.accent : null);
      const cabinetLogo =
        active && branding.logo ? await brandingMod.logoToPng(branding.logo) : null;
      const logo = cabinetLogo ?? (await getLogoDataUri()); // logo cabinet, sinon Charlie
      const brandName = active && branding.orgName ? branding.orgName : undefined;
      const blob = await pdf(
        <AllocationReportPDF presentation={pres} logo={logo} brandName={brandName} />,
      ).toBlob();
      triggerDownload(blob, `portefeuille-${pres.headline.profileLabel.toLowerCase()}.pdf`);
    } catch {
      window.print();
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadPptx() {
    if (!(effectivePresentation ?? presentation)) return;
    setPptBusy(true);
    try {
      const [{ buildAllocationDeck }, { getLogoDataUri }, pres] = await Promise.all([
        import("@/lib/allocationPptx"),
        import("@/lib/pdf/logoClient"),
        presentationForExport(),
      ]);
      if (!pres) return;
      const logo = await getLogoDataUri();
      await buildAllocationDeck(pres, logo).writeFile({
        fileName: `portefeuille-${pres.headline.profileLabel.toLowerCase()}.pptx`,
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

  return {
    // Réglages (page 1)
    maxPerFund, setMaxPerFund, maxAssets, setMaxAssets, advisor, setAdvisor,
    contract, setContract, method, setMethod, showAdvanced, setShowAdvanced,
    retroTilt, setRetroTilt, cabinet, sriOverride, setSriOverride, effectiveSri,
    aiVerify, setAiVerify, aiReview,
    included, setIncluded, includeFund, unreferencedIsins, source, linesIsins,
    profile, onProfileChange,
    // Moteur
    busy, errorMsg, compute,
    // Résultats (page 2)
    presentation, result, pockets, simWeights, setSimWeights,
    corr, summary, amountEur, horizon, lastRemoved, excluded,
    removeFund, restoreFund,
    resultCov, effectiveResult, effectivePresentation, projected,
    pdfBusy, pptBusy, downloadPdf, downloadPptx,
    convention,
  };
}

type StudioValue = ReturnType<typeof useStudioState>;
const PortfolioStudioCtx = createContext<StudioValue | null>(null);

export function PortfolioStudioProvider({ children }: { children: ReactNode }) {
  const value = useStudioState();
  return <PortfolioStudioCtx.Provider value={value}>{children}</PortfolioStudioCtx.Provider>;
}

export function usePortfolioStudio(): StudioValue {
  const ctx = useContext(PortfolioStudioCtx);
  if (!ctx) throw new Error("usePortfolioStudio doit être utilisé dans un PortfolioStudioProvider");
  return ctx;
}
