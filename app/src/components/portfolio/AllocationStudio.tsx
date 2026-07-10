"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { X } from "@/components/ui/icons";
import { PageShell } from "@/components/ui/Page";
import { ClientProfileForm } from "@/components/profile/ClientProfileForm";
import { AllocationReport } from "@/components/portfolio/AllocationReport";
import { MarkowitzChart } from "@/components/portfolio/MarkowitzChart";
import { FundAdder } from "@/components/portfolio/FundAdder";
import { covarianceMatrix } from "@/lib/correlation";
import {
  DEFAULT_CONSTRAINTS,
  optimizeAllocation,
  type AllocationResult,
} from "@/lib/optimizer";
import { buildPresentation, profileFromSri, type AllocationPresentation } from "@/lib/allocationRationale";
import { profileToConstraints, filterUniverse } from "@/lib/profileToConstraints";
import { SAMPLE_UNIVERSE, sampleCorrelation, SAMPLE_CONTRACT } from "@/lib/sampleUniverse";
import { loadStoredProfile, EMPTY_PROFILE, type RichClientProfile } from "@/lib/clientProfile";

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
      <h2 className="text-label text-ink font-semibold mb-1">Corrélation des supports retenus</h2>
      <p className="text-meta text-muted mb-3">
        Plus la corrélation entre deux fonds est faible, plus leur combinaison diversifie le portefeuille.
      </p>
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
  meta?: { droppedByPreferences?: number };
};

export function AllocationStudio() {
  const [maxPerFund, setMaxPerFund] = useState("25");
  const [maxAssets, setMaxAssets] = useState("7");
  const [advisor, setAdvisor] = useState("");
  const [contract, setContract] = useState(SAMPLE_CONTRACT);

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
    () => JSON.stringify({ profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor }),
    [profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor],
  );

  const compute = useCallback(async () => {
    const runId = ++runIdRef.current;
    lastSigRef.current = JSON.stringify({ profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor });
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

    // 1) Base réelle : /api/portfolio/optimize (fonds du contrat, corrélations DB).
    let api: OptimizeApiResponse | null = null;
    if (contract.includes("::") && contract !== SAMPLE_CONTRACT) {
      try {
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
        if (base.maxWeightedSri != null) qs.set("maxSri", String(base.maxWeightedSri));
        if (sriMax != null) qs.set("sriMax", String(sriMax));
        if (p.geographies.length) qs.set("geo", p.geographies.join(","));
        if (p.esg === "art8" || p.esg === "art9") qs.set("esg", p.esg);
        if (p.max_ter != null) qs.set("terMax", String(p.max_ter));
        if (mustIsins.length) qs.set("must", mustIsins.join(","));
        if (excludedIsins.length) qs.set("exclude", excludedIsins.join(","));
        if (advisor.trim()) qs.set("advisor", advisor.trim());
        qs.set("asOf", asOfLabel);
        const res = await fetch(`/api/portfolio/optimize?${qs.toString()}`);
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
      setCorr(
        api.correlations
          ? { names: api.correlations.names, matrix: api.correlations.matrix }
          : null,
      );
      setSource("api");
      setSummary(profileSummary(p, api.meta?.droppedByPreferences ?? 0));
      setBusy(false);
      setHasGenerated(true);
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
    let filtered = filterUniverse(SAMPLE_UNIVERSE, filterOpts);
    if (filtered.funds.length < 4 && p.geographies.length > 0) {
      const retry = filterUniverse(SAMPLE_UNIVERSE, { ...filterOpts, geographies: [] });
      if (retry.funds.length >= 4) {
        filtered = retry;
        notes.push("Zones géographiques trop restrictives sur l'univers d'exemple : contrainte levée pour préserver la diversification.");
      }
    }
    if (filtered.funds.length < 4) {
      const bare = filterUniverse(SAMPLE_UNIVERSE, { exclude: excludedIsins });
      filtered = bare;
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
    });
    res.notes.unshift(
      ...notes,
      "Mode démonstration : base non connectée, univers d'exemple. En production : les fonds réels du contrat.",
    );

    const pres = buildPresentation(res, {
      contractName,
      universeSize: universe.length,
      advisorName: advisor.trim() || null,
      asOfLabel,
      profileLabel: profileLabel ?? profileFromSri(res.weightedSri),
    });

    if (runId !== runIdRef.current) return;
    setResult(res);
    setPresentation(pres);
    setCorr({
      names: res.lines.map((l) => l.name),
      matrix: res.lines.map((a) => res.lines.map((b) => (a.isin === b.isin ? 1 : sampleCorrelation(a.isin, b.isin)))),
    });
    setSource("demo");
    setSummary(profileSummary(p, filtered.dropped));
    setBusy(false);
    setHasGenerated(true);
  }, [profile, sriOverride, excluded, included, maxAssets, maxPerFund, contract, advisor]);

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
    if (!presentation) return;
    setPdfBusy(true);
    try {
      const [{ pdf }, { default: AllocationReportPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/AllocationReportPDF"),
      ]);
      const blob = await pdf(<AllocationReportPDF presentation={presentation} />).toBlob();
      triggerDownload(blob, `allocation-${presentation.headline.profileLabel.toLowerCase()}.pdf`);
    } catch {
      window.print();
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadPptx() {
    if (!presentation) return;
    setPptBusy(true);
    try {
      const { buildAllocationDeck } = await import("@/lib/allocationPptx");
      await buildAllocationDeck(presentation).writeFile({
        fileName: `allocation-${presentation.headline.profileLabel.toLowerCase()}.pptx`,
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

  const projected =
    result && amountEur && amountEur > 0
      ? amountEur * Math.pow(1 + result.expectedReturn, Math.max(1, horizon))
      : null;

  // Covariance des lignes retenues (pour le plan de Markowitz interactif),
  // reconstruite depuis la matrice de corrélation affichée (démo ou base).
  const resultCov = useMemo(() => {
    if (!result || result.lines.length === 0 || !corr) return null;
    if (corr.matrix.length !== result.lines.length) return null;
    return covarianceMatrix(result.lines.map((l) => l.volatility), corr.matrix, 0);
  }, [result, corr]);

  const linesIsins = useMemo(() => new Set((result?.lines ?? []).map((l) => l.isin)), [result]);

  return (
    <PageShell className="space-y-6">
      <div>
        <h1 className="text-heading text-ink font-semibold">Allocation optimisée</h1>
        <p className="text-meta text-muted">
          Le profil client saisi à l&apos;accueil est réutilisé ici : renseignez le (ou laissez celui déjà rempli),
          puis générez l&apos;allocation. Chaque réglage (risque, zones, frais, composition) recalcule le résultat.
        </p>
      </div>

      {/* Une seule carte : le profil (données CLIENT, partagées avec l'accueil)
          puis les paramètres du moteur (choix du CONSEILLER pour cette étude) —
          réunis pour la lisibilité, mais séparés par un intertitre car ils ne
          décrivent pas la même chose. */}
      <Card className="px-5 py-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-label text-ink font-semibold">Profil du client</h2>
          <span className="text-meta text-muted">Partagé avec l&apos;accueil · enregistré automatiquement</span>
        </div>
        <ClientProfileForm showSearchCta={false} onChange={onProfileChange} />

        <div className="mt-6 pt-5 border-t border-line-soft">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-label text-ink font-semibold">Paramètres de l&apos;allocation</h2>
            <span className="text-meta text-muted">Réglages du conseiller — indépendants du profil client</span>
          </div>
          <p className="text-meta text-muted mb-4">
            Sur quel contrat optimiser, le risque maximal accepté, la concentration maximale
            par fonds et le nombre de lignes du portefeuille.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Contrat">
              <input className={inputCls} value={contract} onChange={(e) => setContract(e.target.value)} />
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
              <span className="text-meta text-muted">
                Aucun fonds plus risqué que ce plafond n&apos;entre dans l&apos;allocation (adéquation MIF).
              </span>
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
                Projection indicative : {amountEur!.toLocaleString("fr-FR")} € à ~{(result.expectedReturn * 100).toFixed(1)} %/an
                sur {horizon} ans ≈ <strong>{Math.round(projected).toLocaleString("fr-FR")} €</strong>
                {" "}(hors frais et fiscalité, performances non garanties).
              </span>
            </Card>
          )}
          {result.notes.length > 0 && (
            <Card className="px-5 py-3">
              <ul className="space-y-1">
                {result.notes.map((n, i) => (
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
            <MarkowitzChart lines={result.lines} cov={resultCov} riskFree={DEFAULT_CONSTRAINTS.riskFree} />
          )}
          {corr && <CorrelationCard names={corr.names} matrix={corr.matrix} />}
          <AllocationReport presentation={presentation} onRemoveLine={removeFund} />
        </>
      )}
    </PageShell>
  );
}
