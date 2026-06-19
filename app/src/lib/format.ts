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

/**
 * Convertit une fraction de frais stockée en base (canonique : 0.018 = 1,8 %)
 * en pourcentage d'affichage (1.8). Source de vérité unique pour TER / frais
 * courants, utilisée à la frontière API. Renvoie null si absent.
 * Arrondi à 4 décimales pour neutraliser le bruit flottant (0.018*100 = 1.7999…).
 */
export function feeFracToPct(v: number | null | undefined): number | null {
  if (v == null) return null;
  return Math.round(v * 1e6) / 1e4;
}

/**
 * Convertit une performance CUMULÉE sur N années (ex: 57.5 = +57,5 % sur 3 ans)
 * en performance ANNUALISÉE (%/an), convention standard CGP (Morningstar/Quantalys).
 * La base stocke les perfs 3y/5y en cumulé ; la frontière API les annualise.
 * Doit rester aligné avec la fonction SQL inv_annualize() (vue + RPC).
 * Renvoie null si absent, ou si la perte est ≥ 100 % (donnée invalide, base ≤ 0).
 */
export function annualizeCumul(
  cumulPct: number | null | undefined,
  years: number,
): number | null {
  if (cumulPct == null) return null;
  if (cumulPct <= -100) return null;
  return Math.round((Math.pow(1 + cumulPct / 100, 1 / years) - 1) * 1e4) / 1e2;
}

// Produits à taux ANNUEL (SCPI = taux de distribution, livret = taux) : leurs
// perfs multi-années sont déjà annuelles, ne pas les annualiser. Les autres
// (OPCVM/ETF/action…) stockent du cumulé. Aligné avec inv_annualize_pt() (SQL).
const ANNUAL_RATE_TYPES = new Set(["scpi", "livret"]);
export function annualizeForType(
  cumulPct: number | null | undefined,
  years: number,
  productType: string | null | undefined,
): number | null {
  if (cumulPct == null) return null;
  if (productType && ANNUAL_RATE_TYPES.has(productType)) return cumulPct;
  return annualizeCumul(cumulPct, years);
}

// ─── Perf nette de frais (côté client) ───────────────────────────────────────
// La perf VL est DÉJÀ nette du TER/frais courants (la VL est publiée nette des
// frais du fonds). Le seul surcoût client AU-DESSUS de la VL est le frais de
// gestion du CONTRAT (enveloppe). On ne re-soustrait donc JAMAIS le TER ni la
// rétrocession (déjà dans les frais courants reflétés par la VL) — sinon double
// comptage. La rétro est la rému du CGP, prélevée DANS les frais courants : elle
// reste informative, jamais déduite ici.

// Frais de gestion annuels par défaut, par enveloppe (%/an). Paramétrables :
// surchargeables via une prop UI. PEA/CTO = titres en direct, pas de frais
// d'enveloppe ; AV/PER = frais de gestion des unités de compte.
export const CONTRACT_FEE_DEFAULTS: Record<string, number> = {
  "AV-FR": 0.8,
  "AV-LUX": 0.8,
  PER: 0.6,
  "PEA": 0,
  "PEA-PME": 0,
  CTO: 0,
};

export const CONTRACT_FEE_LABELS: Record<string, string> = {
  "AV-FR": "Assurance-vie (France)",
  "AV-LUX": "Assurance-vie (Luxembourg)",
  PER: "PER",
  "PEA": "PEA",
  "PEA-PME": "PEA-PME",
  CTO: "Compte-titres",
};

/**
 * Performance ANNUELLE nette pour le client : perf annualisée du fonds (déjà
 * nette de TER) moins le frais de gestion annuel du contrat. Renvoie null si la
 * perf est absente. Le frais est en %/an (ex: 0.8). Ne déduit ni TER ni rétro.
 */
export function perfNetteClient(
  perfAnnuelPct: number | null | undefined,
  fraisContratPct: number | null | undefined,
): number | null {
  if (perfAnnuelPct == null) return null;
  return Math.round((perfAnnuelPct - (fraisContratPct ?? 0)) * 1e2) / 1e2;
}

export function eur(v: number | null | undefined): string {
  if (v == null) return "—";
  return nf.format(v) + " M€";
}

export function fmtAum(v: number | null | undefined): string {
  if (v == null) return "—";
  const m = v / 1_000_000;
  if (m >= 1000) return nf.format(Math.round(m / 100) * 100) + " M€";
  return nf1.format(m) + " M€";
}

export function fmtAumShort(v: number | null | undefined): string {
  if (v == null) return "—";
  const bn = v / 1_000_000_000;
  if (bn >= 10) return `${Math.round(bn)} Md€`;
  if (bn >= 1)  return `${nf1.format(bn)} Md€`;
  const m = v / 1_000_000;
  if (m >= 100) return `${Math.round(m)} M€`;
  if (m >= 1)   return `${nf1.format(m)} M€`;
  return `< 1 M€`;
}

export function dt(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Défensif : une date au format français JJ/MM/AAAA serait interprétée par
  // `new Date()` comme MM/JJ (convention US) → jour et mois inversés. On la
  // convertit en ISO avant parsing. (Cas vu sur l'extraction DICI.)
  const fr = iso.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const norm = fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : iso;
  const d = new Date(norm);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR");
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
