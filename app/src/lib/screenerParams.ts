// ─── Sérialisation des filtres screener ⇄ URL ────────────────────────────────
// `buildParams` : ParsedFilters → URLSearchParams (requête /api/funds + URL
// partageable). `filtersFromParams` : l'inverse, pour hydrater le screener à
// l'arrivée (page Profil client, lien partagé, enveloppe/assureur depuis
// l'accueil). Les deux partagent les MÊMES noms de clés → round-trip garanti.

import type { ParsedFilters } from "./types";

export function buildParams(
  f: ParsedFilters,
  page: number,
  sortBy: string,
  sortDir: string,
): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.sfdr?.length)               sp.set("sfdr",              f.sfdr.join(","));
  if (f.sri_min        != null)      sp.set("sri_min",           String(f.sri_min));
  if (f.sri_max        != null)      sp.set("sri_max",           String(f.sri_max));
  if (f.ter_max        != null)      sp.set("ter_max",           String(f.ter_max));
  if (f.perf_1y_min    != null)      sp.set("perf_1y_min",       String(f.perf_1y_min));
  if (f.perf_3y_min    != null)      sp.set("perf_3y_min",       String(f.perf_3y_min));
  if (f.perf_5y_min    != null)      sp.set("perf_5y_min",       String(f.perf_5y_min));
  if (f.vol_max        != null)      sp.set("vol_max",           String(f.vol_max));
  if (f.vol_3y_max     != null)      sp.set("vol_3y_max",        String(f.vol_3y_max));
  if (f.sharpe_min     != null)      sp.set("sharpe_min",        String(f.sharpe_min));
  if (f.sharpe_3y_min  != null)      sp.set("sharpe_3y_min",     String(f.sharpe_3y_min));
  if (f.drawdown_max   != null)      sp.set("drawdown_max",      String(f.drawdown_max));
  if (f.no_entry_fee)                sp.set("no_entry_fee",      "true");
  if (f.aum_min        != null)      sp.set("aum_min",           String(f.aum_min));
  if (f.track_record_min != null)    sp.set("track_record_min",  String(f.track_record_min));
  if (f.morningstar_min  != null)    sp.set("morningstar_min",   String(f.morningstar_min));
  if (f.retrocession_min != null)    sp.set("retrocession_min",  String(f.retrocession_min));
  if (f.envelopes?.length)           sp.set("envelopes",         f.envelopes.join(","));
  if (f.universe?.length)            sp.set("universe",          f.universe.join(","));
  if (f.asset_class?.length)         sp.set("asset_class",       f.asset_class.join(","));
  if (f.allocation_profile?.length)  sp.set("allocation_profile",f.allocation_profile.join(","));
  if (f.insurers?.length)            sp.set("insurer",           f.insurers.join(","));
  if (f.contracts?.length)           sp.set("contracts",         f.contracts.join(","));
  if (f.gestionnaires?.length)       sp.set("gestionnaire_in",   f.gestionnaires.join(","));
  if (f.region?.length)              sp.set("region",            f.region.join(","));
  if (f.sector?.length)              sp.set("sector",            f.sector.join(","));
  if (f.exclude_sectors?.length)     sp.set("exclude_sector",    f.exclude_sectors.join(","));
  if (f.exclude_regions?.length)     sp.set("exclude_region",    f.exclude_regions.join(","));
  if (f.management_style?.length)    sp.set("management_style",  f.management_style.join(","));
  if (f.currency?.length)            sp.set("currency",          f.currency.join(","));
  if (f.manager_search)              sp.set("manager_search",    f.manager_search);
  if (f.free_text)                   sp.set("search",            f.free_text);
  if (f.has_kid)                     sp.set("has_kid",           "true");
  sp.set("sort_by",  sortBy);
  sp.set("sort_dir", sortDir);
  sp.set("page",     String(page));
  sp.set("per_page", "50");
  return sp;
}

// Inverse de buildParams. Ne lit QUE les clés de filtre (ignore sort_by/page/
// per_page) → l'objet retourné est vide quand l'URL ne porte aucun filtre.
export function filtersFromParams(sp: URLSearchParams): ParsedFilters {
  const f: ParsedFilters = {};
  const list = (k: string) => { const v = sp.get(k); return v ? v.split(",").filter(Boolean) : undefined; };
  const num  = (k: string) => { const v = sp.get(k); return v != null && v !== "" ? Number(v) : undefined; };

  if (sp.has("sfdr")) f.sfdr = (list("sfdr") ?? []).map(Number).filter((n) => !Number.isNaN(n));
  const numKeys: [string, keyof ParsedFilters][] = [
    ["sri_min", "sri_min"], ["sri_max", "sri_max"], ["ter_max", "ter_max"],
    ["perf_1y_min", "perf_1y_min"], ["perf_3y_min", "perf_3y_min"], ["perf_5y_min", "perf_5y_min"],
    ["vol_max", "vol_max"], ["vol_3y_max", "vol_3y_max"], ["sharpe_min", "sharpe_min"],
    ["sharpe_3y_min", "sharpe_3y_min"], ["drawdown_max", "drawdown_max"], ["aum_min", "aum_min"],
    ["track_record_min", "track_record_min"], ["morningstar_min", "morningstar_min"],
    ["retrocession_min", "retrocession_min"],
  ];
  for (const [param, key] of numKeys) {
    const v = num(param);
    if (v != null && !Number.isNaN(v)) (f[key] as number) = v;
  }
  if (sp.get("no_entry_fee") === "true") f.no_entry_fee = true;
  if (sp.get("has_kid")      === "true") f.has_kid      = true;

  const arrKeys: [string, keyof ParsedFilters][] = [
    ["envelopes", "envelopes"], ["universe", "universe"], ["asset_class", "asset_class"],
    ["allocation_profile", "allocation_profile"], ["insurer", "insurers"], ["contracts", "contracts"],
    ["gestionnaire_in", "gestionnaires"], ["region", "region"], ["sector", "sector"],
    ["exclude_sector", "exclude_sectors"], ["exclude_region", "exclude_regions"],
    ["management_style", "management_style"], ["currency", "currency"],
  ];
  for (const [param, key] of arrKeys) {
    const v = list(param);
    if (v?.length) (f[key] as string[]) = v;
  }
  if (sp.get("manager_search")) f.manager_search = sp.get("manager_search")!;
  if (sp.get("search"))         f.free_text      = sp.get("search")!;

  return f;
}

// ─── Libellés lisibles des filtres issus du profil client ─────────────────────
// Source unique partagée entre la barre d'action de la page Profil client et le
// bandeau de contexte du screener (après redirection « Trouver les fonds adaptés »).
// Ne décrit que les clés qu'un profil produit ; le reste (assureur/contrat) a ses
// propres bandeaux.
const ENVELOPE_FILTER_LABELS: Record<string, string> = {
  PEA: "PEA", "PEA-PME": "PEA-PME", PER: "PER",
  "AV-FR": "AV France", "AV-LUX": "AV Luxembourg", CTO: "CTO",
};
const ASSET_BROAD_FILTER_LABELS: Record<string, string> = {
  action: "Actions", obligation: "Obligataire", immobilier: "Immobilier",
  alternatif: "Alternatif", monetaire: "Monétaire", diversifie: "Diversifié",
  matieres_premieres: "Matières prem.",
};

export function describeScreenerFilters(f: ParsedFilters): string[] {
  const out: string[] = [];
  if (f.sri_min != null)      out.push(`SRI ≥ ${f.sri_min}`);
  if (f.sri_max != null)      out.push(`SRI ≤ ${f.sri_max}`);
  if (f.sfdr?.length)         out.push(`SFDR Art. ${f.sfdr.join(" / ")}`);
  if (f.drawdown_max != null) out.push(`Perte ≤ ${f.drawdown_max} %`);
  for (const e of f.envelopes ?? [])   out.push(ENVELOPE_FILTER_LABELS[e] ?? e);
  for (const a of f.asset_class ?? []) out.push(ASSET_BROAD_FILTER_LABELS[a] ?? a);
  return out;
}
