"use client";

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FilterOption {
  value: string;
  count: number;
}

interface NumericOption {
  value: number;
  count: number;
}

interface FiltersData {
  product_types: FilterOption[];
  regions: FilterOption[];
  categories: FilterOption[];
  sectors: FilterOption[];
  gestionnaires: FilterOption[];
  sfdr_articles: NumericOption[];
  ter_range: { min: number | null; max: number | null };
  perf_3y_range: { min: number | null; max: number | null };
}

export interface ActiveFilters {
  types: string[];
  regions: string[];
  categories: string[];
  sectors: string[];
  sfdr: number[];
  pea: boolean;
  per: boolean;
  av_lux: boolean;
  sri_min: string;
  sri_max: string;
  ter_max: string;
  perf_3y_min: string;
  gestionnaire: string;
  search: string;
}

export const EMPTY_FILTERS: ActiveFilters = {
  types: [], regions: [], categories: [], sectors: [], sfdr: [],
  pea: false, per: false, av_lux: false,
  sri_min: "", sri_max: "", ter_max: "", perf_3y_min: "",
  gestionnaire: "", search: "",
};

interface Props {
  filters: ActiveFilters;
  onChange: (f: ActiveFilters) => void;
  onSearch: () => void;
  onReset: () => void;
  loading?: boolean;
  totalResults?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  opcvm: "OPCVM", etf: "ETF", scpi: "SCPI", fpci: "FPCI", fpre: "FPRE",
  fcpr: "FCPR", fps: "FPS", fonds_euros: "Fonds Euros", action: "Action",
  obligation: "Obligation", crypto: "Crypto", opci: "OPCI", livret: "Livret",
};

const REGION_LABELS: Record<string, string> = {
  world: "Monde", europe: "Europe", usa: "États-Unis", france: "France",
  emerging: "Émergents", japan: "Japon", asia: "Asie", china: "Chine",
  uk: "Royaume-Uni", germany: "Allemagne", switzerland: "Suisse", india: "Inde",
  brazil: "Brésil", eurozone: "Zone Euro",
};

function MultiSelect({
  label, options, selected, onChange, labelMap, maxVisible = 8,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (v: string[]) => void;
  labelMap?: Record<string, string>;
  maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? options : options.slice(0, maxVisible);

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  if (options.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
        {selected.length > 0 && (
          <button onClick={() => onChange([])} className="text-xs text-blue-500 hover:text-blue-700">
            Reset
          </button>
        )}
      </div>
      <div className="space-y-1">
        {visible.map((opt) => (
          <label key={opt.value} className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5"
              />
              <span className={`text-sm ${selected.includes(opt.value) ? "font-medium text-gray-900" : "text-gray-700"}`}>
                {labelMap?.[opt.value] ?? opt.value}
              </span>
            </div>
            <span className="text-xs text-gray-400 group-hover:text-gray-600">{opt.count.toLocaleString("fr")}</span>
          </label>
        ))}
      </div>
      {options.length > maxVisible && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-xs text-blue-500 hover:text-blue-700"
        >
          {expanded ? "Voir moins" : `+${options.length - maxVisible} autres`}
        </button>
      )}
    </div>
  );
}

function SfdrSelect({ selected, options, onChange }: { selected: number[]; options: NumericOption[]; onChange: (v: number[]) => void }) {
  function toggle(v: number) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }
  const COLORS: Record<number, string> = { 6: "border-gray-400 text-gray-700", 8: "border-green-500 text-green-700", 9: "border-emerald-500 text-emerald-700" };
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">SFDR</span>
        {selected.length > 0 && <button onClick={() => onChange([])} className="text-xs text-blue-500">Reset</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-colors ${
              selected.includes(opt.value)
                ? opt.value === 9 ? "bg-emerald-500 text-white border-emerald-500"
                  : opt.value === 8 ? "bg-green-500 text-white border-green-500"
                  : "bg-gray-600 text-white border-gray-600"
                : COLORS[opt.value] ?? "border-gray-300 text-gray-600"
            }`}
          >
            Art. {opt.value}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScreenerSidebar({ filters, onChange, onSearch, onReset, loading, totalResults }: Props) {
  const [filtersData, setFiltersData] = useState<FiltersData | null>(null);

  useEffect(() => {
    fetch("/api/screener/filters")
      .then((r) => r.json())
      .then((d) => setFiltersData(d))
      .catch(() => {});
  }, []);

  function set<K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  const activeCount = [
    filters.types.length, filters.regions.length, filters.categories.length,
    filters.sectors.length, filters.sfdr.length,
    filters.pea ? 1 : 0, filters.per ? 1 : 0, filters.av_lux ? 1 : 0,
    filters.sri_min ? 1 : 0, filters.sri_max ? 1 : 0,
    filters.ter_max ? 1 : 0, filters.perf_3y_min ? 1 : 0,
    filters.gestionnaire ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <aside className="w-72 shrink-0 bg-white border border-gray-200 rounded-xl p-5 h-fit sticky top-4 overflow-y-auto max-h-[calc(100vh-2rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-gray-900">
          Filtres
          {activeCount > 0 && (
            <span className="ml-2 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">{activeCount}</span>
          )}
        </h2>
        {activeCount > 0 && (
          <button onClick={onReset} className="text-xs text-gray-400 hover:text-gray-600">
            Tout effacer
          </button>
        )}
      </div>

      {/* Recherche texte */}
      <div className="mb-5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">Recherche</span>
        <input
          type="text"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          placeholder="Nom, ISIN, gestionnaire..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Type */}
      <MultiSelect
        label="Type de produit"
        options={filtersData?.product_types ?? []}
        selected={filters.types}
        onChange={(v) => set("types", v)}
        labelMap={PRODUCT_TYPE_LABELS}
        maxVisible={6}
      />

      {/* SFDR */}
      <SfdrSelect
        selected={filters.sfdr}
        options={filtersData?.sfdr_articles ?? []}
        onChange={(v) => set("sfdr", v)}
      />

      {/* Région */}
      <MultiSelect
        label="Région"
        options={filtersData?.regions ?? []}
        selected={filters.regions}
        onChange={(v) => set("regions", v)}
        labelMap={REGION_LABELS}
        maxVisible={7}
      />

      {/* Catégorie */}
      <MultiSelect
        label="Catégorie"
        options={filtersData?.categories ?? []}
        selected={filters.categories}
        onChange={(v) => set("categories", v)}
        maxVisible={6}
      />

      {/* Secteur */}
      {(filtersData?.sectors?.length ?? 0) > 0 && (
        <MultiSelect
          label="Secteur"
          options={filtersData?.sectors ?? []}
          selected={filters.sectors}
          onChange={(v) => set("sectors", v)}
          maxVisible={5}
        />
      )}

      {/* Éligibilités */}
      <div className="mb-5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">Éligibilités</span>
        <div className="space-y-2">
          {([["PEA", "pea"], ["PER", "per"], ["AV Luxembourg", "av_lux"]] as const).map(([label, key]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters[key]}
                onChange={(e) => set(key, e.target.checked)}
                className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5"
              />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* SRI */}
      <div className="mb-5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">Risque SRI (1–7)</span>
        <div className="flex items-center gap-2">
          <input
            type="number" min="1" max="7" value={filters.sri_min}
            onChange={(e) => set("sri_min", e.target.value)}
            placeholder="Min" className="w-16 border border-gray-200 rounded px-2 py-1.5 text-sm text-center"
          />
          <span className="text-gray-400 text-sm">–</span>
          <input
            type="number" min="1" max="7" value={filters.sri_max}
            onChange={(e) => set("sri_max", e.target.value)}
            placeholder="Max" className="w-16 border border-gray-200 rounded px-2 py-1.5 text-sm text-center"
          />
        </div>
      </div>

      {/* TER max */}
      <div className="mb-5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">TER max (%)</span>
        <input
          type="number" step="0.1" min="0" value={filters.ter_max}
          onChange={(e) => set("ter_max", e.target.value)}
          placeholder={filtersData?.ter_range?.max ? `≤ ${filtersData.ter_range.max}%` : "Ex: 1.0"}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {/* Perf 3Y min */}
      <div className="mb-6">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">Perf 3Y min (%)</span>
        <input
          type="number" value={filters.perf_3y_min}
          onChange={(e) => set("perf_3y_min", e.target.value)}
          placeholder="Ex: 10"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {/* CTA */}
      <button
        onClick={onSearch}
        disabled={loading}
        className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Chargement…" : totalResults !== undefined ? `Voir les ${totalResults?.toLocaleString("fr")} fonds` : "Rechercher"}
      </button>
    </aside>
  );
}
