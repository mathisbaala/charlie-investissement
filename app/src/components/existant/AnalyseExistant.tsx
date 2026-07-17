"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Kpi } from "@/components/ui/Kpi";
import { PageShell } from "@/components/ui/Page";
import { X } from "@/components/ui/icons";
import { weightedExposure, type ExpoRow, type Expo } from "@/lib/lookthrough";
import { consolidate, type ValidatedPosition } from "@/lib/releve";
import {
  buildRecommendations, weightedSri, type Recommendation, type FeeLine,
} from "@/lib/analyseExistant";
import type { PortfolioAnalysis } from "@/lib/portfolio";

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const PCT = (v: number, d = 1) => `${v.toFixed(d).replace(".", ",")} %`;

// ── Types locaux (miroir de /api/releve) ─────────────────────────────────────

interface ApiPosition {
  isin: string; label: string; amount: number | null;
  known: boolean; name: string | null; ter: number | null; sri: number | null;
}
interface ApiMatch { company: string; contract: string; coverage: number; matched: number }

interface Releve {
  id: string;
  fileName: string;
  positions: ApiPosition[];
  matches: ApiMatch[];
  /** Index du contrat retenu dans `matches` (-1 = non rattaché). */
  chosen: number;
  warning?: string;
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

export function AnalyseExistant() {
  const [releves, setReleves] = useState<Releve[]>([]);
  const [busy, setBusy] = useState(false);
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
      setError("L'analyse a échoué — réessayer.");
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
    <PageShell>
      <h1 className="text-title-lg text-ink mb-1">Analyse de l&apos;existant</h1>
      <p className="text-body text-muted mb-6">
        Déposez les relevés de situation du client (PDF) : Charlie en extrait les positions,
        reconnaît les contrats grâce au référencement, puis dresse la synthèse consolidée et
        des recommandations ciblées — sans refaire le portefeuille.
      </p>

      {/* ── Dépôt ── */}
      <Card className="p-5 mb-6">
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          data-testid="releve-input"
          onChange={(e) => onFiles(e.target.files)}
        />
        <div className="flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-ink text-paper text-body font-medium disabled:opacity-50"
          >
            {busy ? "Lecture en cours…" : "Déposer des relevés PDF"}
          </button>
          <p className="text-caption text-muted">
            Relevés texte uniquement (les scans ne sont pas gérés). Les PDF ne sont pas conservés.
          </p>
        </div>
        {error && <p className="text-caption text-danger mt-3">{error}</p>}
      </Card>

      {/* ── Validation par relevé ── */}
      {releves.map((r) => (
        <Card key={r.id} className="p-5 mb-4" data-testid="releve-card">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-body font-semibold text-ink">{r.fileName}</h2>
              <p className="text-caption text-muted">
                {r.positions.length} ligne{r.positions.length > 1 ? "s" : ""} détectée{r.positions.length > 1 ? "s" : ""}
                {r.warning ? ` — ${r.warning}` : ""}
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
                    {m.company} — {m.contract} ({Math.round(m.coverage * 100)} % des lignes couvertes)
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
        </Card>
      ))}

      {/* ── Lancement de l'analyse ── */}
      {releves.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap mb-8">
          <button
            type="button"
            onClick={analyse}
            disabled={analysing || consolidated.length < 2}
            className="px-4 py-2 rounded-lg bg-ink text-paper text-body font-medium disabled:opacity-50"
          >
            {analysing ? "Analyse en cours…" : "Analyser le patrimoine consolidé"}
          </button>
          <p className="text-caption text-muted">
            {consolidated.length} support{consolidated.length > 1 ? "s" : ""} valorisé{consolidated.length > 1 ? "s" : ""} ·{" "}
            {nbLignes} ligne{nbLignes > 1 ? "s" : ""} extraite{nbLignes > 1 ? "s" : ""} · total {EUR.format(total)}
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
              Ratios et corrélations calculés sur les 20 premières lignes (limite du moteur) — les
              répartitions couvrent l&apos;ensemble.
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
                Rien de bloquant détecté : corrélations maîtrisées, frais homogènes, pas de
                concentration excessive. Le portefeuille existant est cohérent.
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
              Ouvrir dans le simulateur de frais
            </Link>
            <Link href="/portefeuille" className="text-caption text-muted underline underline-offset-4">
              Simuler une réallocation complète (chemin secondaire)
            </Link>
          </div>
        </>
      )}
    </PageShell>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────

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
