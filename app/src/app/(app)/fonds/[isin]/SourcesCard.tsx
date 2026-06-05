import type { FundDetailHF } from "@/lib/types";

// Libellés humains pour les clés de champ tracées dans field_sources.
const FIELD_LABELS: Record<string, string> = {
  ter: "Frais courants",
  ongoing_charges: "Frais courants",
  performance_1y: "Perf. 1 an",
  performance_3y: "Perf. 3 ans",
  performance_5y: "Perf. 5 ans",
  volatility_1y: "Volatilité 1 an",
  volatility_3y: "Volatilité 3 ans",
  sharpe_1y: "Sharpe 1 an",
  sharpe_3y: "Sharpe 3 ans",
  max_drawdown_1y: "Drawdown 1 an",
  max_drawdown_3y: "Drawdown 3 ans",
  sri: "SRI",
  srri: "SRRI",
  aum_eur: "Encours",
  morningstar_rating: "Note Morningstar",
  sfdr_article: "Article SFDR",
  inception_date: "Date de création",
  kid_url: "DICI",
  management_company: "Société de gestion",
};

// Affichage propre des noms de sources.
const SOURCE_LABELS: Record<string, string> = {
  "amf-geco": "AMF GECO",
  "wikidata-yahoo-eu": "Wikidata / Yahoo",
  "yahoo-finance": "Yahoo Finance",
  euronext: "Euronext",
  coingecko: "CoinGecko",
  quantalys: "Quantalys",
  kid_pdf: "DICI (PDF)",
  morningstar: "Morningstar",
  justetf: "JustETF",
  aspim: "ASPIM",
};

function srcName(raw: string): string {
  return SOURCE_LABELS[raw] ?? raw;
}

// Une valeur de field_sources peut être une string ("quantalys") ou un objet {source, at}.
function extractSource(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "source" in v) {
    const s = (v as { source?: unknown }).source;
    return typeof s === "string" ? s : null;
  }
  return null;
}

export function SourcesCard({ fund }: { fund: FundDetailHF }) {
  const fs = fund.field_sources;
  const entries: { label: string; source: string }[] = [];
  const seen = new Set<string>();

  if (fs && typeof fs === "object") {
    for (const [key, val] of Object.entries(fs)) {
      const label = FIELD_LABELS[key];
      const source = extractSource(val);
      if (!label || !source) continue;
      const dedupKey = `${label}|${source}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      entries.push({ label, source });
    }
  }

  // Rien de tracé par champ : on retombe sur la source legacy si disponible.
  if (entries.length === 0) {
    if (!fund.data_source) return null;
    return (
      <div className="bg-paper rounded-2xl border border-line px-6 py-5">
        <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Provenance des données</h3>
        <p className="text-[12px] text-muted">
          Source principale&nbsp;: <span className="text-ink-2 font-medium">{srcName(fund.data_source)}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Provenance des données</h3>
      <table className="w-full">
        <tbody>
          {entries.map(({ label, source }) => (
            <tr key={`${label}-${source}`} className="border-b border-line-soft last:border-0">
              <td className="py-2 text-[12px] text-muted pr-4">{label}</td>
              <td className="py-2 text-[12px] text-ink-2 text-right font-medium">{srcName(source)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {fund.data_source && (
        <p className="text-[10.5px] text-muted-2 mt-3">
          Source de référence&nbsp;: {srcName(fund.data_source)}
        </p>
      )}
    </div>
  );
}
