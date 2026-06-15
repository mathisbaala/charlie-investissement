"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageShell, PageHeader } from "@/components/ui/Page";
import { SlidersHorizontal } from "@/components/ui/icons";
import type { ClientProfile, Envelope, EsgPreference, MatchResult } from "@/lib/matching";

const RISK_OPTIONS: { value: ClientProfile["risk_profile"]; label: string; desc: string }[] = [
  { value: "prudent",   label: "Prudent",   desc: "SRI 1-3, capital protégé" },
  { value: "equilibre", label: "Équilibré", desc: "SRI 2-4, rendement/risque" },
  { value: "dynamique", label: "Dynamique", desc: "SRI 4-6, croissance" },
  { value: "offensif",  label: "Offensif",  desc: "SRI 5-7, performance max" },
];

const ESG_OPTIONS: { value: EsgPreference; label: string }[] = [
  { value: "indifferent", label: "Indifférent" },
  { value: "art8",        label: "SFDR Art.8+" },
  { value: "art9",        label: "SFDR Art.9 uniquement" },
];

const ENVELOPE_OPTIONS: { value: Envelope; label: string }[] = [
  { value: "pea",     label: "PEA" },
  { value: "pea_pme", label: "PEA-PME" },
  { value: "per",     label: "PER" },
  { value: "av_fr",   label: "AV France" },
  { value: "av_lux",  label: "AV Luxembourg" },
  { value: "cto",     label: "CTO" },
];

function ScoreBadge({ score, label }: { score: number; label: string }) {
  // Rampe monotone de sévérité : fort → correct → faible → insuffisant.
  // Pas d'accent de marque (réservé aux liens/CTA) ; chaque palier est
  // visuellement distinct (vert / neutre / ambre / rouge).
  const color =
    score >= 75 ? "bg-ok-soft text-ok" :
    score >= 60 ? "bg-paper-2 text-ink-2" :
    score >= 45 ? "bg-warn-soft text-warn" :
    "bg-danger-soft text-danger";
  return (
    <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg ${color}`}>
      <span className="text-title font-bold leading-none">{score}</span>
      <span className="text-meta mt-0.5">{label}</span>
    </div>
  );
}

function fmt(n: number | null, suffix = "%", d = 2) {
  return n == null ? "—" : `${n.toFixed(d)}${suffix}`;
}

export default function MatchingPage() {
  const [age,         setAge]         = useState("45");
  const [riskProfile, setRiskProfile] = useState<ClientProfile["risk_profile"]>("equilibre");
  const [horizon,     setHorizon]     = useState("10");
  const [amount,      setAmount]      = useState("");
  const [envelopes,   setEnvelopes]   = useState<Envelope[]>(["per"]);
  const [esg,         setEsg]         = useState<EsgPreference>("indifferent");

  const [results,       setResults]       = useState<MatchResult[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [searched,      setSearched]      = useState(false);
  const [selectedIsins, setSelectedIsins] = useState<Set<string>>(new Set());

  function toggleFund(isin: string) {
    setSelectedIsins((prev) => {
      const next = new Set(prev);
      next.has(isin) ? next.delete(isin) : next.add(isin);
      return next;
    });
  }

  function toggleEnvelope(v: Envelope) {
    setEnvelopes((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  }

  async function search() {
    if (envelopes.length === 0) { setError("Sélectionnez au moins une enveloppe."); return; }
    setLoading(true);
    setError(null);
    try {
      const profile: ClientProfile = {
        age: Number(age) || 45,
        risk_profile: riskProfile,
        horizon_years: Number(horizon) || 10,
        amount_eur: amount ? Number(amount) : undefined,
        envelopes,
        esg_preference: esg,
      };
      const res  = await fetch("/api/matching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results);
      setSearched(true);
      setSelectedIsins(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full border border-line rounded-lg px-3 py-2 text-body-lg bg-paper text-ink focus:outline-none focus:border-accent/50 transition-colors";
  const labelCls = "block text-label font-medium text-muted mb-1.5 uppercase tracking-wide";

  return (
    <PageShell>
      <PageHeader
        title="Matching client"
        backlink={
          <Link href="/recherche" className="text-meta text-muted hover:text-accent transition-colors">
            ← Screener
          </Link>
        }
      />

        {/* Formulaire profil */}
        <Card className="p-5 mb-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelCls}>Âge du client</label>
                <input type="number" min="18" max="100" value={age}
                  onChange={(e) => setAge(e.target.value)} className={inputCls} />
              </div>
              <div className="flex-1">
                <label className={labelCls}>Horizon (ans)</label>
                <input type="number" min="1" max="30" value={horizon}
                  onChange={(e) => setHorizon(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Montant à investir (€)</label>
              <input type="number" value={amount} placeholder="Ex: 50000"
                onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className={labelCls}>Profil de risque</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {RISK_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => setRiskProfile(opt.value)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      riskProfile === opt.value
                        ? "border-accent/30 bg-accent-soft"
                        : "border-line hover:border-line-soft bg-paper"
                    }`}
                  >
                    <div className="text-body font-medium text-ink">{opt.label}</div>
                    <div className="text-label text-muted mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Enveloppes disponibles</label>
              <div className="flex gap-2 flex-wrap">
                {ENVELOPE_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => toggleEnvelope(opt.value)}
                    className={`px-4 py-2 rounded-lg text-meta font-medium border transition-colors ${
                      envelopes.includes(opt.value)
                        ? "bg-accent text-paper border-accent"
                        : "border-line text-ink-2 hover:border-line-soft bg-paper"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Préférence ESG</label>
              <div className="flex gap-2 flex-wrap">
                {ESG_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => setEsg(opt.value)}
                    className={`px-4 py-2 rounded-lg text-meta font-medium border transition-colors ${
                      esg === opt.value
                        ? "bg-accent text-paper border-accent"
                        : "border-line text-ink-2 hover:border-line-soft bg-paper"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {error && <p className="mt-4 text-meta text-danger">{error}</p>}

          <button onClick={search} disabled={loading}
            className="mt-5 px-6 py-2.5 bg-accent text-paper rounded-lg text-body font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Analyse en cours…" : "Trouver les fonds adaptés"}
          </button>
        </Card>

        {/* Résultats */}
        {searched && (
          <div>
            <p className="text-meta text-muted mb-3">
              {results.length} fonds recommandés, classés par score de matching
            </p>

            {results.length === 0 ? (
              <Card className="py-10">
                <EmptyState
                  icon={<SlidersHorizontal size={16} />}
                  title="Aucun fonds correspondant à ce profil."
                  hint="Essayez d'assouplir les critères (risque, enveloppe, ESG)."
                />
              </Card>
            ) : (
              <Card className="overflow-hidden">
                {/* Mobile : cartes (le tableau déborderait sur un téléphone) */}
                <div className="md:hidden divide-y divide-line-soft">
                  {results.map((f) => (
                    <Link key={f.isin} href={`/fonds/${f.isin}`} className="block p-3.5 active:bg-paper-2 transition-colors">
                      <div className="flex items-start gap-3">
                        <ScoreBadge score={f.match_score} label={f.match_label} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-ink leading-tight">{f.name}</div>
                          <div className="text-caption text-muted font-mono mt-0.5 truncate">{f.isin} · {f.gestionnaire ?? "—"}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 text-label">
                        {f.sfdr_article && (
                          <span className="inline-block px-2 py-0.5 rounded text-caption font-medium bg-ok-soft text-ok">Art.{f.sfdr_article}</span>
                        )}
                        {f.risk_score && (
                          <span className="inline-block px-2 py-0.5 rounded text-caption font-medium bg-warn-soft text-warn">{f.risk_score}/7</span>
                        )}
                        <span className="text-muted">TER {fmt(f.ongoing_charges)}</span>
                        <span className={`font-medium ${f.performance_1y == null ? "text-muted" : f.performance_1y >= 0 ? "text-ok" : "text-danger"}`}>1A {fmt(f.performance_1y)}</span>
                        <span className={`font-medium ${f.performance_3y == null ? "text-muted" : f.performance_3y >= 0 ? "text-ok" : "text-danger"}`}>3A {fmt(f.performance_3y)}</span>
                      </div>
                      {f.match_summary && <p className="text-label text-muted mt-2 leading-snug">{f.match_summary}</p>}
                    </Link>
                  ))}
                </div>

                {/* Desktop : tableau complet */}
                <table className="hidden md:table w-full text-meta">
                  <thead className="bg-paper-2 border-b border-line">
                    <tr>
                      <th className="px-4 py-3 w-8"></th>
                      <th className="text-center px-4 py-3 text-caption font-medium text-muted uppercase tracking-wider w-20">Score</th>
                      <th className="text-left px-4 py-3 text-caption font-medium text-muted uppercase tracking-wider">Fonds</th>
                      <th className="text-center px-3 py-3 text-caption font-medium text-muted uppercase tracking-wider">SFDR</th>
                      <th className="text-center px-3 py-3 text-caption font-medium text-muted uppercase tracking-wider">SRI</th>
                      <th className="text-right px-3 py-3 text-caption font-medium text-muted uppercase tracking-wider">TER</th>
                      <th className="text-right px-3 py-3 text-caption font-medium text-muted uppercase tracking-wider">1A</th>
                      <th className="text-right px-3 py-3 text-caption font-medium text-muted uppercase tracking-wider">3A</th>
                      <th className="text-left px-4 py-3 text-caption font-medium text-muted uppercase tracking-wider">Résumé</th>
                      <th className="px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {results.map((f) => (
                      <tr key={f.isin} className={`transition-colors ${selectedIsins.has(f.isin) ? "bg-accent-soft/30" : "hover:bg-paper-2"}`}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={selectedIsins.has(f.isin)}
                            onChange={() => toggleFund(f.isin)}
                            className="rounded border-line accent-accent" />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ScoreBadge score={f.match_score} label={f.match_label} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink truncate max-w-xs" title={f.name}>{f.name}</div>
                          <div className="text-caption text-muted">{f.isin} · {f.gestionnaire ?? "—"}</div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {f.sfdr_article ? (
                            <span className={`inline-block px-2 py-0.5 rounded text-caption font-medium ${
                              f.sfdr_article === 9 ? "bg-ok text-paper" :
                              f.sfdr_article === 8 ? "bg-ok-soft text-ok" :
                              "bg-paper-2 text-muted"
                            }`}>Art.{f.sfdr_article}</span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {f.risk_score ? (
                            <span className="inline-block px-2 py-0.5 rounded text-caption font-medium bg-warn-soft text-warn">
                              {f.risk_score}/7
                            </span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right text-ink-2">{fmt(f.ongoing_charges)}</td>
                        <td className={`px-3 py-3 text-right font-medium ${
                          f.performance_1y == null ? "" : f.performance_1y >= 0 ? "text-ok" : "text-danger"
                        }`}>{fmt(f.performance_1y)}</td>
                        <td className={`px-3 py-3 text-right font-medium ${
                          f.performance_3y == null ? "" : f.performance_3y >= 0 ? "text-ok" : "text-danger"
                        }`}>{fmt(f.performance_3y)}</td>
                        <td className="px-4 py-3 text-label text-muted max-w-xs truncate">{f.match_summary}</td>
                        <td className="px-3 py-3">
                          <Link href={`/fonds/${f.isin}`} className="text-accent hover:text-accent/80 text-label font-medium transition-colors">
                            Fiche →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}

      {/* Bouton rapport PDF flottant */}
      {selectedIsins.size >= 2 && (
        <div className="fixed bottom-6 right-6 z-50">
          <a
            href={`/api/rapport/pdf?isins=${Array.from(selectedIsins).join(",")}`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2 px-5 py-3 bg-ink text-paper rounded-xl shadow-lg hover:bg-ink/80 text-body font-medium transition-colors"
          >
            <span>Rapport PDF</span>
            <span className="bg-paper text-ink text-caption font-bold px-2 py-0.5 rounded-full">
              {selectedIsins.size}
            </span>
          </a>
        </div>
      )}
    </PageShell>
  );
}
