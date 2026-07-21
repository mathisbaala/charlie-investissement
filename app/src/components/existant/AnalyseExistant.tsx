"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { Kpi } from "@/components/ui/Kpi";
import { PageShell } from "@/components/ui/Page";
import { Upload, X, ArrowLeft, FileSearch, FileText, Check } from "@/components/ui/icons";
import { FundAdder } from "@/components/portfolio/FundAdder";
import { PortfolioBacktest } from "@/components/portfolio/PortfolioBacktest";
import { PortfolioExposure } from "@/components/portfolio/PortfolioExposure";
import { SupportUnique } from "./SupportUnique";
import { weightedExposure, type ExpoRow, type Expo } from "@/lib/lookthrough";
import {
  consolidate, reconcileTotal,
  type ValidatedPosition,
  type ReleveApiPosition as ApiPosition, type ReleveContractMatch as ApiMatch,
} from "@/lib/releve";
import {
  buildRecommendations, weightedSri, type Recommendation, type FeeLine,
} from "@/lib/analyseExistant";
import { sanitizeFundReport } from "@/lib/fundReport";
import { parsePortfolioParams, type PortfolioAnalysis } from "@/lib/portfolio";
import { loadReleveHandoff } from "@/lib/releveHandoff";
import { buildRemuneration, retroFallbackFrac, type RemuHolding, type Remuneration } from "@/lib/remuneration";
import { RemunerationSummary } from "@/components/portfolio/RemunerationSummary";
import { loadStoredCabinet, cabinetContract } from "@/lib/cabinet";
import type { ContractType } from "@/lib/insurer-envelope";

type AnalyseMode = "portefeuille" | "support";

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const PCT = (v: number, d = 1) => `${v.toFixed(d).replace(".", ",")} %`;
// Masque les flèches natives (spinner) d'un input number : inutiles sur des
// montants en milliers (pas-à-pas unitaire) et peu élégantes. Même convention
// que le simulateur de frais.
const NUM_INPUT = "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
// Teinte d'un ratio signé : vert si positif, rouge si négatif (perf, Sharpe).
const signTone = (v: number | null | undefined): "ok" | "bad" | null =>
  v == null ? null : v >= 0 ? "ok" : "bad";

// Position côté client : celle de /api/releve, plus la provenance « document
// déposé » (fonds hors catalogue documenté par son DIC/reporting — badge UI).
type Position = ApiPosition & { viaReporting?: boolean };

// ── Type local : un relevé côté client (positions/contrats = types /api/releve) ─
interface Releve {
  id: string;
  fileName: string;
  positions: Position[];
  matches: ApiMatch[];
  /** Index du contrat retenu dans `matches` (-1 = non rattaché). */
  chosen: number;
  warning?: string;
  /** Total de valorisation imprimé sur le document (contrôle de cohérence). */
  documentTotal: number | null;
}

interface Synthese {
  analysis: PortfolioAnalysis | null;
  geo: Expo[];
  sectors: Expo[];
  recos: Recommendation[];
  sri: number | null;
  terMoyen: number | null;
  truncated: boolean;
  /** Coût client + rémunération cabinet (barème « Mon cabinet » + repli de place). */
  remu: Remuneration | null;
  /** Libellé du contrat dont la convention est appliquée (null = aucun rattaché). */
  conventionLabel: string | null;
  /** Plusieurs contrats distincts reconnus (la convention du 1er est appliquée). */
  multiContract: boolean;
}

// ── Composant ────────────────────────────────────────────────────────────────

// Deux chemins d'analyse de l'existant, réunis sous un seul onglet (ex-onglet
// « Documents » absorbé) : un portefeuille complet (relevés → diagnostic
// consolidé) ou un support unique (DICI → rapport de fonds). Le sélecteur en
// tête bascule de l'un à l'autre. Un lien profond
// `?isins=&weights=&montant=` (bouton « Analyse complète » du simulateur de
// frais) ouvre directement le chemin portefeuille, prérempli.
export function AnalyseExistant() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AnalyseMode>(
    searchParams.get("mode") === "support" ? "support" : "portefeuille",
  );

  return (
    <PageShell>
      <Link
        href="/portefeuille"
        className="flex items-center gap-1 text-meta text-muted hover:text-ink transition-colors w-fit mb-5"
      >
        <ArrowLeft size={14} /> Portefeuille
      </Link>

      {/* Sélecteur de mode : portefeuille complet ↔ support unique. */}
      <div
        role="tablist"
        aria-label="Mode d'analyse"
        className="inline-flex gap-1 p-1 mb-6 rounded-xl border border-line bg-paper-2"
      >
        <ModeTab
          active={mode === "portefeuille"}
          onClick={() => setMode("portefeuille")}
          icon={FileSearch}
          label="Portefeuille complet"
        />
        <ModeTab
          active={mode === "support"}
          onClick={() => setMode("support")}
          icon={FileText}
          label="Support unique"
        />
      </div>

      {mode === "portefeuille" ? <PortefeuilleAnalyzer /> : <SupportUnique />}
    </PageShell>
  );
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileSearch;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-meta font-medium transition-colors ${
        active
          ? "bg-brown text-paper"
          : "text-ink-2 hover:bg-accent-soft hover:text-accent-ink"
      }`}
    >
      <Icon size={15} strokeWidth={active ? 2 : 1.7} />
      {label}
    </button>
  );
}

// ── Chemin « portefeuille complet » ────────────────────────────────────────────

function PortefeuilleAnalyzer() {
  const searchParams = useSearchParams();
  const [releves, setReleves] = useState<Releve[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synthese, setSynthese] = useState<Synthese | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Dépôt du document d'UN fonds (DIC/reporting) : cible en attente + clé de la
  // ligne en cours d'analyse (`rid:isin`, ou `rid:+` pour un ajout libre).
  const reportInput = useRef<HTMLInputElement>(null);
  const [reportTarget, setReportTarget] = useState<{ rid: string; isin: string | null } | null>(null);
  const [reportBusy, setReportBusy] = useState<string | null>(null);

  // Dépôt de fichiers : un POST /api/releve par PDF, séquentiel (reste simple).
  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    // Un nouveau relevé change le patrimoine consolidé : on invalide la synthèse
    // affichée (sinon le diagnostic — perf/SRI/frais/expositions — resterait
    // calculé sur l'ancien ensemble alors que la KPI « Patrimoine » inclut déjà
    // le nouveau relevé, d'où un diagnostic incohérent avec le total affiché).
    setSynthese(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/releve", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) {
          setError(`${file.name} : ${json.error ?? `erreur ${res.status}`}`);
          continue;
        }
        setReleves((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${prev.length}`,
            fileName: file.name,
            positions: json.positions ?? [],
            matches: json.matches ?? [],
            chosen: (json.matches ?? []).length > 0 ? 0 : -1,
            warning: json.warning,
            documentTotal: json.documentTotal ?? null,
          },
        ]);
      }
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function updateAmount(rid: string, isin: string, amount: number | null) {
    setReleves((prev) => prev.map((r) => r.id !== rid ? r : {
      ...r,
      positions: r.positions.map((p) => (p.isin === isin ? { ...p, amount } : p)),
    }));
    setSynthese(null);
  }
  function removeLine(rid: string, isin: string) {
    setReleves((prev) => prev.map((r) => r.id !== rid ? r : {
      ...r, positions: r.positions.filter((p) => p.isin !== isin),
    }));
    setSynthese(null);
  }
  function removeReleve(rid: string) {
    setReleves((prev) => prev.filter((r) => r.id !== rid));
    setSynthese(null);
  }
  function chooseContract(rid: string, idx: number) {
    setReleves((prev) => prev.map((r) => (r.id === rid ? { ...r, chosen: idx } : r)));
  }

  // Enrichissement TER/SRI/nom d'une position depuis la base (mêmes données que
  // le reste, pour les diagnostics), en arrière-plan. Partagé par l'ajout manuel
  // et le préremplissage par lien profond.
  function enrichPosition(rid: string, isin: string) {
    fetch(`/api/funds?search=${encodeURIComponent(isin)}&per_page=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const f = json?.data?.[0];
        if (!f) return;
        // /api/funds renvoie déjà les frais EN POURCENTAGE (conversion
        // feeFracToPct à la frontière API) : on arrondit à 0,01 pt, sans
        // re-multiplier (le ×100 précédent gonflait un TER de 1,7 % en 170 %,
        // d'où des « frais moyens » et alertes de frais absurdes).
        const terPct = f.ongoing_charges ?? f.ter;
        const ter = terPct != null ? Math.round(Number(terPct) * 100) / 100 : null;
        const sri = f.risk_score ?? null;
        // Repli de rétrocession (FRACTION/an) pour la rémunération cabinet : les
        // frais de /api/funds sont en % (feeFracToPct à la frontière) → on
        // repasse en fraction avant d'estimer.
        const retro = retroFallbackFrac(
          f.retrocession_cgp != null ? Number(f.retrocession_cgp) / 100 : null,
          terPct != null ? Number(terPct) / 100 : null,
          f.product_type ?? null,
          f.management_style ?? null,
        );
        setReleves((prev) => prev.map((r) => r.id !== rid ? r : {
          ...r,
          positions: r.positions.map((p) =>
            p.isin === isin ? { ...p, ter, sri, retro, name: f.name ?? p.name } : p),
        }));
      })
      .catch(() => {});
  }

  // Ajout manuel d'un fonds oublié par l'extraction : recherche dans la base
  // (FundAdder), ajout immédiat avec montant à saisir, puis enrichissement.
  function addFund(rid: string, isin: string, name: string) {
    setReleves((prev) => prev.map((r) => {
      if (r.id !== rid || r.positions.some((p) => p.isin === isin)) return r;
      return {
        ...r,
        positions: [...r.positions, { isin, label: "", amount: null, known: true, name, ter: null, sri: null }],
      };
    }));
    setSynthese(null);
    enrichPosition(rid, isin);
  }

  // Un support hors catalogue (souvent un produit structuré) finit barré et
  // exclu de l'analyse : ce chemin permet au CGP de déposer le DOCUMENT du
  // support (DIC/KID, reporting) — la même route que le mode « Support unique »
  // en extrait nom/frais/SRI, et la ligne rejoint le patrimoine analysé.
  function pickReport(rid: string, isin: string | null) {
    setReportTarget({ rid, isin });
    reportInput.current?.click();
  }

  async function onReportFile(files: FileList | null) {
    const target = reportTarget;
    const file = files?.[0];
    if (!target || !file) return;
    setReportBusy(`${target.rid}:${target.isin ?? "+"}`);
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      const res = await fetch("/api/dici/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // fields="fees" : lecture déterministe (gratuite) d'abord — nom, ISIN,
        // frais courants, SRI suffisent ici ; l'IA ne sert que de repli.
        body: JSON.stringify({ file_base64: btoa(bin), fields: "fees" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(`${file.name} : ${json.error ?? `erreur ${res.status}`}`);
        return;
      }
      const outcome = sanitizeFundReport(json, target.isin ?? undefined);
      if (!outcome.ok) {
        setError(`${file.name} : ${outcome.error}`);
        return;
      }
      const fund = outcome.fund;
      setReleves((prev) => prev.map((r) => {
        if (r.id !== target.rid) return r;
        const exists = r.positions.some((p) => p.isin === fund.isin);
        const positions = exists
          ? r.positions.map((p) => p.isin !== fund.isin ? p : {
              ...p,
              known: true,
              viaReporting: !fund.catalogued,
              name: fund.name ?? p.name,
              ter: fund.ter ?? p.ter,
              sri: fund.sri ?? p.sri,
            })
          : [...r.positions, {
              isin: fund.isin, label: "", amount: null, known: true,
              viaReporting: !fund.catalogued,
              name: fund.name, ter: fund.ter, sri: fund.sri,
            }];
        return { ...r, positions };
      }));
      setSynthese(null);
      // Le document révèle un fonds finalement AU catalogue : la base fait
      // autorité sur le document, on complète depuis elle.
      if (fund.catalogued) enrichPosition(target.rid, fund.isin);
    } catch {
      setError(`${file.name} : lecture du document impossible.`);
    } finally {
      setReportBusy(null);
      setReportTarget(null);
      if (reportInput.current) reportInput.current.value = "";
    }
  }

  // Préremplissage par lien profond : /portefeuille/analyser?isins=&weights=&montant=
  // (bouton « Analyse complète » du simulateur de frais). On matérialise un relevé
  // virtuel de supports valorisés, prêt à analyser, puis on enrichit TER/SRI/nom.
  const preloaded = useRef(false);
  useEffect(() => {
    if (preloaded.current) return;
    // Relais du relevé parsé (sessionStorage, cf. lib/releveHandoff) : rejoue le
    // dépôt À L'IDENTIQUE du dépôt direct — montants réels au centime, contrat
    // reconnu (donc DIC + convention), fonds euros compris. Prioritaire sur la
    // reconstruction depuis l'URL, qui perd tout cela (poids arrondis, matches
    // vidés). Present uniquement quand on arrive du simulateur après un dépôt.
    const handoff = loadReleveHandoff(searchParams.get("handoff"));
    if (handoff && handoff.length > 0) {
      preloaded.current = true;
      setReleves(handoff.map((r) => ({ ...r, warning: undefined })));
      return;
    }
    const holdings = parsePortfolioParams(searchParams.get("isins"), searchParams.get("weights"));
    if (holdings.length === 0) return;
    preloaded.current = true;
    const montant = Number(searchParams.get("montant"));
    const hasMontant = Number.isFinite(montant) && montant > 0;
    const rid = "import-lien";
    const positions: ApiPosition[] = holdings.map((h) => ({
      isin: h.isin,
      label: "",
      amount: hasMontant ? Math.round((montant * h.weight) / 100) : null,
      known: true,
      name: h.isin,
      ter: null,
      sri: null,
    }));
    setReleves([{
      id: rid,
      fileName: "Supports importés de l'onglet Frais",
      positions,
      matches: [],
      chosen: -1,
      documentTotal: hasMontant ? Math.round(montant) : null,
    }]);
    for (const h of holdings) enrichPosition(rid, h.isin);
  }, [searchParams]);

  // Portefeuille consolidé : positions connues + montant confirmé, tous relevés.
  const consolidated = useMemo(() => {
    const validated: ValidatedPosition[] = [];
    for (const r of releves) {
      for (const p of r.positions) {
        if (!p.known || p.amount === null || p.amount <= 0) continue;
        validated.push({ isin: p.isin, name: p.name ?? p.label ?? p.isin, amount: p.amount });
      }
    }
    return consolidate(validated);
  }, [releves]);

  const total = useMemo(() => consolidated.reduce((s, p) => s + p.amount, 0), [consolidated]);

  // Supports LUS mais absents de notre catalogue : valorisés, donc comptés dans
  // la réconciliation du relevé, mais EXCLUS de l'analyse (perf/frais/corrélation
  // reposent sur nos données). On les signale explicitement — sinon le patrimoine
  // analysé paraît complet à tort et le CGP ne voit pas ce qu'il manque.
  const excluded = useMemo(() => {
    const byIsin = new Map<string, number>();
    for (const r of releves) {
      for (const p of r.positions) {
        if (p.known || p.amount === null || p.amount <= 0) continue;
        byIsin.set(p.isin, (byIsin.get(p.isin) ?? 0) + p.amount);
      }
    }
    let amount = 0;
    for (const v of byIsin.values()) amount += v;
    return { count: byIsin.size, amount };
  }, [releves]);

  async function analyse() {
    if (consolidated.length < 2) return;
    setAnalysing(true);
    setError(null);
    try {
      // inv_portfolio_analyze est plafonné à 20 fonds → top 20 par poids.
      const top = consolidated.slice(0, 20);
      const truncated = consolidated.length > 20;
      const isins = top.map((p) => p.isin).join(",");
      const weights = top.map((p) => Math.round(p.weight * 1000) / 10).join(",");

      const [aRes, eRes] = await Promise.all([
        fetch(`/api/portfolio/analyze?isins=${isins}&weights=${weights}&years=5`),
        fetch(`/api/portfolio/exposure?isins=${consolidated.slice(0, 40).map((p) => p.isin).join(",")}`),
      ]);
      const analysis: PortfolioAnalysis | null = aRes.ok ? await aRes.json() : null;
      const expo: { geo: ExpoRow[]; sectors: ExpoRow[] } = eRes.ok
        ? await eRes.json()
        : { geo: [], sectors: [] };

      const fundWeights: Record<string, number> = {};
      for (const p of consolidated) fundWeights[p.isin] = p.weight;
      const geo = weightedExposure(expo.geo ?? [], fundWeights, 8);
      const sectors = weightedExposure(expo.sectors ?? [], fundWeights, 8);

      // Frais/SRI depuis les positions enrichies par /api/releve.
      const enriched = new Map<string, ApiPosition>();
      for (const r of releves) for (const p of r.positions) if (p.known) enriched.set(p.isin, p);
      const fees: FeeLine[] = consolidated.map((p) => ({
        isin: p.isin,
        name: p.name,
        ter: enriched.get(p.isin)?.ter ?? null,
        weight: p.weight * 100,
      }));
      const sriRows = consolidated.map((p) => ({
        sri: enriched.get(p.isin)?.sri ?? null,
        weight: p.weight,
      }));
      const terKnown = fees.filter((f) => f.ter !== null);
      const terMoyen = terKnown.length
        ? terKnown.reduce((s, f) => s + (f.ter as number) * f.weight, 0) /
          terKnown.reduce((s, f) => s + f.weight, 0)
        : null;

      const recos = buildRecommendations({
        correlation: analysis?.correlation ?? [],
        names: analysis?.names ?? Object.fromEntries(consolidated.map((p) => [p.isin, p.name])),
        geo,
        sectors,
        fees,
      });

      // ── Coût client + rémunération cabinet ──
      // Convention appliquée : le contrat reconnu (choisi) rattaché dans « Mon
      // cabinet ». Un portefeuille peut couvrir plusieurs relevés/contrats ; on
      // applique la convention du premier contrat reconnu et on le signale.
      const chosen: { key: string; label: string }[] = [];
      for (const r of releves) {
        const m = r.chosen >= 0 ? r.matches[r.chosen] : undefined;
        if (m) chosen.push({ key: `${m.company}::${m.contract}`, label: `${m.company} · ${m.contract}` });
      }
      const uniqueKeys = [...new Set(chosen.map((c) => c.key))];
      const cab = loadStoredCabinet();
      const convention = uniqueKeys.length > 0 ? cabinetContract(cab, uniqueKeys[0]) : null;
      const holdings: RemuHolding[] = consolidated.map((p) => {
        const e = enriched.get(p.isin);
        return {
          isin: p.isin,
          name: p.name,
          amount: p.amount,
          // TER des positions = %, la rému raisonne en fraction.
          terFrac: e?.ter != null ? (e.ter as number) / 100 : null,
          retroFallbackFrac: e?.retro ?? null,
        };
      });

      // Frais du CONTRAT sourcés (av_contract_terms) pour un coût client exact :
      // frais de gestion UC + frais d'entrée du contrat reconnu, sinon indicatif
      // d'enveloppe (repli silencieux si le contrat n'est pas en base).
      let contractFeePct: number | null = null;
      let contractEntryPct: number | null = null;
      let contractTypes: ContractType[] | null = null;
      if (uniqueKeys.length > 0) {
        try {
          const tRes = await fetch(`/api/contract/terms?key=${encodeURIComponent(uniqueKeys[0])}`);
          if (tRes.ok) {
            const t = await tRes.json();
            if (t.found) {
              contractFeePct = t.frais_gestion_uc_pct ?? null;
              contractEntryPct = t.frais_entree_pct ?? null;
              contractTypes = (t.types ?? null) as ContractType[] | null;
            }
          }
        } catch { /* repli sur l'indicatif d'enveloppe */ }
      }
      const remu = buildRemuneration(holdings, convention, {
        terMoyenPct: terMoyen, contractFeePct, contractEntryPct, contractTypes,
        honoraireForfait: cab.honoraireForfait, honoraireAnnuel: cab.honoraireAnnuel,
      });

      setSynthese({
        analysis, geo, sectors, recos, sri: weightedSri(sriRows), terMoyen, truncated,
        remu,
        conventionLabel: convention ? (chosen.find((c) => c.key === uniqueKeys[0])?.label ?? null) : null,
        multiContract: uniqueKeys.length > 1,
      });
    } catch {
      setError("L'analyse a échoué, réessayer.");
    } finally {
      setAnalysing(false);
    }
  }

  const fraisHref = useMemo(() => {
    const top = consolidated.slice(0, 10);
    if (top.length === 0) return "/frais";
    // Contrat reconnu (unique) → passé au simulateur pour qu'il applique le même
    // barème « Mon cabinet » que le bloc de rému ci-dessus (mêmes taux).
    const keys = new Set<string>();
    for (const r of releves) {
      const m = r.chosen >= 0 ? r.matches[r.chosen] : undefined;
      if (m) keys.add(`${m.company}::${m.contract}`);
    }
    const contractParam = keys.size === 1 ? `&contract=${encodeURIComponent([...keys][0])}` : "";
    return `/frais?isins=${top.map((p) => p.isin).join(",")}&weights=${top
      .map((p) => Math.round(p.weight * 1000) / 10)
      .join(",")}&montant=${Math.round(total)}${contractParam}`;
  }, [consolidated, total, releves]);

  return (
    <>
      {/* ── Dépôt : même zone glisser-déposer que le mode « Support unique » ── */}
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv"
        multiple
        className="hidden"
        data-testid="releve-input"
        onChange={(e) => onFiles(e.target.files)}
      />
      {/* Dépôt du document d'un fonds hors catalogue (un seul PDF à la fois). */}
      <input
        ref={reportInput}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        data-testid="report-input"
        onChange={(e) => onReportFile(e.target.files)}
      />
      {busy ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 mb-6">
          <div className="w-12 h-12 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-body font-medium text-ink-2">Lecture en cours…</p>
        </div>
      ) : (
        <div
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileInput.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed transition-colors cursor-pointer py-16 px-8 text-center mb-6 ${
            dragging
              ? "border-accent bg-accent-soft/30"
              : "border-line bg-paper hover:border-accent/40 hover:bg-paper-2"
          }`}
        >
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${
            dragging ? "bg-accent/20" : "bg-paper-2 border border-line"
          }`}>
            <Upload size={24} className={dragging ? "text-accent" : "text-muted"} />
          </div>
          <div>
            <p className="text-body-lg font-medium text-ink-2">
              {dragging ? "Relâchez pour analyser" : "Glissez les relevés du client ici"}
            </p>
            <p className="text-meta text-muted mt-1">
              ou <span className="text-accent-ink underline underline-offset-2">cliquez pour sélectionner</span> des fichiers PDF, Excel ou CSV
            </p>
          </div>
        </div>
      )}
      {error && <p className="text-caption text-danger -mt-3 mb-6">{error}</p>}

      {/* ── Validation par relevé ── */}
      {releves.map((r) => (
        <Card key={r.id} className="p-5 mb-4" data-testid="releve-card">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-body font-semibold text-ink">{r.fileName}</h2>
              {r.warning && <p className="text-caption text-warn-dark mt-0.5">{r.warning}</p>}
            </div>
            <button
              type="button"
              onClick={() => removeReleve(r.id)}
              aria-label={`Retirer ${r.fileName}`}
              className="inline-flex items-center justify-center rounded-md p-1 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {r.matches.length > 0 && (
            <label className="block mb-3 text-caption text-muted">
              Contrat reconnu
              <select
                className="block mt-1 w-full max-w-md rounded-lg border border-line bg-paper px-2 py-1.5 text-body text-ink"
                value={r.chosen}
                onChange={(e) => chooseContract(r.id, Number(e.target.value))}
              >
                {r.matches.map((m, i) => (
                  <option key={`${m.company}::${m.contract}`} value={i}>
                    {m.company} · {m.contract} ({Math.round(m.coverage * 100)} % des lignes couvertes)
                  </option>
                ))}
                <option value={-1}>Autre / ne pas rattacher</option>
              </select>
            </label>
          )}

          {r.positions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-caption">
                <thead>
                  <tr className="text-left text-muted border-b border-line-soft">
                    <th className="py-1.5 pr-3 font-medium">Support</th>
                    <th className="py-1.5 pr-3 font-medium">ISIN</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Montant (€)</th>
                    <th className="py-1.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {r.positions.map((p) => (
                    <tr key={p.isin} className="border-b border-line-soft/60">
                      <td className={`py-1.5 pr-3 ${p.known ? "text-ink" : "text-muted line-through"}`}>
                        {p.name ?? p.label ?? "—"}
                        {!p.known && <span className="ml-1 no-underline">(hors catalogue)</span>}
                        {p.viaReporting && (
                          <span
                            className="ml-1.5 text-caption text-accent-ink"
                            title="Nom, frais et SRI lus dans le document déposé (fonds hors catalogue : performance et corrélations indisponibles)"
                          >
                            · reporting
                          </span>
                        )}
                        {!p.known && (
                          <button
                            type="button"
                            onClick={() => pickReport(r.id, p.isin)}
                            disabled={reportBusy !== null}
                            className="ml-2 no-underline text-accent-ink underline-offset-2 hover:underline disabled:opacity-50"
                            data-testid={`report-btn-${p.isin}`}
                          >
                            {reportBusy === `${r.id}:${p.isin}` ? "Analyse…" : "Déposer son DIC/reporting"}
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-muted">{p.isin}</td>
                      <td className="py-1.5 pr-3 text-right">
                        <input
                          type="number"
                          min={0}
                          value={p.amount ?? ""}
                          placeholder="—"
                          aria-label={`Montant ${p.isin}`}
                          onChange={(e) =>
                            updateAmount(r.id, p.isin, e.target.value === "" ? null : Number(e.target.value))
                          }
                          className={`w-28 text-right tabular-nums rounded-md border border-line bg-paper px-2 py-1 focus:outline-none focus:border-accent ${NUM_INPUT}`}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(r.id, p.isin)}
                          aria-label={`Retirer ${p.isin}`}
                          className="inline-flex items-center justify-center rounded-md p-1 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Contrôle de cohérence : somme des lignes vs total imprimé sur le
              relevé (toutes lignes, y compris hors catalogue : elles font
              partie du total du document). */}
          <ReconciliationBadge releve={r} />

          {/* Un fonds a échappé à l'extraction ? Recherche directe dans la base
              (ISIN ou nom), puis saisie du montant dans le tableau. */}
          <div className="mt-3 max-w-md" data-testid="fund-adder">
            <FundAdder
              onAdd={(isin, name) => addFund(r.id, isin, name)}
              existing={new Set(r.positions.map((p) => p.isin))}
            />
            {/* Fonds introuvable dans la base (hors catalogue) : le document du
                support prend le relais de la recherche. */}
            <button
              type="button"
              onClick={() => pickReport(r.id, null)}
              disabled={reportBusy !== null}
              className="mt-1.5 text-caption text-muted hover:text-accent-ink transition-colors underline underline-offset-2 disabled:opacity-50"
              data-testid="report-adder"
            >
              {reportBusy === `${r.id}:+`
                ? "Analyse du document…"
                : "Fonds introuvable ? Déposez son DIC ou son reporting"}
            </button>
          </div>
        </Card>
      ))}

      {/* ── Lancement de l'analyse ── */}
      {releves.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap mb-8">
          <Btn
            type="button"
            variant="primary"
            loading={analysing}
            disabled={consolidated.length < 2}
            onClick={analyse}
          >
            {analysing ? "Analyse en cours…" : "Analyser le patrimoine consolidé"}
          </Btn>
          {consolidated.length < 2 && (
            <p className="text-caption text-muted">
              Au moins 2 supports valorisés sont nécessaires pour l&apos;analyse.
            </p>
          )}
        </div>
      )}

      {/* Supports lus mais hors catalogue : signalés, jamais écartés en silence. */}
      {excluded.count > 0 && (
        <p className="text-caption text-warn-dark -mt-4 mb-8" data-testid="excluded-notice">
          {/* Phrase en une seule chaîne JS : le whitespace JSX supprimait l'espace
              entre l'expression ternaire et le mot suivant (« inclusdans »). */}
          {`${excluded.count} support${excluded.count > 1 ? "s" : ""} non reconnu${excluded.count > 1 ? "s" : ""} dans notre catalogue (${EUR.format(excluded.amount)}) : ${excluded.count > 1 ? "ils ne sont pas inclus" : "il n'est pas inclus"} dans l'analyse (performance, frais et corrélations portent sur les supports connus). Le total réconcilié par relevé les prend en compte. Déposez le DIC ou le reporting de chaque ligne barrée pour l'intégrer au diagnostic (frais, SRI).`}
        </p>
      )}

      {/* ── Synthèse ── diagnostic chiffré, alertes, marché, répartition. */}
      {synthese && (
        <div className="space-y-6">
          {/* Bandeau « carte d'identité » : taille · rendement · risque (SRI) ·
              coût. Volatilité / Sharpe / perte max vivent dans « Historique du
              portefeuille » où ils se lisent FACE à l'indice — on ne répète pas
              ici les mêmes chiffres (ils sortent du même calcul). */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <Kpi label="Patrimoine" value={EUR.format(total)} />
            <Kpi
              label="Perf. annualisée"
              value={synthese.analysis?.ratios?.annual_return != null ? PCT(synthese.analysis.ratios.annual_return * 100) : "—"}
              tone={signTone(synthese.analysis?.ratios?.annual_return)}
            />
            <Kpi label="SRI pondéré" value={synthese.sri != null ? `${String(synthese.sri).replace(".", ",")} / 7` : "—"} />
            <Kpi label="Frais moyens" value={synthese.terMoyen != null ? PCT(synthese.terMoyen, 2) : "—"} />
          </div>

          {/* Coût client & rémunération cabinet — la traçabilité par portefeuille.
              Composant PARTAGÉ avec le parcours « construire » : même moteur, même
              rendu, un résultat identique quel que soit le chemin d'entrée. */}
          {synthese.remu && (
            <RemunerationSummary
              remu={synthese.remu}
              conventionLabel={synthese.conventionLabel}
              multiContract={synthese.multiContract}
            />
          )}

          {/* Points d'attention — anomalies détectées, le cœur de la valeur CGP. */}
          <section>
            <h2 className="text-title text-ink mb-3">Points d&apos;attention</h2>
            {synthese.recos.length === 0 ? (
              <Card className="p-4 flex items-center gap-2.5">
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-ok-soft text-ok shrink-0">
                  <Check size={15} />
                </span>
                <p className="text-meta text-ink-2">
                  Corrélations, frais et concentration maîtrisés — aucune anomalie détectée.
                </p>
              </Card>
            ) : (
              <div className="grid gap-2.5">
                {synthese.recos.map((reco) => (
                  <RecoCard key={`${reco.kind}-${reco.title}`} reco={reco} />
                ))}
              </div>
            )}
          </section>

          {/* Performance & risque face au marché : indice de référence au choix
              du conseiller (sélecteur), courbe rejouée aux poids réels. */}
          <PortfolioBacktest holdings={consolidated.slice(0, 20).map((p) => ({ isin: p.isin, weight: p.weight * 100 }))} />

          {/* Répartition par transparence (look-through) : géo + secteurs agrégés. */}
          <PortfolioExposure lines={consolidated.slice(0, 40).map((p) => ({ isin: p.isin, weight: p.weight * 100 }))} />

          {/* Corrélations entre supports : doubles emplois en un coup d'œil. */}
          {synthese.analysis && synthese.analysis.correlation.length > 0 && (
            <CorrelationMatrix analysis={synthese.analysis} />
          )}

          {synthese.truncated && (
            <p className="text-caption text-muted-2">
              Perf, risque et corrélations portent sur les 20 supports principaux ; les répartitions couvrent l&apos;ensemble.
            </p>
          )}

          <Link href={fraisHref} className="inline-block text-meta text-ink underline underline-offset-4 hover:text-accent-ink transition-colors">
            Projeter les frais dans le temps et exporter un PDF →
          </Link>
        </div>
      )}
    </>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────

/**
 * Badge de réconciliation : la somme des montants du relevé (lignes extraites,
 * saisies et hors catalogue confondues) doit retrouver le total imprimé sur le
 * document. Vert = extraction fiable ; orange = il manque des lignes (fonds
 * euros sans ISIN, support raté), avec l'écart chiffré pour guider la saisie.
 */
function ReconciliationBadge({ releve }: { releve: Releve }) {
  const sum = releve.positions.reduce(
    (s, p) => s + (Number.isFinite(p.amount) ? (p.amount as number) : 0),
    0,
  );
  const rec = reconcileTotal(sum, releve.documentTotal);
  if (!rec) return null;
  if (rec.status === "ok") {
    return (
      <p className="mt-3 text-caption text-ok" data-testid="reconciliation-ok">
        ✓ Total réconcilié avec le relevé ({EUR.format(rec.total)})
      </p>
    );
  }
  return (
    <p className="mt-3 text-caption text-danger" data-testid="reconciliation-gap">
      Écart de {EUR.format(Math.abs(rec.diff))} avec le total du relevé ({EUR.format(rec.total)}) :
      il manque probablement des lignes (fonds en euros sans code ISIN, support non extrait) ;
      complétez avec la barre d&apos;ajout ou corrigez les montants.
    </p>
  );
}

// Style par nature d'alerte : liseré + pastille colorés, pour hiérarchiser le
// diagnostic visuellement (diversification / concentration / frais).
const RECO_META: Record<Recommendation["kind"], { label: string; border: string; badge: string }> = {
  correlation: { label: "Diversification", border: "border-l-accent", badge: "text-accent" },
  concentration: { label: "Concentration", border: "border-l-brown", badge: "text-brown" },
  frais: { label: "Frais", border: "border-l-warn", badge: "text-warn-dark" },
};

/** Carte d'alerte : constat chiffré + conseil, colorée selon la nature. */
function RecoCard({ reco }: { reco: Recommendation }) {
  const m = RECO_META[reco.kind];
  return (
    <Card className={`p-4 border-l-4 ${m.border}`} data-testid="reco-card">
      <p className={`text-caption uppercase tracking-widest font-semibold mb-1 ${m.badge}`}>{m.label}</p>
      <h3 className="text-body font-semibold text-ink mb-1">{reco.title}</h3>
      <p className="text-meta text-muted leading-relaxed">{reco.detail}</p>
    </Card>
  );
}

/** Heatmap de corrélation compacte (paires du RPC, rouge au-dessus de 0,9). */
function CorrelationMatrix({ analysis }: { analysis: PortfolioAnalysis }) {
  const isins = useMemo(() => {
    const s = new Set<string>();
    for (const p of analysis.correlation) { s.add(p.a); s.add(p.b); }
    return Array.from(s);
  }, [analysis.correlation]);
  const rho = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of analysis.correlation) {
      if (p.c === null) continue;
      m.set(`${p.a}|${p.b}`, p.c);
      m.set(`${p.b}|${p.a}`, p.c);
    }
    return m;
  }, [analysis.correlation]);
  if (isins.length < 2 || isins.length > 15) return null;
  const short = (isin: string) => (analysis.names?.[isin] ?? isin).slice(0, 18);

  return (
    <Card className="p-5 overflow-x-auto">
      <h3 className="text-body font-semibold text-ink mb-3">Matrice de corrélation (5 ans)</h3>
      <table className="text-caption border-collapse">
        <thead>
          <tr>
            <th />
            {isins.map((i) => (
              <th key={i} className="px-1 pb-1 font-normal text-muted max-w-16 truncate" title={short(i)}>
                {short(i).slice(0, 8)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isins.map((a) => (
            <tr key={a}>
              <th className="pr-2 py-0.5 font-normal text-left text-muted whitespace-nowrap max-w-44 truncate" title={short(a)}>
                {short(a)}
              </th>
              {isins.map((b) => {
                const v = a === b ? 1 : rho.get(`${a}|${b}`);
                const bg =
                  v === undefined ? "transparent"
                  : v >= 0.9 ? "rgba(220, 60, 60, 0.55)"
                  : v >= 0.7 ? "rgba(230, 150, 60, 0.45)"
                  : v >= 0.4 ? "rgba(120, 160, 200, 0.30)"
                  : "rgba(100, 170, 120, 0.25)";
                return (
                  <td key={b} className="w-11 h-7 text-center text-ink" style={{ background: bg }}>
                    {v !== undefined ? v.toFixed(2).replace(".", ",") : "·"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-caption text-muted mt-2">
        Rouge : corrélation ≥ 0,90 (les deux supports font double emploi).
      </p>
    </Card>
  );
}
