"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClientProfile, Envelope, EsgPreference, MatchResult } from "@/lib/matching";

const RISK_OPTIONS: { value: ClientProfile["risk_profile"]; label: string; desc: string }[] = [
  { value: "prudent", label: "Prudent", desc: "SRI 1-3, capital protégé" },
  { value: "equilibre", label: "Équilibré", desc: "SRI 2-4, rendement/risque" },
  { value: "dynamique", label: "Dynamique", desc: "SRI 4-6, croissance" },
  { value: "offensif", label: "Offensif", desc: "SRI 5-7, performance max" },
];

const ESG_OPTIONS: { value: EsgPreference; label: string }[] = [
  { value: "indifferent", label: "Indifférent" },
  { value: "art8", label: "SFDR Art.8+" },
  { value: "art9", label: "SFDR Art.9 uniquement" },
];

const ENVELOPE_OPTIONS: { value: Envelope; label: string }[] = [
  { value: "pea", label: "PEA" },
  { value: "per", label: "PER" },
  { value: "av_lux", label: "AV Luxembourg" },
];

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const color =
    score >= 75 ? "bg-emerald-100 text-emerald-800" :
    score >= 60 ? "bg-green-100 text-green-800" :
    score >= 45 ? "bg-yellow-100 text-yellow-800" :
    "bg-gray-100 text-gray-600";
  return (
    <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg ${color}`}>
      <span className="text-lg font-bold leading-none">{score}</span>
      <span className="text-xs mt-0.5">{label}</span>
    </div>
  );
}

function fmt(n: number | null, suffix = "%", d = 2) {
  return n == null ? "—" : `${n.toFixed(d)}${suffix}`;
}

export default function MatchingPage() {
  const [age, setAge] = useState("45");
  const [riskProfile, setRiskProfile] = useState<ClientProfile["risk_profile"]>("equilibre");
  const [horizon, setHorizon] = useState("10");
  const [amount, setAmount] = useState("");
  const [envelopes, setEnvelopes] = useState<Envelope[]>(["per"]);
  const [esg, setEsg] = useState<EsgPreference>("indifferent");

  const [results, setResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  function toggleEnvelope(v: Envelope) {
    setEnvelopes((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  }

  async function search() {
    if (envelopes.length === 0) {
      setError("Sélectionnez au moins une enveloppe.");
      return;
    }
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
      const res = await fetch("/api/matching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Screener
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Matching client</h1>
            <p className="text-sm text-gray-500">Trouvez les fonds adaptés au profil d'un client</p>
          </div>
        </div>

        {/* Formulaire profil */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* Âge + Horizon */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Âge du client</label>
                <input
                  type="number" min="18" max="100" value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Horizon (ans)</label>
                <input
                  type="number" min="1" max="30" value={horizon}
                  onChange={(e) => setHorizon(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Montant */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Montant à investir (€)</label>
              <input
                type="number" value={amount} placeholder="Ex: 50000"
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Profil de risque */}
            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-2">Profil de risque</label>
              <div className="grid grid-cols-4 gap-2">
                {RISK_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setRiskProfile(opt.value)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      riskProfile === opt.value
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Enveloppes */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Enveloppes disponibles</label>
              <div className="flex gap-2 flex-wrap">
                {ENVELOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleEnvelope(opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      envelopes.includes(opt.value)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-gray-300 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ESG */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Préférence ESG</label>
              <div className="flex gap-2 flex-wrap">
                {ESG_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setEsg(opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      esg === opt.value
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-gray-300 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {error && (
            <p className="mt-4 text-sm text-red-600">{error}</p>
          )}

          <button
            onClick={search}
            disabled={loading}
            className="mt-6 px-8 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Analyse en cours…" : "Trouver les fonds adaptés"}
          </button>
        </div>

        {/* Résultats */}
        {searched && (
          <div>
            <p className="text-sm text-gray-500 mb-3">
              {results.length} fonds recommandés, classés par score de matching
            </p>

            {results.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-500">Aucun fonds correspondant à ce profil.</p>
                <p className="text-sm text-gray-400 mt-1">Essayez d'assouplir les critères.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Score</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Fonds</th>
                      <th className="text-center px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">SFDR</th>
                      <th className="text-center px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">SRI</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">TER</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">1Y</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">3Y</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Résumé</th>
                      <th className="px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map((f) => (
                      <tr key={f.isin} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-center">
                          <ScoreBadge score={f.match_score} label={f.match_label} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 truncate max-w-xs" title={f.name}>{f.name}</div>
                          <div className="text-xs text-gray-400">{f.isin} · {f.gestionnaire ?? "—"}</div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {f.sfdr_article ? (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              f.sfdr_article === 9 ? "bg-emerald-100 text-emerald-700" :
                              f.sfdr_article === 8 ? "bg-green-100 text-green-700" :
                              "bg-gray-100 text-gray-700"
                            }`}>Art.{f.sfdr_article}</span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {f.risk_score ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-orange-50 text-orange-700">
                              {f.risk_score}/7
                            </span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">{fmt(f.ongoing_charges)}</td>
                        <td className={`px-3 py-3 text-right font-medium ${
                          f.performance_1y == null ? "" : f.performance_1y >= 0 ? "text-green-600" : "text-red-600"
                        }`}>{fmt(f.performance_1y)}</td>
                        <td className={`px-3 py-3 text-right font-medium ${
                          f.performance_3y == null ? "" : f.performance_3y >= 0 ? "text-green-600" : "text-red-600"
                        }`}>{fmt(f.performance_3y)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{f.match_summary}</td>
                        <td className="px-3 py-3">
                          <Link href={`/fonds/${f.isin}`} className="text-blue-600 hover:text-blue-800 text-xs font-medium">
                            Fiche →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
