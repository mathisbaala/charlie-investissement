"use client";

import Link from "next/link";
import type { Fund } from "@/lib/supabase";

function fmt(n: number | null, suffix = "%", decimals = 2) {
  if (n == null) return "—";
  return `${n.toFixed(decimals)}${suffix}`;
}

function SriBadge({ sri }: { sri: number | null | undefined }) {
  if (!sri) return <span className="text-gray-400">—</span>;
  const colors = ["", "bg-green-100 text-green-800", "bg-green-100 text-green-800", "bg-yellow-100 text-yellow-800", "bg-yellow-100 text-yellow-800", "bg-orange-100 text-orange-800", "bg-red-100 text-red-800", "bg-red-200 text-red-900"];
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[sri] ?? "bg-gray-100 text-gray-700"}`}>SRI {sri}</span>;
}

function SfdrBadge({ article }: { article: number | null }) {
  if (!article) return <span className="text-gray-400">—</span>;
  const colors: Record<number, string> = { 6: "bg-gray-100 text-gray-700", 8: "bg-green-100 text-green-700", 9: "bg-emerald-100 text-emerald-700" };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[article] ?? "bg-gray-100 text-gray-700"}`}>Art.{article}</span>;
}

export default function FundTable({ funds }: { funds: Fund[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Fonds</th>
            <th className="text-center px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">SFDR</th>
            <th className="text-center px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Risque</th>
            <th className="text-right px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">TER</th>
            <th className="text-right px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Perf 1Y</th>
            <th className="text-right px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Perf 3Y</th>
            <th className="text-center px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Éligibilités</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {funds.map((f) => (
            <tr key={f.isin} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-900 truncate max-w-xs" title={f.name}>{f.name}</div>
                <div className="text-xs text-gray-400">{f.isin} · {f.gestionnaire ?? f.management_company ?? "—"}</div>
              </td>
              <td className="px-3 py-3 text-center"><SfdrBadge article={f.sfdr_article} /></td>
              <td className="px-3 py-3 text-center"><SriBadge sri={f.risk_score ?? f.sri} /></td>
              <td className="px-3 py-3 text-right text-gray-700">{fmt(f.ongoing_charges)}</td>
              <td className={`px-3 py-3 text-right font-medium ${f.performance_1y == null ? "" : f.performance_1y >= 0 ? "text-green-600" : "text-red-600"}`}>
                {fmt(f.performance_1y)}
              </td>
              <td className={`px-3 py-3 text-right font-medium ${f.performance_3y == null ? "" : f.performance_3y >= 0 ? "text-green-600" : "text-red-600"}`}>
                {fmt(f.performance_3y)}
              </td>
              <td className="px-3 py-3 text-center">
                <div className="flex gap-1 justify-center flex-wrap">
                  {f.pea_eligible && <span className="bg-blue-50 text-blue-700 text-xs px-1.5 py-0.5 rounded">PEA</span>}
                  {f.per_eligible && <span className="bg-indigo-50 text-indigo-700 text-xs px-1.5 py-0.5 rounded">PER</span>}
                  {f.av_lux_eligible && <span className="bg-yellow-50 text-yellow-700 text-xs px-1.5 py-0.5 rounded">AV Lux</span>}
                </div>
              </td>
              <td className="px-3 py-3">
                <Link
                  href={`/fonds/${f.isin}`}
                  className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                >
                  Fiche →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
