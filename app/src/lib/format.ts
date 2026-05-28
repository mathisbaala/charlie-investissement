export const nf  = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
export const nf1 = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
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
