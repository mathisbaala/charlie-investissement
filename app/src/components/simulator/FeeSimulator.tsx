"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Btn } from "@/components/ui/Btn";
import { PageShell } from "@/components/ui/Page";
import { X, ArrowRight, Download, ChevronDown } from "@/components/ui/icons";
import { pct, feeFracToPct, CONTRACT_FEE_DEFAULTS } from "@/lib/format";
import { parsePortfolioParams } from "@/lib/portfolio";
import {
  simulate, rendementPondere, partFraisDansGainBrut, repartitionFrais,
  reductionRendementAnnuelle, remunerationSupport, HORIZONS_DEFAUT,
  type FeeParams, type SimulationInput,
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
  // Rétrocession fonds euros (%/an) : convention (eurosRetroShare) sinon 0
  // (asymétrie €/UC : le fonds euros rétrocède peu, souvent rien).
  const eurosRetroShare = eurosRetroManuel ?? (
    convention?.eurosRetroShare != null ? Math.round(convention.eurosRetroShare * 1e4) / 1e2 : 0
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
  const coutPctVersements = final && final.versementsCumules > 0
    ? (coutTotalClient / final.versementsCumules) * 100 : null;
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
      <div className="grid gap-6 items-start lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ═══ Colonne gauche · réglages (paramètres, supports, données) ═══ */}
        <aside className="space-y-4">
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
                <p className="text-caption text-muted-2">Honoraires de conseil</p>
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
          {/* Synthèse en tête de colonne : elle défile avec le reste du contenu.
              Deux comptabilités empilées, une ligne chacune : ce que le cabinet
              encaisse et ce que le client supporte / récupère. Chiffres mis en
              avant (text-display), libellés courts. */}
          {final && (
            <div className="border-b border-line-soft pb-4 space-y-3">
              {([
                {
                  titre: "Ce que je gagne",
                  tiles: [
                    { label: "Rému cabinet", value: EUR.format(revenuCabinet), tone: "ok" },
                    { label: "À l'entrée", value: EUR.format(revenuUpfront), tone: "ok" },
                    { label: "Récurrent", value: `${EUR.format(revenuRecurrentAn1)}/an`, tone: "ok" },
                  ],
                },
                {
                  titre: "Côté client",
                  tiles: [
                    { label: "Coût total client", value: EUR.format(coutTotalClient), tone: null },
                    { label: "Gain net", value: `${final.gainNet >= 0 ? "+" : ""}${EUR.format(final.gainNet)}`, tone: final.gainNet >= 0 ? "ok" : "bad" },
                    { label: "Réduction de rendement", value: `${pct(riy)}/an`, tone: null },
                  ],
                },
              ] as { titre: string; tiles: { label: string; value: string; tone: "ok" | "bad" | null }[] }[]).map((g) => (
                <section key={g.titre}>
                  <p className="text-label uppercase tracking-widest text-muted font-semibold px-0.5 mb-1.5">{g.titre}</p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {g.tiles.map((k) => (
                      <div key={k.label} className="min-w-0 rounded-xl border border-line bg-paper px-3.5 py-3">
                        <p className="text-label uppercase tracking-wide text-muted font-semibold leading-tight truncate" title={k.label}>{k.label}</p>
                        <p className={`text-display font-semibold tabular-nums leading-none mt-1.5 ${k.tone === "ok" ? "text-ok" : k.tone === "bad" ? "text-danger" : "text-ink"}`}>{k.value}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <div className="space-y-5">
          <Card className="px-5 py-5">
            <H2>Ma rémunération</H2>
            {final && (
              <>
                {/* Le total cabinet vit dans le bandeau (tuile « Rému cabinet ») ;
                    ici on ne montre que sa décomposition, à text-title. */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-4">
                  <div className="rounded-lg border border-line-soft px-3 py-2.5">
                    <p className="text-caption text-muted">Rétrocessions</p>
                    <p className="text-title text-ink font-semibold tabular-nums mt-0.5">{EUR.format(final.retroCgpCumulee)}</p>
                  </div>
                  <div className="rounded-lg border border-line-soft px-3 py-2.5">
                    <p className="text-caption text-muted">Commission d'entrée</p>
                    <p className="text-title text-ink font-semibold tabular-nums mt-0.5">{EUR.format(final.commCabinetCumulee)}</p>
                  </div>
                  {final.contractFeeCumulee > 0 && (
                    <div className="rounded-lg border border-line-soft px-3 py-2.5">
                      <p className="text-caption text-muted">Part gestion contrat</p>
                      <p className="text-title text-ink font-semibold tabular-nums mt-0.5">{EUR.format(final.contractFeeCumulee)}</p>
                    </div>
                  )}
                  {final.eurosRetroCumulee > 0 && (
                    <div className="rounded-lg border border-line-soft px-3 py-2.5">
                      <p className="text-caption text-muted">Rétro fonds euros</p>
                      <p className="text-title text-ink font-semibold tabular-nums mt-0.5">{EUR.format(final.eurosRetroCumulee)}</p>
                    </div>
                  )}
                  {honoraireCumule > 0 && (
                    <div className="rounded-lg border border-line-soft px-3 py-2.5">
                      <p className="text-caption text-muted">Honoraires</p>
                      <p className="text-title text-ink font-semibold tabular-nums mt-0.5">{EUR.format(honoraireCumule)}</p>
                    </div>
                  )}
                </div>
              </>
            )}
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
                  <tr className="border-t border-line font-medium">
                    <td className="py-2 text-ink">Total</td>
                    <td /><td /><td />
                    <td className="py-2 text-right text-ok">{EUR.format(remuAnnuelleTotale)}</td>
                    <td className="py-2 text-right text-ok">{EUR.format(upfrontTotal)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </Card>

          {repart && final && (
            <Card className="px-5 py-5">
              <H2>Où va le coût ?</H2>
              <div className="space-y-2.5">
                {[
                  { nom: "Assureur", montant: repart.assureur },
                  { nom: "Société de gestion", montant: repart.societeGestion },
                  { nom: "Votre cabinet (CGP)", montant: revenuCabinet, mine: true },
                ].map(({ nom, montant, mine }) => {
                  const part = coutTotalClient > 0 ? (montant / coutTotalClient) * 100 : 0;
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

          {final && nature && (
            <Card className="px-5 py-5">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <H2 className="">La nature du coût (client)</H2>
                <span className="text-meta text-ink font-medium tabular-nums">{EUR.format(coutTotalClient)}</span>
              </div>
              <div className="space-y-2">
                {nature.filter((l) => l.montant > 0).map((l) => {
                  const part = coutTotalClient > 0 ? (l.montant / coutTotalClient) * 100 : 0;
                  return (
                    <div key={l.nom}>
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-meta text-ink-2">{l.nom}</p>
                        <div className="text-right shrink-0">
                          <span className="text-meta tabular-nums text-ink">{EUR.format(l.montant)}</span>
                          <span className="text-caption text-muted tabular-nums ml-2">{Math.round(part)} %</span>
                        </div>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-line-soft overflow-hidden">
                        <div className="h-full bg-accent/60" style={{ width: `${Math.min(100, part)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-3 border-t border-line-soft grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <p className="text-caption uppercase tracking-wide text-muted font-semibold">Réduction de rendement</p>
                  <p className="text-body font-semibold tabular-nums text-ink leading-tight mt-0.5">{pct(riy)}<span className="text-caption text-muted font-normal"> /an (type PRIIPs)</span></p>
                </div>
                {partFraisDansGainBrut(final) != null && (
                  <div>
                    <p className="text-caption uppercase tracking-wide text-muted font-semibold">Frais / gain brut</p>
                    <p className="text-body font-semibold tabular-nums text-ink leading-tight mt-0.5">{pct(partFraisDansGainBrut(final))}<span className="text-caption text-muted font-normal"> du gain brut</span></p>
                  </div>
                )}
                {coutPctVersements != null && (
                  <div className="sm:text-right">
                    <p className="text-caption uppercase tracking-wide text-muted font-semibold">Coût total</p>
                    <p className="text-body font-semibold tabular-nums text-ink leading-tight mt-0.5">{pct(Math.round(coutPctVersements * 10) / 10)}<span className="text-caption text-muted font-normal"> des versements</span></p>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card className="px-5 py-5 overflow-x-auto">
            <H2>Projections</H2>
            <table className="w-full text-meta tabular-nums">
              <thead>
                <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
                  <th className="text-left py-2 font-semibold">Horizon</th>
                  <th className="text-right py-2 font-semibold">Valeur nette</th>
                  <th className="text-right py-2 font-semibold">Gain net</th>
                  <th className="text-right py-2 font-semibold">Coût total</th>
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
                    <td className="py-1.5 text-right text-ink-2">{EUR.format(h.coutTotalClient)}</td>
                    <td className="py-1.5 text-right text-ok">{EUR.format(h.revenuCabinet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          </div>

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
