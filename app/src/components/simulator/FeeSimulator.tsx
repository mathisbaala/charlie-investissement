"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Btn } from "@/components/ui/Btn";
import { PageShell } from "@/components/ui/Page";
import { X, ArrowRight, Download, ChevronDown } from "@/components/ui/icons";
import { pct, feeFracToPct, CONTRACT_FEE_DEFAULTS } from "@/lib/format";
import { parsePortfolioParams } from "@/lib/portfolio";
import { CHART_GRID, CHART_AXIS } from "@/lib/chartColors";
import {
  simulate, rendementPondere, repartitionFrais, reductionRendementAnnuelle,
  remunerationSupport, projectionSeries, tauxRetrocessionMoyen, HORIZONS_DEFAUT,
  type FeeParams, type SimulationInput, type ProjectionPoint,
} from "@/lib/feeSimulator";
import { SupportSources, type DepositedHolding, type ImportedLine } from "./SupportSources";
import { loadStoredCabinet, cabinetContract, resolveFundRetrocession, EMPTY_CABINET } from "@/lib/cabinet";
import { retroFallbackFrac } from "@/lib/remuneration";
import type { ReleveContractMatch } from "@/lib/releve";

/**
 * Contrat retenu automatiquement à l'import d'un relevé : seulement quand UN
 * contrat ressort avec une couverture forte ET nettement dominante sur le 2e
 * candidat. Sinon null (relevé multi-contrats ou ambigu) → l'utilisateur reste
 * en saisie manuelle. Les `matches` sont déjà triés par couverture décroissante.
 */
export function pickConfidentContract(matches: ReleveContractMatch[]): string | null {
  const top = matches?.[0];
  if (!top || top.coverage < 0.7) return null;
  const second = matches[1];
  if (second && top.coverage - second.coverage < 0.25) return null;
  return `${top.company}::${top.contract}`;
}

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
// Part des frais d'entrée acquise à l'assureur (non reversée au cabinet), en
// l'absence de convention chargée : le CGP touche « frais d'entrée − cette
// part ». Convention de place ~0,5 % (jusqu'à 1 %). Éditable via le champ rému.
const PART_INCOMPRESSIBLE_ASSUREUR = 0.5;
// Rétrocession fonds euros ESTIMÉE (%/an d'encours €), repli honnête tant qu'aucune
// convention ne fixe le taux — symétrique de l'estimation UC (50 % du TER). Norme de
// place ~0,10 % pour un fonds euros classique (le fonds euros rétrocède peu, mais pas
// « rien »). Écrasée par le barème « Mon cabinet » ou une saisie manuelle.
const EUROS_RETRO_ESTIMEE = 0.1;

// Support (UC) enrichi depuis /api/funds : perf 5 ans annualisée + frais.
interface UcRow {
  isin: string;
  name: string;
  poids: number;               // % du compartiment UC
  perf5y: number | null;       // %/an, net des frais courants (VL réelle)
  ter: number | null;          // % (frais courants)
  entryFee: number | null;     // %
  exitFee: number | null;      // %
  retro: number | null;        // %/an — rétrocession CGP (base, null = inconnue)
  productType: string | null;  // etf / opcvm / … (pour la règle passif → rétro 0)
  managementStyle: string | null; // actif / passif / indiciel (idem)
}

interface ApiFund {
  isin: string; name?: string | null; product_type?: string | null;
  performance_5y?: number | null; ter?: number | null; ongoing_charges?: number | null;
  entry_fee_max?: number | null; exit_fee_max?: number | null; retrocession_cgp?: number | null;
  management_style?: string | null;
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
  productType: f?.product_type ?? null,
  managementStyle: f?.management_style ?? null,
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

// Tiroir repliable — un groupe de réglages de la colonne gauche. En-tête
// cliquable (titre + chevron), corps masquable. Compacte la colonne : on ouvre
// seulement les leviers qu'on veut ajuster, et l'impact se lit à droite.
function Drawer({
  title, defaultOpen = false, bodyClassName = "space-y-3", children,
}: {
  title: string; defaultOpen?: boolean; bodyClassName?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="px-5 py-4">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-subhead text-ink" style={{ fontFamily: "var(--font-sans)" }}>{title}</span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className={`mt-3 ${bodyClassName}`}>{children}</div>}
    </Card>
  );
}

// ── Présentation des résultats (colonne droite) ────────────────────────────

// Rampe monochrome clay → sable (désaturée, dans l'esprit « seul l'accent porte
// la couleur »). Le vert `ok` n'apparaît QUE pour marquer la part du cabinet
// parmi des tiers (onglet Bénéficiaires) — pas dans les rampes.
const SEG_CLAY = [
  "oklch(0.47 0.095 40)", // clay (accent)
  "oklch(0.58 0.078 42)", // clay clair
  "oklch(0.69 0.055 44)", // clay pâle
  "oklch(0.79 0.035 46)", // sable
  "oklch(0.62 0.006 90)", // gris neutre
];

interface BarSegment { label: string; value: number; color: string; strong?: boolean }

// Barre empilée unique + légende : remplace une liste de lignes par UN objet
// visuel qui montre les proportions d'un coup d'œil. Les étiquettes vivent dans
// la légende (jamais dans les segments) → pas de collision quand un poste écrase
// les autres. Proportions normalisées sur la somme des segments (la barre
// remplit toujours 100 %). Vide si aucun montant.
function StackedBar({ segments }: { segments: BarSegment[] }) {
  const shown = segments.filter((s) => s.value > 0);
  const total = shown.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-3.5">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-line-soft"
        role="img"
        aria-label={shown.map((s) => `${s.label} : ${Math.round((s.value / total) * 100)} %`).join(", ")}
      >
        {shown.map((s) => (
          <div
            key={s.label}
            className="h-full"
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.label} · ${EUR.format(s.value)}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2">
        {shown.map((s) => (
          <li key={s.label} className="flex items-center gap-2 min-w-0">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            <span className={`text-meta truncate ${s.strong ? "text-ink font-medium" : "text-ink-2"}`} title={s.label}>{s.label}</span>
            <span className="ml-auto shrink-0 flex items-baseline gap-2">
              <span className={`text-meta tabular-nums ${s.strong ? "text-ink font-medium" : "text-ink"}`}>{EUR.format(s.value)}</span>
              <span className="text-caption text-muted tabular-nums w-9 text-right">{Math.round((s.value / total) * 100)} %</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Sélecteur de vue (onglets pilule, motif aligné sur NavChart). Navigation
// clavier native (vrais <button role=tab>). Générique sur la clé.
function Segmented<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[]; value: T; onChange: (k: T) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-line bg-paper-2 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.key} type="button" role="tab" aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-2.5 py-1 text-label font-medium transition-all ${
            value === o.key ? "border border-line bg-paper text-ink shadow-sm" : "border border-transparent text-muted hover:text-ink-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Révélation à la demande : le détail exhaustif (tableaux) reste replié pour ne
// pas rallonger la page — un clic l'ouvre.
function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-line-soft pt-3">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex items-center gap-1.5 text-caption text-accent-ink hover:underline"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        {summary}
      </button>
      {open && <div className="mt-3 overflow-x-auto">{children}</div>}
    </div>
  );
}

const LegendDot = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
    {label}
  </span>
);

// Format compact et HOMOGÈNE pour les axes du graphe : toujours en milliers
// (« k »), une décimale seulement sous 10 k — sinon recharts peut tomber sur des
// graduations à pas de 700 et l'on afficherait « 700 » à côté de « 1 k / 2 k ».
const eurAxis = (v: number) =>
  v === 0 ? "0" : `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: Math.abs(v) < 10_000 ? 1 : 0 })} k`;

function ProjTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: number | string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2 text-caption shadow-sm">
      <p className="mb-1 text-muted">{label} an{Number(label) > 1 ? "s" : ""}</p>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
            <span className="text-ink-2">{p.name}</span>
            <span className="ml-auto pl-3 tabular-nums font-medium text-ink">{EUR.format(p.value ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Graphe de projection : 3 courbes. L'encours (grand) sur l'axe gauche ; le coût
// client cumulé et la rému cabinet cumulée (petits, même ordre de grandeur) sur
// l'axe droit — sinon ils s'écraseraient au ras du zéro. Rému cabinet en vert,
// trait plus épais (la star, priorité cabinet).
function ProjectionChart({ data }: { data: ProjectionPoint[] }) {
  if (data.length < 2) {
    return <p className="text-caption text-muted">Augmentez la durée pour visualiser la projection.</p>;
  }
  const axisTick = { fontSize: 10, fill: CHART_AXIS, fontFamily: "var(--font-mono)" };
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 2, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} strokeWidth={1} />
        <XAxis
          dataKey="annee" tick={axisTick} axisLine={false} tickLine={false}
          minTickGap={24} tickFormatter={(v: number) => `${v} an${v > 1 ? "s" : ""}`}
        />
        <YAxis
          yAxisId="left" tick={axisTick} axisLine={false} tickLine={false}
          width={40} tickFormatter={eurAxis} domain={[0, "auto"]}
        />
        <YAxis
          yAxisId="right" orientation="right" tick={axisTick} axisLine={false} tickLine={false}
          width={38} tickFormatter={eurAxis} domain={[0, "auto"]}
        />
        <Tooltip content={(p) => <ProjTooltip {...(p as object)} />} />
        <Line
          yAxisId="left" type="monotone" dataKey="valeurNette" name="Encours net"
          stroke="var(--color-ink-2)" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }}
        />
        <Line
          yAxisId="right" type="monotone" dataKey="coutClient" name="Coût client cumulé"
          stroke="var(--color-warn)" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }}
        />
        <Line
          yAxisId="right" type="monotone" dataKey="revenuCabinet" name="Rému cabinet cumulée"
          stroke="var(--color-ok)" strokeWidth={2.25} dot={false} activeDot={{ r: 3.5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

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
  const [eurosRetroManuel, setEurosRetroManuel] = useState<number | null>(null);
  // Honoraires de conseil (facturation directe, hors rétrocession) : forfait € et
  // récurrent %/an. Préremplis du barème « Mon cabinet », surchargeables (null).
  const [honoraireForfaitManuel, setHonoraireForfaitManuel] = useState<number | null>(null);
  const [honoraireAnnuelManuel, setHonoraireAnnuelManuel] = useState<number | null>(null);
  const [ucs, setUcs] = useState<UcRow[]>([]);
  // Export PDF (document client conforme DDA / fiche interne cabinet).
  const [exporting, setExporting] = useState<null | "client" | "cabinet">(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Contrat reconnu à l'import d'un relevé (couverture forte + dominante) :
  // devient le contrat actif → rému cabinet dérivée du barème + frais du contrat
  // sourcés en base. null = aucun contrat sûr (saisie manuelle).
  const [detectedContract, setDetectedContract] = useState<string | null>(null);
  // Jeton du relevé parsé mémorisé au dépôt (sessionStorage) : joint au lien
  // « Analyse complète » pour rejouer le diagnostic À L'IDENTIQUE (montants
  // réels, contrat, DIC). Invalidé dès qu'on modifie le portefeuille à la main
  // (le relais ne refléterait plus l'écran).
  const [handoffToken, setHandoffToken] = useState<string | null>(null);
  // Vue active de la décomposition (bloc résultats commutable) : par qui c'est
  // encaissé / composition de ma rému / par type de frais.
  const [ventil, setVentil] = useState<"beneficiaires" | "remuneration" | "nature">("beneficiaires");

  const setF = (k: keyof FeeParams) => (v: number) => setFrais((f) => ({ ...f, [k]: v }));

  // Ajout d'un support par recherche : détail rechargé depuis /api/funds.
  const addUC = async (isin: string, name: string) => {
    setHandoffToken(null); // édition manuelle : le relais du relevé n'est plus fidèle
    setUcs((prev) => {
      if (prev.length >= MAX_UC || prev.some((u) => u.isin === isin)) return prev;
      const poids = prev.length ? prev.reduce((a, u) => a + u.poids, 0) / prev.length : 100;
      return [...prev, toUcRow(isin, name, poids, null)];
    });
    const f = await fetchFund(isin);
    if (!f) return;
    setUcs((prev) => prev.map((u) => (u.isin !== isin ? u : toUcRow(isin, u.name, u.poids, f))));
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

  const addPortfolio = (
    holdings: DepositedHolding[],
    matches: ReleveContractMatch[],
    token: string | null,
  ) => {
    const total = holdings.reduce((a, h) => a + Math.max(0, h.amount), 0);
    // Contrat reconnu sûr → contrat actif (rému + frais du contrat auto-remplis).
    setDetectedContract(pickConfidentContract(matches));
    setHandoffToken(token); // relevé parsé mémorisé → « Analyse complète » fidèle
    loadPortfolio(holdings.map((h) => ({ isin: h.isin, name: h.name, weight: h.amount })), total);
  };

  // Portefeuille importé de l'onglet « Portefeuille » : lignes pondérées + montant.
  const importPortfolio = (lines: ImportedLine[], montant: number | null) => {
    setHandoffToken(null); // pas un dépôt de relevé : aucun relais à rejouer
    loadPortfolio(lines.map((l) => ({ isin: l.isin, name: l.name, weight: l.weight })), montant);
  };

  // Préremplissage depuis un autre onglet : /frais?isins=&weights=&montant=
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

  // Toute édition manuelle du portefeuille invalide le relais (il ne reflèterait
  // plus l'écran) : « Analyse complète » retombe alors sur les paramètres d'URL.
  const removeUC = (isin: string) => {
    setHandoffToken(null);
    setUcs((prev) => prev.filter((u) => u.isin !== isin));
  };
  const setPoids = (isin: string, poids: number) => {
    setHandoffToken(null);
    setUcs((prev) => prev.map((u) => (u.isin === isin ? { ...u, poids: Math.max(0, poids) } : u)));
  };

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

  // Barème « Mon cabinet » lu APRÈS montage (localStorage) : l'état initial vaut
  // EMPTY_CABINET côté serveur ET au 1er rendu client → aucun mismatch d'hydratation
  // (même pattern que SupportSources). L'effet le remplace par le barème stocké,
  // qui réalimente convention + honoraires.
  const [storedCabinet, setStoredCabinet] = useState(EMPTY_CABINET);
  useEffect(() => { setStoredCabinet(loadStoredCabinet()); }, []);

  // Contrat actif : lien profond (?contract=Assureur::Contrat) OU contrat reconnu
  // à l'import d'un relevé. On en DÉRIVE la rémunération cabinet (rétro par la
  // cascade, commission d'entrée, part gestion contrat) depuis le barème « Mon
  // cabinet », et on source les FRAIS du contrat en base (effet ci-dessous). Le
  // simulateur s'aligne alors sur les mêmes taux que le portefeuille. Sans
  // contrat : taux de place.
  const contractKey = searchParams.get("contract") ?? detectedContract;
  const convention = useMemo(
    () => (contractKey && contractKey.includes("::") ? cabinetContract(storedCabinet, contractKey) : null),
    [contractKey, storedCabinet],
  );

  // Frais du contrat sourcés en base dès qu'un contrat est actif : entrée +
  // gestion UC + gestion fonds euros (av_contract_terms via /api/contract/terms).
  // Repli silencieux sur les défauts d'enveloppe si le contrat n'est pas en base.
  // Ne se déclenche qu'au CHANGEMENT de contrat → l'utilisateur peut ensuite
  // ajuster les frais à la main sans être réécrasé.
  useEffect(() => {
    if (!contractKey || !contractKey.includes("::")) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/contract/terms?key=${encodeURIComponent(contractKey)}`);
        const t = await res.json().catch(() => null);
        if (cancelled || !t?.found) return;
        setFrais((f) => ({
          ...f,
          contratEntree: t.frais_entree_pct ?? f.contratEntree,
          contratGestionUC: t.frais_gestion_uc_pct ?? f.contratGestionUC,
          contratGestionFE: t.frais_gestion_fonds_euros_pct ?? f.contratGestionFE,
        }));
      } catch { /* repli sur les défauts d'enveloppe */ }
    })();
    return () => { cancelled = true; };
  }, [contractKey]);

  // Rétrocession effective d'un support (%/an). Repli HONNÊTE d'abord
  // (retroFallbackFrac) : rétro sourcée en base si connue, sinon estimation de
  // place — mais 0 sur la gestion passive/indicielle et les ETF, qui ne
  // rétrocèdent RIEN (règle de place, cf. lib/remuneration). Puis cascade du
  // barème par-dessus si une convention est chargée (exception fonds → taux UC).
  const effRetroPct = useCallback((u: UcRow): number | null => {
    const fallbackFrac = retroFallbackFrac(
      u.retro != null ? u.retro / 100 : null,
      u.ter != null ? u.ter / 100 : null,
      u.productType, u.managementStyle,
    );
    const frac = convention
      ? resolveFundRetrocession(convention, u.isin, u.ter != null ? u.ter / 100 : null, fallbackFrac)
      : fallbackFrac;
    return frac != null ? Math.round(frac * 1e4) / 1e2 : null;
  }, [convention]);

  // Rétrocession pondérée des supports (déjà ETF-aware via effRetroPct). À défaut
  // de supports, estimation de place générique (50 % du TER, gestion active).
  const retroPonderee = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: effRetroPct(u), poids: u.poids }))), [ucs, effRetroPct]);
  const retroEstimee = Math.round(ucGestion * 0.5 * 100) / 100;
  const retroCgp = retroManuel ?? retroPonderee ?? retroEstimee;

  // Commission d'entrée cabinet : convention (entryFeeShare) sinon frais d'entrée
  // du contrat MOINS la part incompressible acquise à l'assureur (le CGP ne
  // touche pas 100 % des droits d'entrée).
  const commissionCabinet = commManuel ?? (
    convention?.entryFeeShare != null
      ? Math.round(convention.entryFeeShare * 1e4) / 1e2
      : Math.max(0, Math.round((frais.contratEntree - PART_INCOMPRESSIBLE_ASSUREUR) * 100) / 100)
  );
  // Part des frais de gestion du contrat reversée au cabinet (%/an) : convention (contractFeeShare) sinon 0.
  const contractFeeShare = contractFeeManuel ?? (
    convention?.contractFeeShare != null ? Math.round(convention.contractFeeShare * 1e4) / 1e2 : 0
  );
  // Rétrocession fonds euros (%/an) : saisie manuelle → convention (eurosRetroShare)
  // → estimation de place (~0,10 %). Le fonds euros rétrocède peu mais pas rien :
  // un repli à 0 sous-estimait la rému récurrente sur les contrats chargés en €.
  const eurosRetroShare = eurosRetroManuel ?? (
    convention?.eurosRetroShare != null ? Math.round(convention.eurosRetroShare * 1e4) / 1e2 : EUROS_RETRO_ESTIMEE
  );

  // Honoraires de conseil (facturation directe, hors rétrocession) : préremplis
  // du barème « Mon cabinet » (forfait € + récurrent %/an de l'encours).
  const cabinetHonoraires = useMemo(() => ({
    forfait: storedCabinet.honoraireForfait,
    annuelPct: storedCabinet.honoraireAnnuel != null ? Math.round(storedCabinet.honoraireAnnuel * 1e4) / 1e2 : null,
  }), [storedCabinet]);
  const honoraireForfait = honoraireForfaitManuel ?? cabinetHonoraires.forfait ?? 0;
  const honoraireAnnuelPct = honoraireAnnuelManuel ?? cabinetHonoraires.annuelPct ?? 0;

  const input: SimulationInput = useMemo(() => ({
    versementInitial, versementAnnuel, dureeAnnees: duree, partUC,
    rendementUC, rendementFE,
    frais: { ...frais, ucGestion, ucEntree, ucSortie },
    retroCgp, commissionCabinet, contractFeeShare, eurosRetroShare,
    honoraireForfait, honoraireAnnuelPct,
  }), [versementInitial, versementAnnuel, duree, partUC, rendementUC, rendementFE, frais, ucGestion, ucEntree, ucSortie, retroCgp, commissionCabinet, contractFeeShare, eurosRetroShare, honoraireForfait, honoraireAnnuelPct]);

  const horizons = useMemo(
    () => Array.from(new Set([...HORIZONS_DEFAUT, duree])).filter((h) => h <= duree).sort((a, b) => a - b), [duree]);
  const sim = useMemo(() => simulate(input, horizons), [input, horizons]);
  const final = sim.horizons[sim.horizons.length - 1];
  const finalPoint = final ? sim.points[final.annees] : null;
  const repart = final && finalPoint
    ? repartitionFrais(finalPoint.fraisCumules, final, finalPoint.retroCgpCumulee, finalPoint.commCabinetCumulee, finalPoint.contractFeeCumulee, finalPoint.eurosRetroCumulee)
    : null;

  // Agrégats prêts à l'affichage, TOUS issus du moteur (source unique) — plus
  // aucun recalcul divergent côté UI. `revenuCabinet` = revenu cabinet TOTAL
  // (rétro + commission + part gestion contrat + honoraires facturés en sus) ;
  // `coutTotalClient` = frais de structure + honoraires.
  const honoraireCumule = final ? final.honoraireCumule : 0;
  const revenuCabinet = final ? final.revenuCabinet : 0;
  const coutTotalClient = final ? final.coutTotalClient : 0;
  // Découpage « compte d'exploitation » du cabinet : upfront one-shot vs
  // récurrent de la 1re année (rémunération récurrente dès l'an 1, prudente —
  // pas la moyenne lissée qui gonfle avec l'encours). Source unique = moteur.
  const revenuUpfront = final ? final.revenuCabinetUpfront : 0;
  const revenuRecurrentAn1 = final ? (sim.points[1]?.revenuCabinetRecurrent ?? 0) : 0;


  // ── Lecture réglementaire client (déjà calculée par le moteur) ─────────────
  const riy = final ? reductionRendementAnnuelle(final) : 0;
  // Ventilation du coût client par NATURE (DDA/MIF2) à l'horizon final.
  const nature = final && finalPoint ? (() => {
    const fc = finalPoint.fraisCumules;
    return [
      { nom: "Frais d'entrée", montant: fc.entreeContrat + fc.entreeUC },
      { nom: "Gestion de l'enveloppe", montant: fc.gestionContratUC + fc.gestionContratFE },
      { nom: "Frais courants des supports", montant: fc.gestionUC },
      { nom: "Frais de sortie", montant: final.fraisSortie },
      ...(honoraireCumule > 0 ? [{ nom: "Honoraires de conseil (en sus)", montant: honoraireCumule }] : []),
    ];
  })() : null;

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
  // Ligne « fonds en euros » (miroir écran de buildFraisReport) : le compartiment €
  // du versement porte AUSSI la commission d'entrée (assise sur tout le versement,
  // pas seulement les UC) et une éventuelle rétro fonds euros. Sans elle, le total
  // du détail ne comptait que la part UC → écart trompeur avec « À l'entrée »
  // (ex. 45 € affichés vs 150 € réels). Ajoutée seulement s'il y a des supports UC.
  const fePot = versementInitial * (1 - Math.min(100, Math.max(0, partUC)) / 100);
  const feRow = supportRows.length > 0 && fePot > 0
    ? { montant: fePot, effRetro: eurosRetroShare || null, ...remunerationSupport(fePot, eurosRetroShare, commissionCabinet) }
    : null;
  const remuAnnuelleTotale = supportRows.reduce((a, r) => a + r.retroAnnuelle, 0) + (feRow?.retroAnnuelle ?? 0);
  const upfrontTotal = supportRows.reduce((a, r) => a + r.commissionUpfront, 0) + (feRow?.commissionUpfront ?? 0);

  // Série annuelle du graphe de projection (source unique = moteur).
  const serie = useMemo(() => projectionSeries(sim.points), [sim.points]);

  // Les trois ventilations d'un même montant (bloc « Décomposition »). Chacune =
  // segments d'une barre empilée. Le vert `ok` ne sert QUE de repère « votre
  // part » parmi des tiers (Bénéficiaires) ; les rampes restent monochromes clay.
  const ventilOptions = [
    { key: "beneficiaires" as const, label: "Bénéficiaires" },
    { key: "remuneration" as const, label: "Ma rému" },
    { key: "nature" as const, label: "Par nature" },
  ];
  const segBeneficiaires: BarSegment[] = repart
    ? [
        { label: "Cabinet (vous)", value: revenuCabinet, color: "var(--color-ok)", strong: true },
        { label: "Assureur", value: repart.assureur, color: SEG_CLAY[0] },
        { label: "Société de gestion", value: repart.societeGestion, color: SEG_CLAY[2] },
      ]
    : [];
  const segRemuneration: BarSegment[] = final
    ? [
        { label: "Rétrocessions", value: final.retroCgpCumulee, color: SEG_CLAY[0], strong: true },
        { label: "Commission d'entrée", value: final.commCabinetCumulee, color: SEG_CLAY[1] },
        ...(final.contractFeeCumulee > 0 ? [{ label: "Part gestion contrat", value: final.contractFeeCumulee, color: SEG_CLAY[2] }] : []),
        ...(final.eurosRetroCumulee > 0 ? [{ label: "Rétro fonds euros", value: final.eurosRetroCumulee, color: SEG_CLAY[3] }] : []),
        ...(honoraireCumule > 0 ? [{ label: "Honoraires (HT)", value: honoraireCumule, color: SEG_CLAY[4] }] : []),
      ]
    : [];
  const segNature: BarSegment[] = (nature ?? [])
    .filter((l) => l.montant > 0)
    .map((l, i) => ({ label: l.nom, value: l.montant, color: SEG_CLAY[i % SEG_CLAY.length] }));
  const segActifs = ventil === "beneficiaires" ? segBeneficiaires : ventil === "remuneration" ? segRemuneration : segNature;

  // ── Indicateurs cabinet (lecture pilotage, pas de recalcul divergent) ──────
  // Taux moyen de rétrocession = LE KPI métier (récurrent / encours moyen).
  const tauxRetro = final ? tauxRetrocessionMoyen(sim.points, final) : null;
  // Part du récurrent qui dépend des UC (rétro N2 sur support) : ce qui
  // s'effondre si le client bascule vers fonds euros ou ETF.
  const partUCRecurrent = final && final.revenuCabinetRecurrent > 0
    ? Math.round((final.retroCgpCumulee / final.revenuCabinetRecurrent) * 100)
    : null;
  // Alerte érosion : part de l'encours UC qui ne rétrocède RIEN (ETF / indiciel).
  // Le récurrent s'y éteint sans que l'assureur n'alerte jamais.
  const ucEncours = supportRows.reduce((a, r) => a + r.montant, 0);
  const partSansRetro = ucEncours > 0
    ? Math.round((supportRows.filter((r) => !(r.effRetro > 0)).reduce((a, r) => a + r.montant, 0) / ucEncours) * 100)
    : 0;

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
          clientRef: null,
          input,
          // On envoie la rétro RÉSOLUE (cascade barème + repli ETF-aware : 0 sur
          // l'indiciel), pas la valeur brute — pour que le PDF ne réinvente pas
          // une rétro sur un ETF et reste aligné sur l'écran.
          supports: ucs.map((u) => ({
            isin: u.isin, name: u.name, poids: u.poids,
            ter: u.ter, entryFee: u.entryFee, retro: effRetroPct(u),
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
    // Relais du relevé (dépôt non modifié) → l'analyse rejoue montants réels +
    // contrat + DIC. Sinon les seuls poids/montant d'URL (portefeuille édité,
    // créé à la main ou importé) : reconstruction approchée, sans contrat.
    const handoff = handoffToken ? `&handoff=${handoffToken}` : "";
    return `/portefeuille/analyser?isins=${isins}&weights=${weights}&montant=${Math.round(versementInitial)}${handoff}`;
  }, [ucs, versementInitial, handoffToken]);

  return (
    <PageShell maxWidth="1240px">
      {/* grid-cols-1 en mobile = piste minmax(0,1fr) bornée au conteneur (sinon
          la piste `auto` grossit à la max-content ~412px et déborde le viewport,
          bord droit clippé et inatteignable). min-w-0 sur l'aside pour qu'il se
          comprime comme <main>. */}
      <div className="grid gap-6 items-start grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ═══ Colonne gauche · réglages (paramètres, supports, données) ═══ */}
        <aside className="space-y-4 min-w-0">
          <Drawer title="Portefeuille" defaultOpen bodyClassName="">
            <SupportSources
              onAddFund={addUC}
              existingIsins={ucIsins}
              full={ucs.length >= MAX_UC}
              onAddPortfolio={addPortfolio}
              onImportPortfolio={importPortfolio}
            />
            {detectedContract && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2">
                <span className="min-w-0 flex-1 text-caption text-ink-2">
                  Contrat détecté : <span className="font-medium text-ink">{detectedContract.split("::")[1]}</span> — frais et rémunération pré-remplis.
                </span>
                <button
                  type="button" onClick={() => setDetectedContract(null)}
                  className="shrink-0 text-muted hover:text-ink" title="Détacher le contrat"
                >
                  <X size={13} />
                </button>
              </div>
            )}
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
          </Drawer>

          <Drawer title="Versement & horizon" defaultOpen>
              <FieldEur label="Versement initial" value={versementInitial} onChange={setVersementInitial} step={1000} />
              <FieldEur label="Versement annuel" value={versementAnnuel} onChange={setVersementAnnuel} step={500} />
              <div>
                <span className="text-meta text-ink-2 block mb-1.5">Durée</span>
                <div className="flex gap-2 overflow-x-auto pb-1 -mb-1 [scrollbar-width:thin]">
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
            </Drawer>

          <Drawer title="Ma rémunération (cabinet)" defaultOpen>
              <FieldPct label="Rétrocession (par an)" value={retroCgp} onChange={setRetroManuel} />
              <FieldPct label="Commission d'entrée cabinet" value={commissionCabinet} onChange={setCommManuel} />
              <FieldPct label="Part gestion contrat (par an)" value={contractFeeShare} onChange={setContractFeeManuel} />
              <FieldPct label="Rétro fonds euros (par an)" value={eurosRetroShare} onChange={setEurosRetroManuel} />
              <div className="pt-2 mt-1 border-t border-line-soft space-y-3">
                <p className="text-caption text-muted-2">Honoraires de conseil (HT)</p>
                <FieldEur label="Forfait (ponctuel)" value={honoraireForfait} onChange={setHonoraireForfaitManuel} step={100} />
                <FieldPct label="Récurrent (par an)" value={honoraireAnnuelPct} onChange={setHonoraireAnnuelManuel} />
              </div>
            </Drawer>

          <Drawer title="Frais du contrat">
              <FieldPct label="Entrée / versement" value={frais.contratEntree} onChange={setF("contratEntree")} />
              <FieldPct label="Gestion UC (par an)" value={frais.contratGestionUC} onChange={setF("contratGestionUC")} />
              <FieldPct label="Gestion fonds euros (par an)" value={frais.contratGestionFE} onChange={setF("contratGestionFE")} />
              <FieldPct label="Sortie / rachat" value={frais.contratSortie} onChange={setF("contratSortie")} />
            </Drawer>

          <Drawer title="Frais des supports">
              <FieldPct label="Entrée" value={ucEntree} onChange={setUcEntreeManuel}
                note={ucEntreeManuel == null && entreePonderee != null ? "pondéré des supports" : undefined} />
              <FieldPct label="Frais courants (par an)" value={ucGestion} onChange={setTerManuel}
                note={terManuel == null && terPondere != null ? "TER pondéré des supports" : undefined} />
              <FieldPct label="Sortie" value={ucSortie} onChange={setUcSortieManuel}
                note={ucSortieManuel == null && sortiePonderee != null ? "pondéré des supports" : undefined} />
          </Drawer>
        </aside>

        {/* ═══ Colonne droite · résultats (dense) ═══ */}
        <main className="min-w-0 space-y-5">
          {final && (
            <>
              {/* ── Bloc 1 · Héros — ma rémunération (priorité cabinet) ────────
                  Le nombre qui compte d'abord pour le CGP : grand, en vert.
                  Split temporel inline (entrée / récurrent). Le client passe en
                  pied, sobre — RIY = SEULE mesure de réduction de rendement
                  (pas de doublon d'indicateur). */}
              <Card className="px-5 py-5 sm:px-6 sm:py-6">
                <p className="text-label uppercase tracking-widest text-muted font-semibold">Ma rémunération</p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-display-lg font-semibold tabular-nums text-ok leading-none">{EUR.format(revenuCabinet)}</span>
                  <span className="text-body-lg text-ink-2">
                    <span className="tabular-nums font-medium text-ink">{EUR.format(revenuUpfront)}</span> à l’entrée, puis <span className="tabular-nums font-medium text-ink">{EUR.format(revenuRecurrentAn1)}</span>/an récurrent
                  </span>
                </div>
                {(tauxRetro != null || partUCRecurrent != null) && (
                  <div className="mt-3.5 flex flex-wrap gap-x-8 gap-y-2.5">
                    {tauxRetro != null && (
                      <div>
                        <p className="text-label uppercase tracking-wide text-muted font-semibold">Taux de rétrocession</p>
                        <p className="text-subhead font-semibold tabular-nums text-ink leading-none mt-0.5">{pct(tauxRetro)}<span className="text-caption text-muted font-normal"> /an</span></p>
                      </div>
                    )}
                    {partUCRecurrent != null && (
                      <div>
                        <p className="text-label uppercase tracking-wide text-muted font-semibold">Récurrent lié aux UC</p>
                        <p className="text-subhead font-semibold tabular-nums text-ink leading-none mt-0.5">{partUCRecurrent} %</p>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-body text-ink-2 mt-4 pt-3.5 border-t border-line-soft">
                  Pour le client, <span className="tabular-nums font-medium text-ink">{EUR.format(coutTotalClient)}</span> de frais, soit un rendement réduit de{" "}
                  <span
                    className="cursor-help tabular-nums font-medium text-ink decoration-dotted underline underline-offset-2 decoration-muted-2"
                    title="RIY (Reduction in Yield) — réduction de rendement annuelle : de combien, en points de %/an, les frais rabaissent la performance. Indicateur standardisé PRIIPs."
                  >{pct(riy)}/an (RIY)</span>.
                </p>
              </Card>

              {/* ── Bloc 2 · Décomposition commutable ─────────────────────────
                  Trois découpages du même montant en UNE carte (bénéficiaire /
                  source de rému / nature de frais) → barre empilée + légende, au
                  lieu de trois listes empilées. Le détail ligne par ligne
                  (tableau support) est replié. */}
              <Card className="px-5 py-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <H2 className="">Décomposition</H2>
                  <Segmented options={ventilOptions} value={ventil} onChange={setVentil} />
                </div>
                {partSansRetro > 0 && (
                  <div className="mb-4 rounded-lg border border-warn/30 bg-warn-soft/50 px-3 py-2">
                    <p className="text-caption text-ink-2">
                      <span className="font-medium text-ink">{partSansRetro} % de vos UC ne rétrocèdent rien</span> (ETF / indiciel) — ce récurrent-là s’éteint sans alerte de l’assureur.
                    </p>
                  </div>
                )}
                {segActifs.some((s) => s.value > 0) ? (
                  <StackedBar segments={segActifs} />
                ) : (
                  <p className="text-caption text-muted">Renseignez un versement pour voir la décomposition.</p>
                )}
                <Disclosure summary="Détail ligne par ligne">
                  {portfolioHref && (
                    <div className="mb-2 flex justify-end">
                      <Link href={portfolioHref} className="text-caption text-accent-ink hover:underline whitespace-nowrap inline-flex items-center gap-1">
                        Analyse complète <ArrowRight size={12} />
                      </Link>
                    </div>
                  )}
                  {supportRows.length === 0 ? (
                    <p className="text-caption text-muted">Créez, déposez ou importez un portefeuille pour voir la rémunération ligne par ligne.</p>
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
                            <td className="py-1.5 text-right text-ink-2">{pct(effRetro)}</td>
                            <td className="py-1.5 text-right text-ok font-medium">{EUR.format(retroAnnuelle)}</td>
                            <td className="py-1.5 text-right text-ok">{EUR.format(commissionUpfront)}</td>
                          </tr>
                        ))}
                        {feRow && (
                          <tr className="border-b border-line-soft last:border-0">
                            <td className="py-1.5 text-ink-2">Fonds en euros</td>
                            <td className="py-1.5 text-right text-ink-2">{pct(null)}</td>
                            <td className="py-1.5 text-right text-ink-2">{pct(null)}</td>
                            <td className="py-1.5 text-right text-ink-2">{pct(feRow.effRetro)}</td>
                            <td className="py-1.5 text-right text-ok font-medium">{EUR.format(feRow.retroAnnuelle)}</td>
                            <td className="py-1.5 text-right text-ok">{EUR.format(feRow.commissionUpfront)}</td>
                          </tr>
                        )}
                        <tr className="border-t border-line font-medium">
                          <td className="py-2 text-ink">Total</td>
                          <td /><td /><td />
                          <td className="py-2 text-right text-ok">{EUR.format(remuAnnuelleTotale)}</td>
                          <td className="py-2 text-right text-ok">{EUR.format(upfrontTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </Disclosure>
              </Card>

              {/* ── Bloc 3 · Projection dans le temps ─────────────────────────
                  Un graphe 3 courbes (encours / coût cumulé / rému cabinet) à la
                  place du tableau ; le tableau chiffré reste accessible replié. */}
              <Card className="px-5 py-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
                  <H2 className="">Dans le temps</H2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
                    <LegendDot color="var(--color-ink-2)" label="Encours net" />
                    <LegendDot color="var(--color-warn)" label="Coût cumulé" />
                    <LegendDot color="var(--color-ok)" label="Rému cabinet" />
                  </div>
                </div>
                <ProjectionChart data={serie} />
                <Disclosure summary="Voir le tableau chiffré">
                  <table className="w-full text-meta tabular-nums">
                    <thead>
                      <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
                        <th className="text-left py-2 font-semibold">Horizon</th>
                        <th className="text-right py-2 font-semibold">Valeur nette</th>
                        <th className="text-right py-2 font-semibold">Coût total</th>
                        <th className="text-right py-2 font-semibold">Rému cabinet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sim.horizons.map((h) => (
                        <tr key={h.annees} className="border-b border-line-soft last:border-0">
                          <td className="py-1.5 text-ink-2">{h.annees} ans</td>
                          <td className="py-1.5 text-right text-ink font-medium">{EUR.format(h.valeurNette)}</td>
                          <td className="py-1.5 text-right text-ink-2">{EUR.format(h.coutTotalClient)}</td>
                          <td className="py-1.5 text-right text-ok">{EUR.format(h.revenuCabinet)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Disclosure>
              </Card>
            </>
          )}

          {/* Export documentaire (client DDA / fiche interne cabinet) */}
          {final && (
            <Card className="px-5 py-4">
              <div className="flex items-center gap-2">
                <Btn variant="primary" size="sm" loading={exporting === "client"}
                  disabled={exporting !== null} onClick={() => exportPdf("client")}>
                  <Download size={14} /> Document client
                </Btn>
                <Btn variant="outline" size="sm" loading={exporting === "cabinet"}
                  disabled={exporting !== null} onClick={() => exportPdf("cabinet")}>
                  <Download size={14} /> Fiche cabinet
                </Btn>
              </div>
              {exportError && <p className="text-caption text-danger mt-1">{exportError}</p>}
            </Card>
          )}
        </main>
      </div>
    </PageShell>
  );
}
