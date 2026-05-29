const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
};

export function decodeHtml(s: string | null | undefined): string {
  if (!s) return s ?? "";
  return s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => HTML_ENTITIES[m] ?? m);
}

export const nf  = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
export const nf1 = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export const nf2 = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function pct(v: number | null | undefined, sign = false): string {
  if (v == null) return "—";
  return (sign && v > 0 ? "+" : "") + nf1.format(v) + " %";
}

export function eur(v: number | null | undefined): string {
  if (v == null) return "—";
  return nf.format(v) + " M€";
}

export function fmtAum(v: number | null | undefined): string {
  if (v == null) return "—";
  // v is already in euros (not M€), convert to M€
  const m = v / 1_000_000;
  if (m >= 1000) return nf.format(Math.round(m / 100) * 100) + " M€";
  return nf1.format(m) + " M€";
}

export function dt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
}

export function dtYear(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).getFullYear().toString();
}

export function fmtSharpe(v: number | null | undefined): string {
  if (v == null) return "—";
  return nf2.format(v);
}

export function fmtYears(v: number | null | undefined): string | null {
  if (v == null) return null;
  return nf1.format(v) + " ans";
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  opcvm: "OPCVM", etf: "ETF", scpi: "SCPI", fps: "FPS",
  "fonds-euros": "Fonds euros", fonds_euros: "Fonds euros", opci: "OPCI",
  fcp: "FCP", sicav: "SICAV", fpci: "FPCI", fcpr: "FCPR",
  action: "Action", obligation: "Obligation", crypto: "Crypto", livret: "Livret",
};

export function productTypeLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return PRODUCT_TYPE_LABELS[v.toLowerCase()] ?? (v.charAt(0).toUpperCase() + v.slice(1));
}

export function capitalize(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.charAt(0).toUpperCase() + v.slice(1);
}
