"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { Kpi } from "@/components/ui/Kpi";
import { PageShell } from "@/components/ui/Page";
import { Upload, X, ArrowLeft, FileSearch, FileText } from "@/components/ui/icons";
import { FundAdder } from "@/components/portfolio/FundAdder";
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
import { parsePortfolioParams, type PortfolioAnalysis } from "@/lib/portfolio";

type AnalyseMode = "portefeuille" | "support";

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const PCT = (v: number, d = 1) => `${v.toFixed(d).replace(".", ",")} %`;

// ── Type local : un relevé côté client (positions/contrats = types /api/releve) ─
interface Releve {
  id: string;
  fileName: string;
  positions: ApiPosition[];
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

  // Dépôt de fichiers : un POST /api/releve par PDF, séquentiel (reste simple).
  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
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
        const terFrac = f.ongoing_charges ?? f.ter;
        const ter = terFrac != null ? Math.round(Number(terFrac) * 10000) / 100 : null;
        const sri = f.risk_score ?? null;
        setReleves((prev) => prev.map((r) => r.id !== rid ? r : {
          ...r,
          positions: r.positions.map((p) =>
            p.isin === isin ? { ...p, ter, sri, name: f.name ?? p.name } : p),
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

  // Préremplissage par lien profond : /portefeuille/analyser?isins=&weights=&montant=
  // (bouton « Analyse complète » du simulateur de frais). On matérialise un relevé
  // virtuel de supports valorisés, prêt à analyser, puis on enrichit TER/SRI/nom.
  const preloaded = useRef(false);
  useEffect(() => {
    if (preloaded.current) return;
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
      fileName: "Supports importés du simulateur",
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

      setSynthese({ analysis, geo, sectors, recos, sri: weightedSri(sriRows), terMoyen, truncated });
    } catch {
      setError("L'analyse a échoué, réessayer.");
    } finally {
      setAnalysing(false);
    }
  }

  const nbLignes = releves.reduce((s, r) => s + r.positions.length, 0);
  const simulateurHref = useMemo(() => {
    const top = consolidated.slice(0, 10);
    if (top.length === 0) return "/simulateur";
    return `/simulateur?isins=${top.map((p) => p.isin).join(",")}&weights=${top
      .map((p) => Math.round(p.weight * 1000) / 10)
      .join(",")}&montant=${Math.round(total)}`;
  }, [consolidated, total]);

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
              <p className="text-caption text-muted">
                {r.positions.length} ligne{r.positions.length > 1 ? "s" : ""} détectée{r.positions.length > 1 ? "s" : ""}
                {r.warning ? ` (${r.warning})` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => removeReleve(r.id)}
              aria-label={`Retirer ${r.fileName}`}
              className="text-muted hover:text-danger"
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
                          className="w-28 text-right rounded border border-line bg-paper px-1.5 py-0.5"
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(r.id, p.isin)}
                          aria-label={`Retirer ${p.isin}`}
                          className="text-muted hover:text-danger"
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
          <p className="text-caption text-muted">
            {consolidated.length < 2
              ? "Au moins 2 supports valorisés sont nécessaires pour l'analyse."
              : `${consolidated.length} supports valorisés · ${nbLignes} ligne${nbLignes > 1 ? "s" : ""} extraite${nbLignes > 1 ? "s" : ""} · total ${EUR.format(total)}`}
          </p>
        </div>
      )}

      {/* ── Synthèse ── */}
      {synthese && (
        <>
          <div className="flex flex-col md:flex-row gap-3 mb-6">
            <Kpi label="Patrimoine analysé" value={EUR.format(total)} />
            <Kpi
              label="Perf. annualisée 5 ans"
              value={
                synthese.analysis?.ratios?.annual_return != null
                  ? PCT(synthese.analysis.ratios.annual_return * 100)
                  : "—"
              }
            />
            <Kpi label="Frais courants moyens" value={synthese.terMoyen != null ? PCT(synthese.terMoyen, 2) : "—"} />
            <Kpi label="SRI pondéré" value={synthese.sri != null ? `${String(synthese.sri).replace(".", ",")}/7` : "—"} />
          </div>
          {synthese.truncated && (
            <p className="text-caption text-muted mb-4">
              Ratios et corrélations calculés sur les 20 premières lignes (limite du moteur) ;
              les répartitions couvrent l&apos;ensemble.
            </p>
          )}

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <ExpoCard title="Répartition géographique" slices={synthese.geo} />
            <ExpoCard title="Répartition sectorielle" slices={synthese.sectors} />
          </div>

          {/* Recommandations ciblées — le cœur du parcours (spec §5). */}
          <h2 className="text-title text-ink mb-3">Recommandations</h2>
          {synthese.recos.length === 0 ? (
            <Card className="p-5 mb-6">
              <p className="text-body text-ink">
                Aucune recommandation : corrélations maîtrisées, frais homogènes et pas de
                concentration excessive.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3 mb-6">
              {synthese.recos.map((reco) => (
                <Card key={`${reco.kind}-${reco.title}`} className="p-5" data-testid="reco-card">
                  <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-1">
                    {reco.kind === "correlation" ? "Diversification" : reco.kind === "frais" ? "Frais" : "Concentration"}
                  </p>
                  <h3 className="text-body font-semibold text-ink mb-1">{reco.title}</h3>
                  <p className="text-body text-muted">{reco.detail}</p>
                </Card>
              ))}
            </div>
          )}

          {/* Matrice de corrélation (R1) — l'illustration demandée. */}
          {synthese.analysis && synthese.analysis.correlation.length > 0 && (
            <CorrelationMatrix analysis={synthese.analysis} />
          )}

          <div className="flex items-center gap-4 flex-wrap mt-6">
            <Link href={simulateurHref} className="text-body text-ink underline underline-offset-4">
              Simuler ma rémunération
            </Link>
            <Link href="/portefeuille/construire" className="text-caption text-muted underline underline-offset-4">
              Simuler une réallocation complète (chemin secondaire)
            </Link>
          </div>
        </>
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
  const sum = releve.positions.reduce((s, p) => s + (p.amount ?? 0), 0);
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

function ExpoCard({ title, slices }: { title: string; slices: Expo[] }) {
  return (
    <Card className="p-5">
      <h3 className="text-body font-semibold text-ink mb-3">{title}</h3>
      {slices.length === 0 ? (
        <p className="text-caption text-muted">Pas de données de composition pour ces supports.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {slices.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="text-caption text-ink w-40 truncate" title={s.label}>{s.label}</span>
              <div className="flex-1 h-2 rounded bg-line-soft overflow-hidden">
                <div className="h-full bg-ink/70" style={{ width: `${Math.min(100, s.weight)}%` }} />
              </div>
              <span className="text-caption text-muted w-12 text-right">{PCT(s.weight, 0)}</span>
            </div>
          ))}
        </div>
      )}
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
