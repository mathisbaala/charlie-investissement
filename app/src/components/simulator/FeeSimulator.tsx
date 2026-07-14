"use client";

import React, { useMemo, useState } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { Kpi } from "@/components/ui/Kpi";
import { PageShell } from "@/components/ui/Page";
import { FundAdder } from "@/components/portfolio/FundAdder";
import { X } from "@/components/ui/icons";
import { pct, feeFracToPct, CONTRACT_FEE_DEFAULTS } from "@/lib/format";
import {
  simulate, rendementPondere, projeterUC, partFraisDansGainBrut, HORIZONS_DEFAUT,
  type FeeParams, type SimulationInput,
} from "@/lib/feeSimulator";

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const NUM_INPUT = "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const DUREES = [5, 10, 15, 20, 25];
const MAX_UC = 10;

// Défauts « contrat type » (éditables à l'écran) : bancassureur classique.
// Gestion UC = CONTRACT_FEE_DEFAUTS["AV-FR"], la référence de l'app.
const FRAIS_DEFAUT: FeeParams = {
  contratEntree: 2, contratGestionUC: CONTRACT_FEE_DEFAULTS["AV-FR"],
  contratGestionFE: 0.7, contratSortie: 0,
  ucEntree: 0, ucGestion: 1.8, ucSortie: 0,
};
const RENDEMENT_UC_DEFAUT = 5;   // %/an, faute d'UC sélectionnées
const RENDEMENT_FE_DEFAUT = 2.5; // %/an, taux servi moyen récent

// UC sélectionnée, enrichie depuis /api/funds (perf 5 ans annualisée, frais).
interface UcRow {
  isin: string;
  name: string;
  poids: number;               // % du compartiment UC
  perf5y: number | null;       // %/an, net des frais courants (VL réelle)
  ter: number | null;          // % (frais courants)
  entryFee: number | null;     // % (converti depuis la fraction en base)
  exitFee: number | null;      // %
}

// Un champ vidé ou invalide vaut 0 (jamais NaN : Number("") = 0 mais
// Number("-") = NaN, qui contaminerait toute la simulation).
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

/**
 * Simulateur de frais & de gains d'une assurance vie : deux étages de frais
 * (contrat + UC), perf 5 ans réelle des UC sélectionnées, projections 5/10/15
 * ans, courbe de la valeur (avec vs sans frais) et courbe des frais cumulés.
 */
export function FeeSimulator() {
  const [versementInitial, setVersementInitial] = useState(10_000);
  const [versementAnnuel, setVersementAnnuel] = useState(0);
  const [duree, setDuree] = useState(15);
  const [partUC, setPartUC] = useState(30);
  const [rendementFE, setRendementFE] = useState(RENDEMENT_FE_DEFAUT);
  // null = automatique (perf 5 ans réelle pondérée des UC sélectionnées)
  const [rendementUCManuel, setRendementUCManuel] = useState<number | null>(null);
  const [frais, setFrais] = useState<FeeParams>(FRAIS_DEFAUT);
  const [terManuel, setTerManuel] = useState<number | null>(null);
  // null = automatique : frais d'entrée/sortie réels pondérés des UC choisies.
  const [ucEntreeManuel, setUcEntreeManuel] = useState<number | null>(null);
  const [ucSortieManuel, setUcSortieManuel] = useState<number | null>(null);
  const [ucs, setUcs] = useState<UcRow[]>([]);

  const setF = (k: keyof FeeParams) => (v: number) => setFrais((f) => ({ ...f, [k]: v }));

  // Ajout d'une UC : le nom vient du FundAdder, le détail (perf 5 ans réelle,
  // frais) est rechargé depuis /api/funds (raccourci ISIN exact).
  const addUC = async (isin: string, name: string) => {
    setUcs((prev) => {
      if (prev.length >= MAX_UC || prev.some((u) => u.isin === isin)) return prev;
      const poids = prev.length ? prev.reduce((a, u) => a + u.poids, 0) / prev.length : 100;
      return [...prev, { isin, name, poids, perf5y: null, ter: null, entryFee: null, exitFee: null }];
    });
    try {
      const res = await fetch(`/api/funds?search=${encodeURIComponent(isin)}&per_page=1`);
      const json = await res.json();
      const f = json?.data?.[0];
      if (!f) return;
      setUcs((prev) => prev.map((u) => u.isin !== isin ? u : {
        ...u,
        name: f.name ?? u.name,
        perf5y: f.performance_5y ?? null,
        ter: f.ongoing_charges ?? f.ter ?? null,
        entryFee: feeFracToPct(f.entry_fee_max),
        exitFee: feeFracToPct(f.exit_fee_max),
      }));
    } catch { /* fiche indisponible : l'UC reste utilisable en manuel */ }
  };

  const removeUC = (isin: string) => setUcs((prev) => prev.filter((u) => u.isin !== isin));
  const setPoids = (isin: string, poids: number) =>
    setUcs((prev) => prev.map((u) => (u.isin === isin ? { ...u, poids: Math.max(0, poids) } : u)));

  // Rendement UC : perf 5 ans réelle pondérée, surchargeable à la main.
  const perfPonderee = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: u.perf5y, poids: u.poids }))),
    [ucs],
  );
  const rendementUC = rendementUCManuel ?? perfPonderee ?? RENDEMENT_UC_DEFAUT;

  // Frais des UC : réels pondérés des UC sélectionnées (frais courants,
  // entrée, sortie), chacun surchargeable à la main.
  const terPondere = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: u.ter, poids: u.poids }))),
    [ucs],
  );
  const entreePonderee = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: u.entryFee, poids: u.poids }))),
    [ucs],
  );
  const sortiePonderee = useMemo(
    () => rendementPondere(ucs.map((u) => ({ perf: u.exitFee, poids: u.poids }))),
    [ucs],
  );
  const ucGestion = terManuel ?? terPondere ?? FRAIS_DEFAUT.ucGestion;
  const ucEntree = ucEntreeManuel ?? entreePonderee ?? FRAIS_DEFAUT.ucEntree;
  const ucSortie = ucSortieManuel ?? sortiePonderee ?? FRAIS_DEFAUT.ucSortie;

  const input: SimulationInput = useMemo(() => ({
    versementInitial, versementAnnuel, dureeAnnees: duree, partUC,
    rendementUC, rendementFE,
    frais: { ...frais, ucGestion, ucEntree, ucSortie },
  }), [versementInitial, versementAnnuel, duree, partUC, rendementUC, rendementFE, frais, ucGestion, ucEntree, ucSortie]);

  const horizons = useMemo(
    () => Array.from(new Set([...HORIZONS_DEFAUT, duree])).filter((h) => h <= duree).sort((a, b) => a - b),
    [duree],
  );
  const sim = useMemo(() => simulate(input, horizons), [input, horizons]);
  const final = sim.horizons[sim.horizons.length - 1];

  // Courbe des frais : cumulés, regroupés en 3 postes lisibles.
  const fraisCurve = useMemo(() => sim.points.map((p) => ({
    annee: p.annee,
    entree: p.fraisCumules.entreeContrat + p.fraisCumules.entreeUC,
    contrat: p.fraisCumules.gestionContratUC + p.fraisCumules.gestionContratFE,
    uc: p.fraisCumules.gestionUC,
  })), [sim]);

  const valeurCurve = useMemo(() => sim.points.map((p) => ({
    annee: p.annee,
    nette: p.valeurNette,
    sansFrais: p.valeurSansFrais,
    versements: p.versementsCumules,
  })), [sim]);

  const ucIsins = useMemo(() => new Set(ucs.map((u) => u.isin)), [ucs]);

  return (
    <PageShell>
      {/* KPI à l'horizon simulé. Lecture CGP : les frais sont présentés en
          regard des gains (transparence DDA), pas comme une perte sèche. */}
      {final && (
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <Kpi label={`Valeur nette à ${final.annees} ans`} value={EUR.format(final.valeurNette)} />
          <Kpi label="Gain net client" value={EUR.format(final.gainNet)} tone={final.gainNet >= 0 ? "ok" : "bad"} />
          <Kpi label="Coût total de la structure" value={EUR.format(final.totalFrais)} />
          <Kpi label="Frais / gain brut"
            value={partFraisDansGainBrut(final) == null ? "—" : pct(partFraisDansGainBrut(final))} />
        </div>
      )}

      <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
        {/* ── Paramètres ── */}
        <div className="space-y-5 min-w-0">
          <Card className="px-5 py-5 space-y-3">
            <h2 className="text-subhead text-ink" style={{ fontFamily: "var(--font-sans)" }}>Versements & allocation</h2>
            <FieldEur label="Versement initial" value={versementInitial} onChange={setVersementInitial} step={1000} />
            <FieldEur label="Versement annuel" value={versementAnnuel} onChange={setVersementAnnuel} step={500} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-meta text-ink-2">Durée</span>
              <div className="flex rounded-md border border-line overflow-hidden">
                {DUREES.map((d) => (
                  <button key={d} onClick={() => setDuree(d)}
                    className={`text-caption px-2 py-1 transition-colors ${duree === d ? "bg-brown text-paper" : "text-muted hover:bg-accent-soft"}`}>
                    {d} ans
                  </button>
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
              <p className="text-caption text-muted mt-1">Le reste ({100 - partUC} %) va au fonds euros.</p>
            </div>
            <FieldPct label="Taux fonds euros (servi, net)" value={rendementFE} onChange={setRendementFE} />
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
                    // Champ vidé/invalide → retour au mode automatique (jamais NaN).
                    setRendementUCManuel(Number.isFinite(v) ? v : null);
                  }}
                  className={`w-16 text-right text-meta tabular-nums border border-line rounded-md px-1.5 py-1 bg-paper focus:outline-none focus:border-accent ${NUM_INPUT}`} />
                <span className="text-meta text-muted w-3">%</span>
              </span>
            </label>
            {rendementUCManuel != null && perfPonderee != null && (
              <button onClick={() => setRendementUCManuel(null)}
                className="text-caption text-accent hover:underline">
                Revenir à la perf réelle pondérée ({pct(perfPonderee)})
              </button>
            )}
          </Card>

          <Card className="px-5 py-5 space-y-3">
            <h2 className="text-subhead text-ink" style={{ fontFamily: "var(--font-sans)" }}>Frais du contrat</h2>
            <FieldPct label="Entrée / versement" value={frais.contratEntree} onChange={setF("contratEntree")} />
            <FieldPct label="Gestion UC (par an)" value={frais.contratGestionUC} onChange={setF("contratGestionUC")} />
            <FieldPct label="Gestion fonds euros (par an)" value={frais.contratGestionFE} onChange={setF("contratGestionFE")} />
            <FieldPct label="Sortie / rachat" value={frais.contratSortie} onChange={setF("contratSortie")} />
          </Card>

          <Card className="px-5 py-5 space-y-3">
            <h2 className="text-subhead text-ink" style={{ fontFamily: "var(--font-sans)" }}>Frais des UC</h2>
            <FieldPct label="Entrée" value={ucEntree} onChange={setUcEntreeManuel}
              note={ucEntreeManuel == null && entreePonderee != null ? "frais réels pondérés des UC choisies" : undefined} />
            <FieldPct label="Frais courants (par an)" value={ucGestion} onChange={setTerManuel}
              note={terManuel == null && terPondere != null ? "TER pondéré des UC choisies" : undefined} />
            <FieldPct label="Sortie" value={ucSortie} onChange={setUcSortieManuel}
              note={ucSortieManuel == null && sortiePonderee != null ? "frais réels pondérés des UC choisies" : undefined} />
            <p className="text-caption text-muted pt-1 border-t border-line-soft">
              Les frais courants sont déjà reflétés dans la valeur liquidative : ils
              n&apos;abaissent pas la trajectoire nette mais sont détaillés dans la courbe
              des frais, pour une transparence complète des deux étages (contrat + UC)
              sans double comptage.
            </p>
          </Card>

          {/* Sélection des UC réelles */}
          <Card className="px-5 py-5">
            <h2 className="text-subhead text-ink mb-3" style={{ fontFamily: "var(--font-sans)" }}>Unités de compte</h2>
            <div className="space-y-3.5">
              {ucs.map((u) => (
                <div key={u.isin}>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 min-w-0 text-meta text-ink truncate" title={u.name}>{u.name}</p>
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
                    <span className="font-sans text-muted"> · perf 5 ans {pct(u.perf5y, true)}/an · frais courants {pct(u.ter)}</span>
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <FundAdder onAdd={addUC} existing={ucIsins} full={ucs.length >= MAX_UC} />
            </div>
            {ucs.length === 0 && (
              <p className="text-caption text-muted mt-3">
                Sans UC sélectionnée, la simulation utilise {RENDEMENT_UC_DEFAUT} %/an
                et {FRAIS_DEFAUT.ucGestion} % de frais courants (modifiables ci-dessus).
              </p>
            )}
          </Card>
        </div>

        {/* ── Résultats ── */}
        <div className="space-y-5 min-w-0">
          <Card className="px-5 py-5">
            <h2 className="text-subhead text-ink mb-1" style={{ fontFamily: "var(--font-sans)" }}>Valeur du contrat</h2>
            <p className="text-caption text-muted mb-3">
              Valeur nette client vs trajectoire brute (avant toute structure) :
              l&apos;écart rémunère l&apos;enveloppe, la gestion et le conseil, à mettre en
              regard du gain net dégagé.
            </p>
            <ResponsiveContainer width="100%" height={260}>
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

          <Card className="px-5 py-5">
            <h2 className="text-subhead text-ink mb-1" style={{ fontFamily: "var(--font-sans)" }}>Courbe des frais cumulés</h2>
            <p className="text-caption text-muted mb-3">
              L&apos;assiette des frais de gestion suit l&apos;encours : la rémunération de la
              chaîne (assureur, société de gestion, conseil) croît avec le patrimoine
              du client. Intérêts alignés : mieux le contrat performe, plus l&apos;encours
              monte. Transparence poste par poste, exigée par la DDA.
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={fraisCurve} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#DFDEDA" />
                <XAxis dataKey="annee" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false}
                  tickFormatter={(v: number) => `${v} an${v > 1 ? "s" : ""}`} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false}
                  width={56} tickFormatter={(v: number) => EUR.format(v)} />
                <Tooltip
                  formatter={(v: unknown, n: unknown) => [typeof v === "number" ? EUR.format(v) : "—",
                    n === "entree" ? "Frais d'entrée" : n === "contrat" ? "Gestion du contrat" : "Gestion des UC (frais courants)"]}
                  labelFormatter={(l: unknown) => `Année ${l}`}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }} />
                <Legend formatter={(v: string) => <span style={{ fontSize: 11 }}>
                  {v === "entree" ? "Entrée" : v === "contrat" ? "Gestion contrat" : "Gestion UC"}</span>} />
                <Area type="monotone" dataKey="entree" stackId="f" stroke="#8A8780" fill="#DFDEDA" />
                <Area type="monotone" dataKey="contrat" stackId="f" stroke="#B0613F" fill="#B0613F" fillOpacity={0.55} />
                <Area type="monotone" dataKey="uc" stackId="f" stroke="#7A5C3E" fill="#7A5C3E" fillOpacity={0.35} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card className="px-5 py-5 overflow-x-auto">
            <h2 className="text-subhead text-ink mb-3" style={{ fontFamily: "var(--font-sans)" }}>Projections</h2>
            <table className="w-full text-meta tabular-nums">
              <thead>
                <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
                  <th className="text-left py-2 font-semibold">Horizon</th>
                  <th className="text-right py-2 font-semibold">Valeur nette</th>
                  <th className="text-right py-2 font-semibold">Gain net</th>
                  <th className="text-right py-2 font-semibold">Total frais</th>
                  <th className="text-right py-2 font-semibold">Frais / gain brut</th>
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
                    <td className="py-1.5 text-right text-ink-2">{pct(partFraisDansGainBrut(h))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-caption text-muted mt-3">
              Hypothèses : versements en début d&apos;année, frais de gestion prélevés en
              fin d&apos;année, allocation constante sans arbitrage, fiscalité et
              prélèvements sociaux non inclus. Projections indicatives, fondées sur la
              perf 5 ans réelle des UC : les performances passées ne préjugent pas des
              performances futures.
            </p>
          </Card>

          {ucs.length > 0 && (
            <Card className="px-5 py-5 overflow-x-auto">
              <h2 className="text-subhead text-ink mb-1" style={{ fontFamily: "var(--font-sans)" }}>UC : perf réelle & projections</h2>
              <p className="text-caption text-muted mb-3">
                Pour 10 000 € investis sur chaque UC seule, frais du contrat inclus
                ({pct(frais.contratGestionUC)}/an de gestion UC).
              </p>
              <table className="w-full text-meta tabular-nums">
                <thead>
                  <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
                    <th className="text-left py-2 font-semibold">UC</th>
                    <th className="text-right py-2 font-semibold">Perf 5 ans (réelle)</th>
                    <th className="text-right py-2 font-semibold">Frais courants</th>
                    <th className="text-right py-2 font-semibold">5 ans</th>
                    <th className="text-right py-2 font-semibold">10 ans</th>
                    <th className="text-right py-2 font-semibold">15 ans</th>
                  </tr>
                </thead>
                <tbody>
                  {ucs.map((u) => (
                    <tr key={u.isin} className="border-b border-line-soft last:border-0">
                      <td className="py-1.5 text-ink-2 max-w-[220px] truncate" title={u.name}>{u.name}</td>
                      <td className={`py-1.5 text-right font-medium ${u.perf5y == null ? "text-muted" : u.perf5y >= 0 ? "text-ok" : "text-danger"}`}>
                        {u.perf5y == null ? "—" : `${pct(u.perf5y, true)}/an`}
                      </td>
                      <td className="py-1.5 text-right text-ink-2">{pct(u.ter)}</td>
                      {[5, 10, 15].map((h) => {
                        const v = projeterUC(u.perf5y, frais.contratGestionUC, 10_000, h);
                        return <td key={h} className="py-1.5 text-right text-ink">{v == null ? "—" : EUR.format(v)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}
