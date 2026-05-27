"use client";

import { useState } from "react";
import type { Fund } from "@/lib/supabase";
import FundTable from "@/components/FundTable";
import ManualFilters from "@/components/ManualFilters";
import type { ScreenerFilters } from "@/lib/claude";

export default function ScreenerPage() {
  const [query, setQuery] = useState("");
  const [funds, setFunds] = useState<Fund[]>([]);
  const [filters, setFilters] = useState<ScreenerFilters>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [selectedIsins, setSelectedIsins] = useState<Set<string>>(new Set());

  function toggleFund(isin: string) {
    setSelectedIsins((prev) => {
      const next = new Set(prev);
      next.has(isin) ? next.delete(isin) : next.add(isin);
      return next;
    });
  }

  async function search(overrideFilters?: ScreenerFilters) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: overrideFilters ? "" : query,
          filters: overrideFilters,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFunds(data.funds);
      setFilters(data.filters);
      setSearched(true);
      setSelectedIsins(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Charlie CGP</h1>
          <p className="text-gray-500">18 203 fonds CGP-compatibles · OPCVM, ETF, SCPI</p>
          <a href="/matching" className="inline-block mt-2 text-sm text-blue-600 hover:underline">
            → Matching client (profil investisseur)
          </a>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Recherche en langage naturel
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Ex : fonds Europe actions SFDR Art.8 TER inférieur à 1% éligible PEA"
              className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => search()}
              disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Recherche…" : "Rechercher"}
            </button>
          </div>
        </div>

        <ManualFilters onSearch={search} activeFilters={filters} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {searched && (
          <div className="mt-4">
            <p className="text-sm text-gray-500 mb-3">
              {funds.length} fonds trouvés
              {funds.length === 50 ? " (limité à 50 — affinez les critères)" : ""}
            </p>
            {funds.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-500">Aucun fonds correspondant à ces critères.</p>
                <p className="text-sm text-gray-400 mt-1">Essayez d'assouplir les filtres.</p>
              </div>
            ) : (
              <FundTable funds={funds} selectedIsins={selectedIsins} onToggle={toggleFund} />
            )}
          </div>
        )}
      </div>

      {/* Bouton rapport PDF flottant */}
      {selectedIsins.size >= 2 && (
        <div className="fixed bottom-6 right-6 z-50">
          <a
            href={`/api/rapport/pdf?isins=${Array.from(selectedIsins).join(",")}`}
            target="_blank"
            className="flex items-center gap-2 px-5 py-3 bg-gray-900 text-white rounded-xl shadow-lg hover:bg-gray-700 text-sm font-medium"
          >
            <span>Rapport PDF</span>
            <span className="bg-white text-gray-900 text-xs font-bold px-2 py-0.5 rounded-full">
              {selectedIsins.size}
            </span>
          </a>
        </div>
      )}
    </main>
  );
}
