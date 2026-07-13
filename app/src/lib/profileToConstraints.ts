// Profil client → contraintes du moteur d'allocation. Traduit un profil (niveau
// de risque, classes d'actifs souhaitées, tolérance) en répartition cible par
// classe + plafond de SRI. Fonction pure et testable — le cœur du « je saisis le
// client, ça génère l'allocation ».

import type { RiskProfile, RichClientProfile } from "./clientProfile";
import type { AssetClass, OptimizerConstraints, FundInput } from "./optimizer";

// Répartition cible par défaut selon le niveau de risque (profil MIF).
const RISK_TARGETS: Record<RiskProfile, Partial<Record<AssetClass, number>>> = {
  prudent: { obligations: 55, monetaire: 20, diversifie: 15, actions: 10 },
  modere: { obligations: 45, actions: 25, diversifie: 20, monetaire: 10 },
  equilibre: { actions: 45, obligations: 30, diversifie: 20, monetaire: 5 },
  dynamique: { actions: 65, diversifie: 20, obligations: 15 },
  offensif: { actions: 80, diversifie: 15, obligations: 5 },
};

// SRI moyen pondéré plafond, par niveau de risque.
const RISK_MAX_SRI: Record<RiskProfile, number> = {
  prudent: 3,
  modere: 4,
  equilibre: 4,
  dynamique: 5,
  offensif: 7,
};

// Classes du profil (valeurs du formulaire) → classes canoniques du moteur.
const PROFILE_CLASS_TO_BUCKET: Record<string, AssetClass> = {
  actions: "actions",
  obligations: "obligations",
  scpi: "immobilier",
  immobilier: "immobilier",
  monetaire: "monetaire",
  multi_actifs: "diversifie",
  private_equity: "alternatif",
};

/** Renormalise une table de cibles pour que la somme fasse 100. */
export function renormalize(
  targets: Partial<Record<AssetClass, number>>,
): Partial<Record<AssetClass, number>> {
  const entries = Object.entries(targets).filter(([, v]) => (v ?? 0) > 0);
  const sum = entries.reduce((s, [, v]) => s + (v as number), 0);
  if (sum <= 0) return {};
  const out: Partial<Record<AssetClass, number>> = {};
  for (const [k, v] of entries) out[k as AssetClass] = Math.round(((v as number) / sum) * 1000) / 10;
  return out;
}

/**
 * Cibles par classe pour un profil : part de la répartition type du niveau de
 * risque, restreinte aux classes souhaitées si le client en a coché (renormalisé).
 */
export function targetsForProfile(
  risk: RiskProfile,
  chosenClasses: string[] = [],
): Partial<Record<AssetClass, number>> {
  const base = { ...RISK_TARGETS[risk] };

  const buckets = chosenClasses
    .map((c) => PROFILE_CLASS_TO_BUCKET[c])
    .filter((b): b is AssetClass => !!b);

  if (buckets.length === 0) return renormalize(base);

  // Restreint aux classes choisies : on garde leur poids de base, et on donne un
  // poids plancher aux classes choisies absentes de la répartition type.
  const wanted = new Set(buckets);
  const restricted: Partial<Record<AssetClass, number>> = {};
  for (const b of wanted) restricted[b] = base[b] ?? 10;
  return renormalize(restricted);
}

// Plafond de SRI moyen induit par la tolérance à la perte maximale déclarée.
const PERTE_MAX_SRI: Record<string, number> = {
  "5": 3,
  "10": 4,
  "20": 5,
  "30": 6,
  // "illimitee" → aucun plafond additionnel
};

/**
 * Traduit un profil client complet en contraintes d'optimisation partielles
 * (cibles de classe + plafond SRI). Profil de risque absent → « equilibre » par
 * défaut (choix prudent et neutre). La tolérance à la perte, si renseignée,
 * DURCIT le plafond de SRI (on prend le plus contraignant des deux). Les autres
 * réglages (min/max lignes, plafond par fonds) restent aux valeurs par défaut du
 * moteur, surchargeables par l'UI.
 */
export function profileToConstraints(
  profile: Pick<RichClientProfile, "risk_profile" | "asset_classes"> &
    Partial<Pick<RichClientProfile, "max_ter" | "perte_max">>,
): Partial<OptimizerConstraints> {
  const risk: RiskProfile = profile.risk_profile ?? "equilibre";
  let maxSri = RISK_MAX_SRI[risk];
  const perteCap = profile.perte_max ? PERTE_MAX_SRI[profile.perte_max] : undefined;
  if (perteCap != null) maxSri = Math.min(maxSri, perteCap);
  return {
    classTargets: targetsForProfile(risk, profile.asset_classes ?? []),
    maxWeightedSri: maxSri,
  };
}

// Zones géographiques du profil (vocabulaire UI) → valeurs region_normalized de
// la base. Une zone du profil couvre plusieurs régions fines de la taxonomie.
export const GEO_TO_REGIONS: Record<string, string[]> = {
  monde: ["world"],
  europe: ["europe", "eurozone", "france", "germany", "switzerland", "uk"],
  zone_euro: ["eurozone", "france", "germany"],
  amerique_nord: ["usa"],
  emergents: ["emerging", "china", "india", "brazil"],
  asie: ["asia", "japan", "china", "india"],
  france: ["france"],
};

/** Régions de la base autorisées par les zones du profil (null = pas de contrainte). */
export function regionsForGeographies(geographies: string[]): Set<string> | null {
  const out = new Set<string>();
  for (const g of geographies) for (const r of GEO_TO_REGIONS[g] ?? []) out.add(r);
  return out.size > 0 ? out : null;
}

export interface UniverseFilterOptions {
  /** Frais courants maximum, en pourcentage (0.5 = 0,5 %). */
  maxTer?: number | null;
  /** Préférence ESG (art8 → SFDR 8/9 ; art9 → SFDR 9 ; sinon tout). */
  esg?: string | null;
  /** Zones géographiques du profil (vocabulaire UI, cf. GEO_TO_REGIONS). */
  geographies?: string[] | null;
  /** Plafond SRI par fonds (adéquation MIF : jamais plus risqué que la tolérance). */
  sriMax?: number | null;
  /** ISIN écartés à la main par le conseiller (« jeter un fonds »). */
  exclude?: string[] | null;
}

/**
 * Restreint l'univers selon les préférences « dures » (frais max, ESG, zones
 * géographiques, plafond SRI, exclusions manuelles). Un fonds dont la donnée est
 * absente n'est PAS écarté (on ne pénalise pas un trou de données) — sauf pour
 * les exclusions manuelles, toujours appliquées. Renvoie l'univers filtré + le
 * nombre de fonds retirés.
 *
 * Les zones géographiques ne contraignent QUE la classe actions : quand un
 * client demande une exposition « monde + Asie », il parle de ses actions — pas
 * d'écarter sa SCPI française, ses obligations euro ou son fonds monétaire, dont
 * la « région » relève d'une autre logique (immobilier physique, devise…).
 */
export function filterUniverse(
  funds: FundInput[],
  opts: UniverseFilterOptions,
): { funds: FundInput[]; dropped: number } {
  const { maxTer, esg, sriMax } = opts;
  const regions = regionsForGeographies(opts.geographies ?? []);
  const excluded = new Set((opts.exclude ?? []).map((s) => s.toUpperCase()));
  const kept = funds.filter((f) => {
    if (excluded.has(f.isin.toUpperCase())) return false;
    if (maxTer != null && f.ter != null && f.ter * 100 > maxTer + 1e-9) return false;
    if (esg === "art8" && !(f.sfdr === 8 || f.sfdr === 9)) return false;
    if (esg === "art9" && f.sfdr !== 9) return false;
    if (regions && f.assetClass === "actions" && f.region != null && !regions.has(f.region)) return false;
    if (sriMax != null && f.sri != null && f.sri > sriMax) return false;
    return true;
  });
  return { funds: kept, dropped: funds.length - kept.length };
}

/**
 * Restreint l'univers selon les préférences « dures » du profil (frais max, ESG,
 * zones géographiques). Enveloppe de `filterUniverse` pilotée par le profil.
 */
export function filterFundsByProfile(
  funds: FundInput[],
  profile: Pick<RichClientProfile, "max_ter" | "esg"> &
    Partial<Pick<RichClientProfile, "geographies">>,
): { funds: FundInput[]; dropped: number } {
  return filterUniverse(funds, {
    maxTer: profile.max_ter,
    esg: profile.esg,
    geographies: profile.geographies ?? [],
  });
}
