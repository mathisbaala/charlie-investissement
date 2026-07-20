"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Kpi } from "@/components/ui/Kpi";
import { Btn } from "@/components/ui/Btn";
import { PageShell } from "@/components/ui/Page";
import { X, ArrowRight, Download } from "@/components/ui/icons";
import { pct, feeFracToPct, CONTRACT_FEE_DEFAULTS } from "@/lib/format";
import { parsePortfolioParams } from "@/lib/portfolio";
import {
  simulate, rendementPondere, partFraisDansGainBrut, repartitionFrais,
  remunerationSupport, HORIZONS_DEFAUT, type FeeParams, type SimulationInput,
} from "@/lib/feeSimulator";
import { SupportSources, type DepositedHolding, type DiciSupport } from "./SupportSources";
import { loadStoredCabinet, cabinetContract, resolveFundRetrocession } from "@/lib/cabinet";

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const NUM_INPUT = "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const DUREES = [5, 10, 15, 20, 25];
const MAX_UC = 10;

// Défauts « contrat type » (éditables) : bancassureur classique. La commission
// upfront du cabinet est initialisée au niveau des frais d'entrée (convention
// courante : les droits d'entrée reviennent au distributeur), éditable ensuite.
const FRAIS_DEFAUT: FeeParams = {
  contratEntree: 2, contratGestionUC: CONTRACT_FEE_DEFAULTS["AV-FR"],
  contratGestionFE: 0.7, contratSortie: 0,
  ucEntree: 0, ucGestion: 1.8, ucSortie: 0,
};
const RENDEMENT_UC_DEFAUT = 5;   // %/an, faute d'UC sélectionnées
const RENDEMENT_FE_DEFAUT = 2.5; // %/an, taux servi moyen récent

// Support (UC) enrichi depuis /api/funds : perf 5 ans annualisée + frais.
interface UcRow {
  isin: string;
  name: string;
  poids: number;               // % du compartiment UC
  perf5y: number | null;       // %/an, net des frais courants (VL réelle)
  ter: number | null;          // % (frais courants)
  entryFee: number | null;     // %
  exitFee: number | null;      // %
  retro: number | null;        // %/an — rétrocession CGP
}

interface ApiFund {
  isin: string; name?: string | null; product_type?: string | null;
  performance_5y?: number | null; ter?: number | null; ongoing_charges?: number | null;
  entry_fee_max?: number | null; exit_fee_max?: number | null; retrocession_cgp?: number | null;
}

const fetchFund = async (isin: string): Promise<ApiFund | null> => {
  try {
    const res = await fetch(`/api/funds?search=${encodeURIComponent(isin)}&per_page=1`);
    const json = await res.json();
    return json?.data?.[0] ?? null;
  } catch { return null; }
};

const toUcRow = (isin: string, name: string, poids: number, f: ApiFund | null): UcRow => ({
  isin,
  name: f?.name ?? name,
  poids,
  perf5y: f?.performance_5y ?? null,
  ter: f?.ongoing_charges ?? f?.ter ?? null,
  entryFee: feeFracToPct(f?.entry_fee_max ?? null),
  exitFee: feeFracToPct(f?.exit_fee_max ?? null),
  retro: feeFracToPct(f?.retrocession_cgp ?? null),
});

const num = (s: string): number => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

function FieldPct({ label, value, onChange, step = 0.1, note }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; note?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-meta text-ink-2">
        {label}
        {note && <span className="text-caption text-muted block">{note}</span>}
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <input
          type="number" min={0} max={20} step={step} value={value}
          onChange={(e) => onChange(Math.max(0, num(e.target.value)))}
          className={`w-16 text-right text-meta tabular-nums border border-line rounded-md px-1.5 py-1 bg-paper focus:outline-none focus:border-accent ${NUM_INPUT}`}
        />
        <span className="text-meta text-muted w-3">%</span>
      </span>
    </label>
  );
}

function FieldEur({ label, value, onChange, step }: {
  label: string; value: number; onChange: (v: number) => void; step: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-meta text-ink-2">{label}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        <input
          type="number" min={0} step={step} value={value}
          onChange={(e) => onChange(Math.max(0, num(e.target.value)))}
          className={`w-24 text-right text-meta tabular-nums border border-line rounded-md px-1.5 py-1 bg-paper focus:outline-none focus:border-accent ${NUM_INPUT}`}
        />
        <span className="text-meta text-muted w-3">€</span>
      </span>
    </label>
  );
}

const H2 = ({ children, className = "mb-3" }: { children: React.ReactNode; className?: string }) => (
  <h2 className={`text-subhead text-ink ${className}`} style={{ fontFamily: "var(--font-sans)" }}>{children}</h2>
);

// En-tête d'étape : pastille numérotée + titre. Structure le parcours en trois
// temps (déposer → paramétrer → lire).
const StepHeader = ({ n, title }: { n: number; title: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <span className="shrink-0 w-7 h-7 rounded-full bg-brown text-paper text-meta font-medium flex items-center justify-center tabular-nums leading-none">
      {n}
    </span>
    <h2 className="text-title text-ink" style={{ fontFamily: "var(--font-sans)" }}>{title}</h2>
  </div>
);

/**
 * Onglet « Frais » — angle COMPTABILITÉ / rémunération du cabinet (CGP). Deux
 * étages de frais (contrat + supports) mais la lecture est « combien je gagne,
 * qu'est-ce qui est le plus avantageux » : rétrocessions récurrentes +
 * commission upfront, cumulées et détaillées support par support. Les supports
 * s'alimentent en autonomie (recherche, relevé, fiche/DICI) et un renvoi mène au
 * détail investissement (fiche produit, analyse de portefeuille).
 */
export function FeeSimulator() {
  const [versementInitial, setVersementInitial] = useState(10_000);
  const [versementAnnuel, setVersementAnnuel] = useState(0);
  const [duree, setDuree] = useState(15);
  const [partUC, setPartUC] = useState(30);
  const [rendementFE, setRendementFE] = useState(RENDEMENT_FE_DEFAUT);
  const [rendementUCManuel, setRendementUCManuel] = useState<number | null>(null);
  const [frais, setFrais] = useState<FeeParams>(FRAIS_DEFAUT);
  const [terManuel, setTerManuel] = useState<number | null>(null);
  const [ucEntreeManuel, setUcEntreeManuel] = useState<number | null>(null);
  const [ucSortieManuel, setUcSortieManuel] = useState<number | null>(null);
  const [retroManuel, setRetroManuel] = useState<number | null>(null);
  // Rémunération cabinet : par défaut dérivée du barème « Mon cabinet » (quand un
  // contrat est passé en lien profond) ou des taux de place ; surchargeable à la
  // main (null = valeur dérivée). commManuel = commission d'entrée cabinet,
  // contractFeeManuel = part des frais de gestion du contrat reversée.
  const [commManuel, setCommManuel] = useState<number | null>(null);
  const [contractFeeManuel, setContractFeeManuel] = useState<number | null>(null);
  // Honoraires de conseil (facturation directe, hors rétrocession) : forfait € et
  // récurrent %/an. Préremplis du barème « Mon cabinet », surchargeables (null).
  const [honoraireForfaitManuel, setHonoraireForfaitManuel] = useState<number | null>(null);
  const [honoraireAnnuelManuel, setHonoraireAnnuelManuel] = useState<number | null>(null);
  const [ucs, setUcs] = useState<UcRow[]>([]);
  // Export PDF (document client conforme DDA / fiche interne cabinet).
  const [clientRef, setClientRef] = useState("");
  const [exporting, setExporting] = useState<null | "client" | "cabinet">(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const setF = (k: keyof FeeParams) => (v: number) => setFrais((f) => ({ ...f, [k]: v }));

  // Ajout d'un support par recherche : détail rechargé depuis /api/funds.
  const addUC = async (isin: string, name: string) => {
    setUcs((prev) => {
      if (prev.length >= MAX_UC || prev.some((u) => u.isin === isin)) return prev;
      const poids = prev.length ? prev.reduce((a, u) => a + u.poids, 0) / prev.length : 100;
      return [...prev, toUcRow(isin, name, poids, null)];
    });
    const f = await fetchFund(isin);
    if (!f) return;
    setUcs((prev) => prev.map((u) => (u.isin !== isin ? u : toUcRow(isin, u.name, u.poids, f))));
  };

  // Support déposé via fiche/DICI : frais extraits, enrichis si le fonds est en
  // base (perf 5 ans, rétrocession réelle). Sinon, on garde les frais du DICI.
  const addDiciSupport = async (s: DiciSupport) => {
    setUcs((prev) => {
      if (prev.length >= MAX_UC || prev.some((u) => u.isin === s.isin)) return prev;
      const poids = prev.length ? prev.reduce((a, u) => a + u.poids, 0) / prev.length : 100;
      return [...prev, {
        isin: s.isin, name: s.name, poids,
        perf5y: null, ter: s.ter, entryFee: s.entryFee, exitFee: s.exitFee, retro: null,
      }];
    });
    if (!s.matchedIsin) return;
    const f = await fetchFund(s.matchedIsin);
    if (f) setUcs((prev) => prev.map((u) => (u.isin !== s.isin ? u : toUcRow(s.isin, u.name, u.poids, f))));
  };

  // Charge un portefeuille (paramètres d'URL ou relevé déposé) : sépare le fonds
  // euros (son poids bascule vers le compartiment euros), renormalise les UC à
  // 100 % du compartiment UC, et cale le versement initial sur le total.
  const loadPortfolio = async (
    items: { isin: string; name: string; weight: number }[],
    montant: number | null,
  ) => {
    if (montant != null && Number.isFinite(montant) && montant > 0) setVersementInitial(Math.round(montant));
    const fetched = await Promise.all(items.map(async (h) => ({ h, f: await fetchFund(h.isin) })));
    const total = fetched.reduce((a, x) => a + Math.max(0, x.h.weight), 0);
    if (!(total > 0)) return;
    const enUC = fetched.filter((x) => x.f?.product_type !== "fonds_euros");
    const totalUC = enUC.reduce((a, x) => a + Math.max(0, x.h.weight), 0);
    setPartUC(Math.round((totalUC / total) * 100));
    setUcs(enUC.slice(0, MAX_UC).map(({ h, f }) =>
      toUcRow(h.isin, f?.name ?? h.name ?? h.isin, totalUC > 0 ? Math.round((h.weight / totalUC) * 1000) / 10 : 0, f),
    ));
  };

  const addPortfolio = (holdings: DepositedHolding[]) => {
    const total = holdings.reduce((a, h) => a + Math.max(0, h.amount), 0);
    loadPortfolio(holdings.map((h) => ({ isin: h.isin, name: h.name, weight: h.amount })), total);
  };

  // Préremplissage depuis un autre onglet : /simulateur?isins=&weights=&montant=
  const searchParams = useSearchParams();
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    const holdings = parsePortfolioParams(searchParams.get("isins"), searchParams.get("weights"));
    if (holdings.length === 0) return;
    const montant = Number(searchParams.get("montant"));
    loadPortfolio(
      holdings.map((h) => ({ isin: h.isin, name: h.isin, weight: h.weight })),
      Number.isFinite(montant) ? montant : null,
    );
  }, [searchParams]);

  const removeUC = (isin: string) => setUcs((prev) => prev.filter((u) => u.isin !== isin));
  const setPoids = (isin: string, poids: number) =>
    setUcs((prev) => prev.map((u) => (u.isin === isin ? { ...u, poids: Math.max(0, poids) } : u)));

  // Rendement & frais des supports : réels pondérés, surchargeables.
  const perfPonderee = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: u.perf5y, poids: u.poids }))), [ucs]);
  const rendementUC = rendementUCManuel ?? perfPonderee ?? RENDEMENT_UC_DEFAUT;
  const terPondere = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: u.ter, poids: u.poids }))), [ucs]);
  const entreePonderee = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: u.entryFee, poids: u.poids }))), [ucs]);
  const sortiePonderee = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: u.exitFee, poids: u.poids }))), [ucs]);
  const ucGestion = terManuel ?? terPondere ?? FRAIS_DEFAUT.ucGestion;
  const ucEntree = ucEntreeManuel ?? entreePonderee ?? FRAIS_DEFAUT.ucEntree;
  const ucSortie = ucSortieManuel ?? sortiePonderee ?? FRAIS_DEFAUT.ucSortie;

  // Barème « Mon cabinet » : si un contrat est passé en lien profond
  // (?contract=Assureur::Contrat), on résout la convention et on en DÉRIVE la
  // rémunération (rétro par la cascade, commission d'entrée, part gestion
  // contrat). Le simulateur s'aligne alors sur les mêmes taux que le bloc
  // « Coût client & rémunération » du portefeuille. Sans contrat : taux de place.
  const contractKey = searchParams.get("contract");
  const convention = useMemo(
    () => (contractKey && contractKey.includes("::") ? cabinetContract(loadStoredCabinet(), contractKey) : null),
    [contractKey],
  );

  // Rétrocession effective d'un support (%/an) : cascade du barème (exception
  // fonds → taux UC du contrat → repli du fonds) si convention, sinon rétro du fonds.
  const effRetroPct = useCallback((u: UcRow): number | null => {
    if (convention) {
      const frac = resolveFundRetrocession(
        convention, u.isin, u.ter != null ? u.ter / 100 : null, u.retro != null ? u.retro / 100 : null,
      );
      return frac != null ? Math.round(frac * 1e4) / 1e2 : null;
    }
    return u.retro ?? null;
  }, [convention]);

  // Rétrocession pondérée : cascade du barème (si convention) ou réelle des
  // supports, sinon estimation de place (50 % du TER).
  const retroPonderee = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: effRetroPct(u), poids: u.poids }))), [ucs, effRetroPct]);
  const retroEstimee = Math.round(ucGestion * 0.5 * 100) / 100;
  const retroCgp = retroManuel ?? retroPonderee ?? retroEstimee;

  // Commission d'entrée cabinet : convention (entryFeeShare) sinon frais d'entrée du contrat.
  const commissionCabinet = commManuel ?? (
    convention?.entryFeeShare != null ? Math.round(convention.entryFeeShare * 1e4) / 1e2 : frais.contratEntree
  );
  // Part des frais de gestion du contrat reversée au cabinet (%/an) : convention (contractFeeShare) sinon 0.
  const contractFeeShare = contractFeeManuel ?? (
    convention?.contractFeeShare != null ? Math.round(convention.contractFeeShare * 1e4) / 1e2 : 0
  );

  // Honoraires de conseil (facturation directe, hors rétrocession) : préremplis
  // du barème « Mon cabinet » (forfait € + récurrent %/an de l'encours).
  const cabinetHonoraires = useMemo(() => {
    const cab = loadStoredCabinet();
    return {
      forfait: cab.honoraireForfait,
      annuelPct: cab.honoraireAnnuel != null ? Math.round(cab.honoraireAnnuel * 1e4) / 1e2 : null,
    };
  }, []);
  const honoraireForfait = honoraireForfaitManuel ?? cabinetHonoraires.forfait ?? 0;
  const honoraireAnnuelPct = honoraireAnnuelManuel ?? cabinetHonoraires.annuelPct ?? 0;

  const input: SimulationInput = useMemo(() => ({
    versementInitial, versementAnnuel, dureeAnnees: duree, partUC,
    rendementUC, rendementFE,
    frais: { ...frais, ucGestion, ucEntree, ucSortie },
    retroCgp, commissionCabinet, contractFeeShare,
  }), [versementInitial, versementAnnuel, duree, partUC, rendementUC, rendementFE, frais, ucGestion, ucEntree, ucSortie, retroCgp, commissionCabinet, contractFeeShare]);

  const horizons = useMemo(
    () => Array.from(new Set([...HORIZONS_DEFAUT, duree])).filter((h) => h <= duree).sort((a, b) => a - b), [duree]);
  const sim = useMemo(() => simulate(input, horizons), [input, horizons]);
  const final = sim.horizons[sim.horizons.length - 1];
  const finalPoint = final ? sim.points[final.annees] : null;
  const repart = final && finalPoint
    ? repartitionFrais(finalPoint.fraisCumules, final, finalPoint.retroCgpCumulee, finalPoint.commCabinetCumulee, finalPoint.contractFeeCumulee)
    : null;

  const remuTotale = final ? final.retroCgpCumulee + final.commCabinetCumulee + final.contractFeeCumulee : 0;

  // Honoraires cumulés sur l'horizon : forfait (une fois) + honoraire annuel
  // appliqué à l'encours de chaque année. Facturés en SUS des frais du contrat,
  // 100 % revenu cabinet → consolidés avec les rétrocessions (« revenu total »).
  const honoraireCumule = useMemo(() => {
    if (!final) return 0;
    const annuel = sim.points
      .slice(1, final.annees + 1)
      .reduce((s, p) => s + p.valeurNette * (honoraireAnnuelPct / 100), 0);
    return Math.round((honoraireForfait + annuel) * 100) / 100;
  }, [sim, final, honoraireForfait, honoraireAnnuelPct]);
  const revenuCabinetTotal = remuTotale + honoraireCumule;

  // Courbe de rémunération cumulée du cabinet : upfront + rétrocessions.
  const remuCurve = useMemo(() => sim.points.map((p) => ({
    annee: p.annee,
    upfront: p.commCabinetCumulee,
    retro: p.retroCgpCumulee,
  })), [sim]);

  const valeurCurve = useMemo(() => sim.points.map((p) => ({
    annee: p.annee,
    nette: p.valeurNette,
    sansFrais: p.valeurSansFrais,
    versements: p.versementsCumules,
  })), [sim]);

  const ucIsins = useMemo(() => new Set(ucs.map((u) => u.isin)), [ucs]);

  // Détail par support : montant alloué (part UC × poids) → rémunération.
  const totalPoids = ucs.reduce((a, u) => a + Math.max(0, u.poids), 0) || 1;
  const ucPot = versementInitial * (partUC / 100);
  const supportRows = ucs.map((u) => {
    const montant = ucPot * (Math.max(0, u.poids) / totalPoids);
    // Cascade du barème si convention (aligné sur le portefeuille), sinon rétro
    // du fonds ; repli sur le taux agrégé quand rien n'est exploitable.
    const effRetro = effRetroPct(u) ?? retroCgp;
    const remu = remunerationSupport(montant, effRetro, commissionCabinet);
    return { u, montant, effRetro, ...remu };
  });
  const remuAnnuelleTotale = supportRows.reduce((a, r) => a + r.retroAnnuelle, 0);
  const upfrontTotal = supportRows.reduce((a, r) => a + r.commissionUpfront, 0);

  // Génère et télécharge le document de frais (mode client ou cabinet). 100 %
  // déterministe côté serveur (aucun appel IA) : on POST l'entrée de simulation
  // et les supports, la route renvoie le PDF.
  const exportPdf = async (mode: "client" | "cabinet") => {
    if (!final || exporting) return;
    setExporting(mode);
    setExportError(null);
    try {
      const res = await fetch("/api/frais/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          clientRef: clientRef.trim() || null,
          input,
          honoraires: { forfait: honoraireForfait, cumule: honoraireCumule },
          supports: ucs.map((u) => ({
            isin: u.isin, name: u.name, poids: u.poids,
            ter: u.ter, entryFee: u.entryFee, retro: u.retro,
          })),
        }),
      });
      if (!res.ok) {
        setExportError("Génération du document impossible. Réessayez dans un instant.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().split("T")[0];
      a.download = `frais-${mode}-${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Génération du document impossible. Réessayez dans un instant.");
    } finally {
      setExporting(null);
    }
  };

  const portfolioHref = useMemo(() => {
    if (!ucs.length) return null;
    const isins = ucs.map((u) => u.isin).join(",");
    const weights = ucs.map((u) => Math.round(u.poids * 10) / 10).join(",");
    return `/portefeuille/analyser?isins=${isins}&weights=${weights}&montant=${Math.round(versementInitial)}`;
  }, [ucs, versementInitial]);

  return (
    <PageShell>
      <div className="space-y-9">
        {/* ══ Étape 1 · Vos supports ══ */}
        <section>
          <StepHeader n={1} title="Vos supports" />
          <Card className="px-5 py-5">
            <SupportSources
              onAddFund={addUC}
              existingIsins={ucIsins}
              full={ucs.length >= MAX_UC}
              onAddPortfolio={addPortfolio}
              onAddDiciSupport={addDiciSupport}
            />
            {ucs.length > 0 && (
              <div className="space-y-3 mt-4 pt-4 border-t border-line-soft">
                {ucs.map((u) => (
                  <div key={u.isin}>
                    <div className="flex items-center gap-2">
                      <Link href={`/fonds/${u.isin}`} className="flex-1 min-w-0 text-meta text-ink truncate hover:text-accent-ink hover:underline" title={u.name}>
                        {u.name}
                      </Link>
                      <input type="number" min={0} max={100} value={Math.round(u.poids * 10) / 10}
                        onChange={(e) => setPoids(u.isin, num(e.target.value))}
                        className={`w-14 text-right text-meta tabular-nums border border-line rounded-md px-1.5 py-1 bg-paper focus:outline-none focus:border-accent ${NUM_INPUT}`} />
                      <span className="text-meta text-muted w-3">%</span>
                      <button onClick={() => removeUC(u.isin)} className="text-muted hover:text-danger transition-colors" aria-label="Retirer">
                        <X size={13} />
                      </button>
                    </div>
                    <p className="text-caption text-muted-2 mt-1 font-mono">
                      {u.isin}
                      <span className="font-sans text-muted"> · frais courants {pct(u.ter)}{u.retro != null && <> · rétro {pct(u.retro)}</>}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        {/* ══ Étape 2 · Paramètres de l'étude ══ */}
        <section>
          <StepHeader n={2} title="Paramètres de l'étude" />
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <Card className="px-5 py-5 space-y-3">
              <H2>Versement & horizon</H2>
              <FieldEur label="Versement initial" value={versementInitial} onChange={setVersementInitial} step={1000} />
              <FieldEur label="Versement annuel" value={versementAnnuel} onChange={setVersementAnnuel} step={500} />
              <div>
                <span className="text-meta text-ink-2 block mb-1.5">Durée</span>
                <div className="flex flex-wrap gap-2">
                  {DUREES.map((d) => (
                    <Chip key={d} active={duree === d} onClick={() => setDuree(d)}>
                      {d} ans
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-meta text-ink-2">Part unités de compte</span>
                  <span className="text-meta tabular-nums text-ink font-medium">{partUC} %</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={partUC}
                  onChange={(e) => setPartUC(Number(e.target.value))}
                  className="w-full accent-[#B0613F]" aria-label="Part unités de compte" />
              </div>
              <FieldPct label="Taux fonds euros (net)" value={rendementFE} onChange={setRendementFE} />
              <label className="flex items-center justify-between gap-2">
                <span className="text-meta text-ink-2">
                  Rendement UC (net, %/an)
                  {rendementUCManuel == null && perfPonderee != null && (
                    <span className="text-caption text-muted block">perf 5 ans réelle pondérée</span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <input type="number" step={0.1} value={rendementUC}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRendementUCManuel(Number.isFinite(v) ? v : null);
                    }}
                    className={`w-16 text-right text-meta tabular-nums border border-line rounded-md px-1.5 py-1 bg-paper focus:outline-none focus:border-accent ${NUM_INPUT}`} />
                  <span className="text-meta text-muted w-3">%</span>
                </span>
              </label>
            </Card>

            <Card className="px-5 py-5 space-y-3">
              <H2>Ma rémunération (cabinet)</H2>
              {convention && (
                <p className="text-caption text-muted-2 -mt-1">
                  Selon vos conventions « Mon cabinet » pour {contractKey?.split("::")[1]} (surchargeable).
                </p>
              )}
              <FieldPct label="Rétrocession (par an)" value={retroCgp} onChange={setRetroManuel}
                note={retroManuel != null ? undefined
                  : convention ? "taux de votre convention (cascade)"
                  : retroPonderee != null ? "taux réel pondéré des supports"
                  : "estimation : 50 % des frais courants"} />
              <FieldPct label="Commission d'entrée cabinet" value={commissionCabinet} onChange={setCommManuel}
                note={commManuel == null && convention?.entryFeeShare != null
                  ? "frais d'entrée reversés (votre convention)"
                  : "part des frais d'entrée reversée au cabinet"} />
              <FieldPct label="Part gestion contrat (par an)" value={contractFeeShare} onChange={setContractFeeManuel}
                note={contractFeeManuel == null && convention?.contractFeeShare != null
                  ? "part des frais de gestion contrat (votre convention)"
                  : "part des frais de gestion du contrat reversée"} />
              <div className="pt-2 mt-1 border-t border-line-soft space-y-3">
                <p className="text-caption text-muted-2">Honoraires de conseil (facturés en sus, hors rétrocession)</p>
                <FieldEur label="Forfait (ponctuel)" value={honoraireForfait} onChange={setHonoraireForfaitManuel} step={100} />
                <FieldPct label="Récurrent (par an)" value={honoraireAnnuelPct} onChange={setHonoraireAnnuelManuel}
                  note={honoraireAnnuelManuel == null && cabinetHonoraires.annuelPct != null
                    ? "votre barème « Mon cabinet »" : "% de l'encours par an"} />
              </div>
            </Card>

            <Card className="px-5 py-5 space-y-3">
              <H2>Frais du contrat</H2>
              <FieldPct label="Entrée / versement" value={frais.contratEntree} onChange={setF("contratEntree")} />
              <FieldPct label="Gestion UC (par an)" value={frais.contratGestionUC} onChange={setF("contratGestionUC")} />
              <FieldPct label="Gestion fonds euros (par an)" value={frais.contratGestionFE} onChange={setF("contratGestionFE")} />
              <FieldPct label="Sortie / rachat" value={frais.contratSortie} onChange={setF("contratSortie")} />
            </Card>

            <Card className="px-5 py-5 space-y-3">
              <H2>Frais des supports</H2>
              <FieldPct label="Entrée" value={ucEntree} onChange={setUcEntreeManuel}
                note={ucEntreeManuel == null && entreePonderee != null ? "pondéré des supports" : undefined} />
              <FieldPct label="Frais courants (par an)" value={ucGestion} onChange={setTerManuel}
                note={terManuel == null && terPondere != null ? "TER pondéré des supports" : undefined} />
              <FieldPct label="Sortie" value={ucSortie} onChange={setUcSortieManuel}
                note={ucSortieManuel == null && sortiePonderee != null ? "pondéré des supports" : undefined} />
            </Card>
          </div>
        </section>

        {/* ══ Étape 3 · Résultats ══ */}
        <section>
          <StepHeader n={3} title="Résultats" />

          {final && (
            <Card className="px-5 py-4 mb-5">
              <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                <label className="flex-1 min-w-0">
                  <span className="text-caption text-muted block mb-1">Référence client (facultatif)</span>
                  <input
                    type="text" value={clientRef} onChange={(e) => setClientRef(e.target.value)}
                    placeholder="M. et Mme Dupont — contrat n°…"
                    className="w-full text-meta border border-line rounded-md px-2.5 py-1.5 bg-paper focus:outline-none focus:border-accent"
                  />
                </label>
                <div className="flex items-center gap-2 shrink-0">
                  <Btn variant="primary" size="sm" loading={exporting === "client"}
                    disabled={exporting !== null} onClick={() => exportPdf("client")}>
                    <Download size={14} /> Document client
                  </Btn>
                  <Btn variant="outline" size="sm" loading={exporting === "cabinet"}
                    disabled={exporting !== null} onClick={() => exportPdf("cabinet")}>
                    <Download size={14} /> Fiche cabinet
                  </Btn>
                </div>
              </div>
              <p className="text-caption text-muted-2 mt-2">
                Le <span className="text-ink-2">document client</span> présente les coûts et la transparence des frais de conseil (DDA). La{" "}
                <span className="text-ink-2">fiche cabinet</span> ajoute le détail de votre rémunération — usage interne.
              </p>
              {exportError && <p className="text-caption text-danger mt-1">{exportError}</p>}
            </Card>
          )}

          {final && (
            <div className="flex flex-col md:flex-row gap-3 mb-5">
              <Kpi label={`Rémunération cabinet à ${final.annees} ans`} value={EUR.format(remuTotale)} tone="ok" />
              <Kpi label="Coût total client" value={EUR.format(final.totalFrais)} />
              <Kpi label={`Valeur nette à ${final.annees} ans`} value={EUR.format(final.valeurNette)} />
              <Kpi label="Gain net client" value={EUR.format(final.gainNet)} tone={final.gainNet >= 0 ? "ok" : "bad"} />
              <Kpi label="Frais / gain brut"
                value={partFraisDansGainBrut(final) == null ? "—" : pct(partFraisDansGainBrut(final))} />
            </div>
          )}

          <div className="space-y-5">
          <Card className="px-5 py-5">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <H2 className="">Ma rémunération</H2>
              {final && <span className="text-meta text-ok font-medium tabular-nums">{EUR.format(remuTotale)}</span>}
            </div>
            {final && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg border border-line-soft px-3 py-2.5">
                  <p className="text-caption text-muted">Rétrocessions cumulées</p>
                  <p className="text-meta text-ink font-medium tabular-nums mt-0.5">{EUR.format(final.retroCgpCumulee)}</p>
                  <p className="text-caption text-muted-2 tabular-nums">≈ {EUR.format(final.retroCgpCumulee / final.annees)}/an</p>
                </div>
                <div className="rounded-lg border border-line-soft px-3 py-2.5">
                  <p className="text-caption text-muted">Commission d'entrée</p>
                  <p className="text-meta text-ink font-medium tabular-nums mt-0.5">{EUR.format(final.commCabinetCumulee)}</p>
                  <p className="text-caption text-muted-2">à la souscription</p>
                </div>
                {final.contractFeeCumulee > 0 && (
                  <div className="rounded-lg border border-line-soft px-3 py-2.5">
                    <p className="text-caption text-muted">Part gestion contrat</p>
                    <p className="text-meta text-ink font-medium tabular-nums mt-0.5">{EUR.format(final.contractFeeCumulee)}</p>
                    <p className="text-caption text-muted-2 tabular-nums">≈ {EUR.format(final.contractFeeCumulee / final.annees)}/an</p>
                  </div>
                )}
                {honoraireCumule > 0 && (
                  <div className="rounded-lg border border-line-soft px-3 py-2.5">
                    <p className="text-caption text-muted">Honoraires de conseil</p>
                    <p className="text-meta text-ink font-medium tabular-nums mt-0.5">{EUR.format(honoraireCumule)}</p>
                    <p className="text-caption text-muted-2">facturés en sus (hors rétro)</p>
                  </div>
                )}
              </div>
            )}
            {final && honoraireCumule > 0 && (
              <div className="flex items-baseline justify-between gap-3 mb-4 rounded-lg bg-accent-soft/40 px-3 py-2.5">
                <p className="text-meta text-ink-2 font-medium">Revenu cabinet total (commissions + honoraires)</p>
                <span className="text-meta text-ok font-semibold tabular-nums">{EUR.format(revenuCabinetTotal)}</span>
              </div>
            )}
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={remuCurve} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#DFDEDA" />
                <XAxis dataKey="annee" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false}
                  tickFormatter={(v: number) => `${v} an${v > 1 ? "s" : ""}`} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false}
                  width={56} tickFormatter={(v: number) => EUR.format(v)} />
                <Tooltip
                  formatter={(v: unknown, n: unknown) => [typeof v === "number" ? EUR.format(v) : "—",
                    n === "retro" ? "Rétrocessions" : "Commission d'entrée"]}
                  labelFormatter={(l: unknown) => `Année ${l}`}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }} />
                <Legend formatter={(v: string) => <span style={{ fontSize: 11 }}>{v === "retro" ? "Rétrocessions" : "Commission d'entrée"}</span>} />
                <Area type="monotone" dataKey="upfront" stackId="r" stroke="#7A5C3E" fill="#7A5C3E" fillOpacity={0.35} />
                <Area type="monotone" dataKey="retro" stackId="r" stroke="#B0613F" fill="#B0613F" fillOpacity={0.55} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card className="px-5 py-5 overflow-x-auto">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <H2 className="">Détail par support</H2>
              {portfolioHref && (
                <Link href={portfolioHref} className="text-caption text-accent-ink hover:underline whitespace-nowrap inline-flex items-center gap-1">
                  Analyse complète <ArrowRight size={12} />
                </Link>
              )}
            </div>
            {supportRows.length === 0 ? (
              <p className="text-caption text-muted">Ajoutez des supports (recherche, relevé ou fiche) pour voir la rémunération ligne par ligne.</p>
            ) : (
              <table className="w-full text-meta tabular-nums">
                <thead>
                  <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
                    <th className="text-left py-2 font-semibold">Support</th>
                    <th className="text-right py-2 font-semibold">Frais cour.</th>
                    <th className="text-right py-2 font-semibold">Entrée</th>
                    <th className="text-right py-2 font-semibold">Rétro</th>
                    <th className="text-right py-2 font-semibold">Rétro /an</th>
                    <th className="text-right py-2 font-semibold">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {supportRows.map(({ u, effRetro, retroAnnuelle, commissionUpfront }) => (
                    <tr key={u.isin} className="border-b border-line-soft last:border-0">
                      <td className="py-1.5 text-ink-2 max-w-[200px] truncate">
                        <Link href={`/fonds/${u.isin}`} className="hover:text-accent-ink hover:underline" title={u.name}>{u.name}</Link>
                      </td>
                      <td className="py-1.5 text-right text-ink-2">{pct(u.ter)}</td>
                      <td className="py-1.5 text-right text-ink-2">{pct(u.entryFee)}</td>
                      <td className="py-1.5 text-right text-ink-2">{pct(effRetro)}{u.retro == null && <span className="text-muted-2"> *</span>}</td>
                      <td className="py-1.5 text-right text-ok font-medium">{EUR.format(retroAnnuelle)}</td>
                      <td className="py-1.5 text-right text-ok">{EUR.format(commissionUpfront)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line font-medium">
                    <td className="py-2 text-ink">Total</td>
                    <td /><td /><td />
                    <td className="py-2 text-right text-ok">{EUR.format(remuAnnuelleTotale)}</td>
                    <td className="py-2 text-right text-ok">{EUR.format(upfrontTotal)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {supportRows.some((r) => r.u.retro == null) && (
              <p className="text-caption text-muted-2 mt-2">* rétrocession non connue en base : taux effectif du contrat appliqué.</p>
            )}
          </Card>

          {repart && final && (
            <Card className="px-5 py-5">
              <H2>Où va le coût de la structure ?</H2>
              <div className="space-y-2.5">
                {[
                  { nom: "Assureur", montant: repart.assureur },
                  { nom: "Société de gestion", montant: repart.societeGestion },
                  { nom: "Votre cabinet (CGP)", montant: repart.cabinet, mine: true },
                ].map(({ nom, montant, mine }) => {
                  const part = final.totalFrais > 0 ? (montant / final.totalFrais) * 100 : 0;
                  return (
                    <div key={nom} className="flex items-center justify-between gap-4 border-b border-line-soft last:border-0 pb-2.5 last:pb-0">
                      <p className={`text-meta ${mine ? "text-ok font-medium" : "text-ink"}`}>{nom}</p>
                      <div className="text-right shrink-0">
                        <span className={`text-meta font-medium tabular-nums ${mine ? "text-ok" : "text-ink"}`}>{EUR.format(montant)}</span>
                        <span className="text-caption text-muted tabular-nums ml-2">{pct(part)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card className="px-5 py-5">
            <H2>Valeur du contrat</H2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={valeurCurve} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#DFDEDA" />
                <XAxis dataKey="annee" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false}
                  tickFormatter={(v: number) => `${v} an${v > 1 ? "s" : ""}`} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false}
                  width={56} tickFormatter={(v: number) => EUR.format(v)} domain={["auto", "auto"]} />
                <Tooltip
                  formatter={(v: unknown, n: unknown) => [typeof v === "number" ? EUR.format(v) : "—",
                    n === "nette" ? "Valeur nette client" : n === "sansFrais" ? "Brut (avant frais)" : "Versements"]}
                  labelFormatter={(l: unknown) => `Année ${l}`}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }} />
                <Legend formatter={(v: string) => <span style={{ fontSize: 11 }}>
                  {v === "nette" ? "Valeur nette client" : v === "sansFrais" ? "Brut (avant frais)" : "Versements"}</span>} />
                <Line type="monotone" dataKey="sansFrais" stroke="#8A8780" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                <Line type="monotone" dataKey="nette" stroke="#B0613F" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="versements" stroke="#DFDEDA" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="px-5 py-5 overflow-x-auto">
            <H2>Projections</H2>
            <table className="w-full text-meta tabular-nums">
              <thead>
                <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
                  <th className="text-left py-2 font-semibold">Horizon</th>
                  <th className="text-right py-2 font-semibold">Valeur nette</th>
                  <th className="text-right py-2 font-semibold">Gain net</th>
                  <th className="text-right py-2 font-semibold">Total frais</th>
                  <th className="text-right py-2 font-semibold">Rému cabinet</th>
                </tr>
              </thead>
              <tbody>
                {sim.horizons.map((h) => (
                  <tr key={h.annees} className="border-b border-line-soft last:border-0">
                    <td className="py-1.5 text-ink-2">{h.annees} ans</td>
                    <td className="py-1.5 text-right text-ink font-medium">{EUR.format(h.valeurNette)}</td>
                    <td className={`py-1.5 text-right ${h.gainNet >= 0 ? "text-ok" : "text-danger"}`}>
                      {h.gainNet >= 0 ? "+" : ""}{EUR.format(h.gainNet)}
                    </td>
                    <td className="py-1.5 text-right text-ink-2">{EUR.format(h.totalFrais)}</td>
                    <td className="py-1.5 text-right text-ok">{EUR.format(h.retroCgpCumulee + h.commCabinetCumulee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
