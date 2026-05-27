import { supabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import Link from "next/link";
import PerformanceChart from "@/components/PerformanceChart";

function fmt(n: number | null, suffix = "%", d = 2) {
  return n == null ? "—" : `${n.toFixed(d)}${suffix}`;
}

function Row({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="flex justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

function EligBadge({ label, ok }: { label: string; ok: boolean | null }) {
  if (!ok) return null;
  return <span className="inline-block px-2 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded">{label}</span>;
}

export default async function FicheFonds({
  params,
}: {
  params: Promise<{ isin: string }>;
}) {
  const { isin } = await params;

  const { data: fund, error } = await supabase
    .from("investissement_funds")
    .select("*")
    .eq("isin", isin)
    .single();

  if (error || !fund) notFound();

  const incomplete = fund.data_completeness < 80;
  const trackRecord = fund.inception_date
    ? Math.floor((Date.now() - new Date(fund.inception_date).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : null;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Screener
          </Link>
          <Link href="/matching" className="text-sm text-blue-600 hover:underline">
            Matching client
          </Link>
        </div>

        {incomplete && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4 text-amber-700 text-xs">
            Données partielles — certains champs non vérifiés (complétude {fund.data_completeness}%)
          </div>
        )}

        {/* En-tête */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{fund.name}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {fund.isin} · {fund.management_company ?? "Société de gestion inconnue"}
              </p>
            </div>
            <a
              href={`/api/fonds/${isin}/pdf`}
              target="_blank"
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium shrink-0"
            >
              Télécharger PDF
            </a>
          </div>

          <div className="flex gap-2 flex-wrap">
            {fund.sfdr_article && (
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                fund.sfdr_article === 9 ? "bg-emerald-100 text-emerald-700" :
                fund.sfdr_article === 8 ? "bg-green-100 text-green-700" :
                "bg-gray-100 text-gray-700"
              }`}>
                SFDR Art.{fund.sfdr_article}
              </span>
            )}
            {fund.sri && (
              <span className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-700">
                SRI {fund.sri}/7
              </span>
            )}
            {fund.morningstar_rating && (
              <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                ★ Morningstar {fund.morningstar_rating}/5
              </span>
            )}
          </div>
        </div>

        {/* Performances + graphique */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Performances</h2>
            <Row label="1 an" value={fmt(fund.performance_1y)} />
            <Row label="3 ans" value={fmt(fund.performance_3y)} />
            <Row label="5 ans" value={fmt(fund.performance_5y)} />
            <Row label="Volatilité 1Y" value={fmt(fund.volatility_1y)} />
            <Row label="Sharpe 1Y" value={fmt(fund.sharpe_1y, "", 2)} />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Graphique des performances</h2>
            <PerformanceChart
              perf1y={fund.performance_1y}
              perf3y={fund.performance_3y}
              perf5y={fund.performance_5y}
            />
          </div>
        </div>

        {/* Caractéristiques + Éligibilités */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Caractéristiques</h2>
            <Row label="TER / Frais" value={fmt(fund.ongoing_charges)} />
            <Row label="Encours (AUM)" value={fund.aum_eur ? `${(fund.aum_eur / 1_000_000).toFixed(0)} M€` : "—"} />
            <Row label="Date de création" value={fund.inception_date ? new Date(fund.inception_date).toLocaleDateString("fr-FR") : "—"} />
            <Row label="Track record" value={trackRecord ? `${trackRecord} ans` : "—"} />
            <Row label="Type" value={fund.product_type ?? "—"} />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Éligibilités</h2>
            <div className="flex gap-2 flex-wrap">
              <EligBadge label="PEA" ok={fund.pea_eligible} />
              <EligBadge label="PER" ok={fund.per_eligible} />
              <EligBadge label="AV Luxembourg" ok={fund.av_lux_eligible} />
              {!fund.pea_eligible && !fund.per_eligible && !fund.av_lux_eligible && (
                <span className="text-sm text-gray-400">Aucune éligibilité confirmée</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
