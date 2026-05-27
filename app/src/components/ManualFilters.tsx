"use client";

import { useState } from "react";
import type { ScreenerFilters } from "@/lib/claude";

interface Props {
  onSearch: (filters: ScreenerFilters) => void;
  activeFilters: ScreenerFilters;
}

export default function ManualFilters({ onSearch }: Props) {
  const [open, setOpen] = useState(false);
  const [sfdr, setSfdr] = useState<number[]>([]);
  const [sriMin, setSriMin] = useState("");
  const [sriMax, setSriMax] = useState("");
  const [terMax, setTerMax] = useState("");
  const [perf1yMin, setPerf1yMin] = useState("");
  const [pea, setPea] = useState(false);
  const [av, setAv] = useState(false);
  const [per, setPer] = useState(false);
  const [avLux, setAvLux] = useState(false);

  function toggleSfdr(v: number) {
    setSfdr((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  }

  function apply() {
    const f: ScreenerFilters = {};
    if (sfdr.length) f.sfdr_article = sfdr;
    if (sriMin) f.sri_min = Number(sriMin);
    if (sriMax) f.sri_max = Number(sriMax);
    if (terMax) f.ter_max = Number(terMax);
    if (perf1yMin) f.perf_1y_min = Number(perf1yMin);
    if (pea) f.is_pea_eligible = true;
    if (av) f.is_av_eligible = true;
    if (per) f.is_per_eligible = true;
    if (avLux) f.is_av_lux_eligible = true;
    onSearch(f);
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 text-left text-sm font-medium text-gray-700 flex items-center justify-between hover:bg-gray-50"
      >
        <span>Filtres manuels</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-gray-100 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">SFDR Article</label>
              <div className="flex gap-2">
                {[6, 8, 9].map((v) => (
                  <button
                    key={v}
                    onClick={() => toggleSfdr(v)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border ${sfdr.includes(v) ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:border-gray-400"}`}
                  >
                    Art.{v}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">SRI (risque)</label>
              <div className="flex gap-2 items-center">
                <input type="number" min="1" max="7" value={sriMin} onChange={(e) => setSriMin(e.target.value)} placeholder="min" className="w-16 border border-gray-300 rounded px-2 py-1.5 text-xs" />
                <span className="text-gray-400">→</span>
                <input type="number" min="1" max="7" value={sriMax} onChange={(e) => setSriMax(e.target.value)} placeholder="max" className="w-16 border border-gray-300 rounded px-2 py-1.5 text-xs" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">TER max (%)</label>
              <input type="number" step="0.1" value={terMax} onChange={(e) => setTerMax(e.target.value)} placeholder="Ex: 1.0" className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Perf 1Y min (%)</label>
              <input type="number" value={perf1yMin} onChange={(e) => setPerf1yMin(e.target.value)} placeholder="Ex: 5" className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs" />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-600 mb-2">Éligibilités</label>
            <div className="flex gap-3">
              {[["PEA", pea, setPea], ["AV FR", av, setAv], ["PER", per, setPer], ["AV Lux", avLux, setAvLux]].map(([label, val, setter]) => (
                <label key={label as string} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={val as boolean} onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)} className="rounded" />
                  <span className="text-xs text-gray-700">{label as string}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={apply}
            className="mt-4 px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700"
          >
            Appliquer les filtres
          </button>
        </div>
      )}
    </div>
  );
}
