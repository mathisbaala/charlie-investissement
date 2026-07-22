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

// ─── Exclusions sectorielles ESG du profil (tabac, armes, fossiles…) ──────────
// Deux modes, trois sources de preuve. Contrainte de MANDAT, pas une préférence :
// jamais assouplie par le service.
//
// Mode PAR DÉFAUT (toujours actif) — on n'écarte que le PROUVÉ-INCOMPATIBLE :
//   • donnée EET documentée négative (le fonds déclare ne PAS exclure le
//     secteur, passesSectorExclusions) ;
//   • mandat du fonds dédié au thème exclu (mots-clés/secteur,
//     ethicalExclusionViolation).
//   Sans donnée, le fonds est conservé (best-effort, on ne pénalise pas un trou
//   de données).
//
// Mode STRICT (tenté d'abord par le service quand l'univers le permet) — chaque
// exclusion doit être PROUVÉE par l'une des sources (satisfiesDeclaredExclusions) :
//   • donnée EET documentée positive (le fonds déclare exclure) ;
//   • tag de politique déclarée excl-* (annexe SFDR) ;
//   • label officiel dont le référentiel GARANTIT l'exclusion (isr → tabac/armes,
//     greenfin → fossiles).
//   Les classes structurellement non exposées (monétaire, fonds euros,
//   immobilier, crypto) sont exemptées de preuve.

/** Exclusions sectorielles proposées par le profil client (recueil DDA). */
export const SECTOR_EXCLUSIONS = ["tabac", "armes", "fossiles", "jeux", "alcool"] as const;
export type SectorExclusion = (typeof SECTOR_EXCLUSIONS)[number];

// Clés de la donnée esg_exclusions (EET, FinDatEx) couvrant chaque exclusion du
// profil. « armes » : l'exclusion des armes controversées (standard PAB/CTB)
// suffit ; une exclusion armement TOTALE (weapons) la couvre a fortiori.
// « fossiles » exige la clé fossil — l'exclusion du seul charbon thermique
// n'exclut pas les fossiles.
const EXCLUSION_DATA_KEYS: Record<SectorExclusion, string[]> = {
  tabac: ["tobacco"],
  armes: ["controversial_weapons", "weapons"],
  fossiles: ["fossil"],
  jeux: ["gambling"],
  alcool: ["alcohol"],
};

/**
 * Proxy « labels » : labels officiels dont le RÉFÉRENTIEL garantit l'exclusion,
 * accepté comme PREUVE en mode strict quand la donnée esg_exclusions manque.
 * — Label ISR (référentiel V3, en vigueur mars 2025) : exclusion des armes
 *   controversées et des producteurs de tabac. Son exclusion fossile est
 *   PARTIELLE (charbon thermique + hydrocarbures non conventionnels) → non
 *   retenue comme garantie « fossiles ».
 * — Greenfin : exclusion des énergies fossiles.
 * — Aucun label français ne garantit jeux/alcool → tableau vide.
 */
export const EXCLUSION_GUARANTEE_LABELS: Record<SectorExclusion, string[]> = {
  tabac: ["isr"],
  armes: ["isr"],
  fossiles: ["greenfin"],
  jeux: [],
  alcool: [],
};

/**
 * Couche « documenté-négatif » du mode par défaut : un fonds n'est écarté que si
 * la donnée EET (esgExclusions) documente qu'il n'exclut PAS un secteur demandé
 * (toutes les clés couvrantes à false). Documenté positif → conforme ; absence
 * de donnée → conservé (best-effort : on ne pénalise pas un trou de données, le
 * mode strict — satisfiesDeclaredExclusions — exige la preuve, lui).
 */
export function passesSectorExclusions(
  f: Pick<FundInput, "esgExclusions" | "labels">,
  exclusions: SectorExclusion[],
): boolean {
  for (const ex of exclusions) {
    const data = f.esgExclusions;
    const documented = EXCLUSION_DATA_KEYS[ex]
      .map((k) => data?.[k])
      .filter((v): v is boolean => v !== undefined);
    if (documented.length > 0 && !documented.some((v) => v)) {
      return false; // documenté : le fonds n'exclut pas ce secteur
    }
  }
  return true;
}

/** Restreint une liste libre aux exclusions sectorielles connues. */
export function toSectorExclusions(raw: string[] | null | undefined): SectorExclusion[] {
  return (raw ?? []).filter((e): e is SectorExclusion =>
    (SECTOR_EXCLUSIONS as readonly string[]).includes(e),
  );
}

// Limite assumée du filtre de mandat : sans inventaires ligne à ligne, on
// écarte les fonds DONT LE MANDAT MÊME porte sur le thème exclu (secteur
// normalisé, nom, catégorie) — un fonds généraliste peut détenir une position
// marginale ; la revue IA et le look-through servent de contrôles complémentaires.

/** Vocabulaire d'exclusion du profil client (cf. EXCLUSION_OPTIONS du formulaire). */
export const ETHICAL_EXCLUSIONS = ["tabac", "armes", "fossiles", "jeux", "alcool"] as const;
export type EthicalExclusion = (typeof ETHICAL_EXCLUSIONS)[number];

// Mots-clés par thème, appliqués au nom + catégorie du fonds (français/anglais).
// Volontairement CIBLÉS pour ne pas écarter à tort : « gaming » (jeux vidéo)
// n'est pas « gambling » ; « energy transition »/« renewables » n'est pas du
// pétrole — mais le SECTEUR normalisé « Énergie » (qui couvre l'énergie classique)
// tombe avec « fossiles », comme dans le screener.
const ETHICAL_KEYWORDS: Record<EthicalExclusion, RegExp> = {
  tabac: /tabac|tobacco/i,
  armes: /d[ée]fen[cs]e|armement|\bmilitary\b|weapon|aerospace/i,
  fossiles: /p[ée]trole|petroleum|\boil\b|\bgas\b|fossil|charbon|\bcoal\b/i,
  jeux: /casino|gambling|betting|jeux\s+d['’]argent/i,
  alcool: /alcool|alcohol|spirits|brewer|\bwines?\b|\bvins?\b/i,
};

// Secteur normalisé de la base → thème exclu (fonds sectoriels dédiés).
const ETHICAL_SECTOR: Partial<Record<EthicalExclusion, string>> = {
  fossiles: "Énergie",
};

/** Exclusion du profil → tag de politique déclarée (labels du fonds). */
export const EXCLUSION_TO_POLICY_TAG: Record<EthicalExclusion, string> = {
  tabac: "excl-tabac",
  armes: "excl-armes",
  fossiles: "excl-fossiles",
  jeux: "excl-jeux",
  alcool: "excl-alcool",
};

// Classes d'actifs structurellement NON exposées aux thèmes éthiques (pas
// d'entreprises en portefeuille) : le mode « politique déclarée » ne leur
// demande pas d'annexe — un fonds monétaire n'a pas à déclarer qu'il exclut
// le tabac pour être conforme.
const POLICY_EXEMPT_CLASSES = new Set(["monetaire", "fonds_euros", "immobilier", "crypto"]);

/**
 * Mode STRICT : true si le fonds PROUVE chaque exclusion demandée — donnée EET
 * documentée positive (esgExclusions), tag de politique déclarée excl-* (annexe
 * SFDR), ou label officiel garant (isr → tabac/armes, greenfin → fossiles) — ou
 * n'a structurellement pas besoin de preuve (classe non exposée). Fonction pure.
 */
export function satisfiesDeclaredExclusions(
  fund: Pick<FundInput, "assetClass" | "exclusionPolicies" | "esgExclusions" | "labels">,
  exclusions: string[] | null | undefined,
): boolean {
  if (!exclusions?.length) return true;
  if (POLICY_EXEMPT_CLASSES.has(fund.assetClass)) return true;
  const declared = new Set(fund.exclusionPolicies ?? []);
  const labels = fund.labels ?? [];
  return exclusions.every((e) => {
    const excl = e as EthicalExclusion;
    const tag = EXCLUSION_TO_POLICY_TAG[excl];
    if (!tag) return true; // valeur inconnue : pas d'exigence
    // Preuve 1 : donnée EET documentée (elle prime — un documenté-négatif ne
    // peut pas être « rattrapé » par un tag ou un label).
    const documented = (EXCLUSION_DATA_KEYS[excl] ?? [])
      .map((k) => fund.esgExclusions?.[k])
      .filter((v): v is boolean => v !== undefined);
    if (documented.length > 0) return documented.some((v) => v);
    // Preuve 2 : politique déclarée (tag excl-* d'annexe SFDR).
    if (declared.has(tag)) return true;
    // Preuve 3 : label officiel dont le référentiel garantit l'exclusion.
    return (EXCLUSION_GUARANTEE_LABELS[excl] ?? []).some((l) => labels.includes(l));
  });
}

/**
 * Thème d'exclusion violé par le MANDAT du fonds (secteur, nom ou catégorie),
 * ou null si le fonds est compatible. Fonction pure (testable).
 */
export function ethicalExclusionViolation(
  fund: Pick<FundInput, "name" | "category" | "sector">,
  exclusions: string[] | null | undefined,
): EthicalExclusion | null {
  if (!exclusions?.length) return null;
  const text = `${fund.name ?? ""} ${fund.category ?? ""}`;
  for (const raw of exclusions) {
    const excl = raw as EthicalExclusion;
    const re = ETHICAL_KEYWORDS[excl];
    if (!re) continue; // valeur inconnue : ignorée (pas de sur-exclusion)
    if (ETHICAL_SECTOR[excl] && fund.sector === ETHICAL_SECTOR[excl]) return excl;
    if (re.test(text)) return excl;
  }
  return null;
}

export interface UniverseFilterOptions {
  /** Frais courants maximum, en pourcentage (0.5 = 0,5 %). */
  maxTer?: number | null;
  /** Préférence ESG (art8 → SFDR 8/9 ; art9 → SFDR 9 ; sinon tout). */
  esg?: string | null;
  /** Exclusions éthiques du client (tabac, armes, fossiles, jeux, alcool) —
   *  contrainte de mandat, jamais assouplie. */
  exclusions?: string[] | null;
  /** Mode STRICT des exclusions éthiques : en plus d'écarter les mandats
   *  contraires et les documentés-négatifs, exige que les fonds exposés
   *  (actions, obligations, diversifié, alternatif) PROUVENT chaque exclusion
   *  demandée (donnée EET positive, tag excl-*, ou label garant — cf.
   *  satisfiesDeclaredExclusions). À n'activer que si l'univers restant le
   *  permet — le service essaie strict d'abord, puis retombe sur le mode
   *  par défaut. */
  declaredPolicyStrict?: boolean;
  /** Zones géographiques du profil (vocabulaire UI, cf. GEO_TO_REGIONS). */
  geographies?: string[] | null;
  /** Plafond SRI par fonds (adéquation MIF : jamais plus risqué que la tolérance). */
  sriMax?: number | null;
  /** ISIN écartés à la main par le conseiller (« jeter un fonds »). */
  exclude?: string[] | null;
}

/**
 * Restreint l'univers selon les préférences « dures » (frais max, ESG, zones
 * géographiques, plafond SRI, exclusions manuelles, exclusions sectorielles).
 * Un fonds dont la donnée est absente n'est PAS écarté (on ne pénalise pas un
 * trou de données) — sauf pour les exclusions manuelles, toujours appliquées.
 * Les exclusions sectorielles écartent le prouvé-incompatible (mandat contraire,
 * donnée EET documentée négative) ; en mode strict (declaredPolicyStrict), la
 * PREUVE de chaque exclusion est en plus exigée (cf. bandeau en tête de section).
 * Renvoie l'univers filtré + le nombre de fonds retirés.
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
  const sectorExclusions = toSectorExclusions(opts.exclusions);
  const kept = funds.filter((f) => {
    if (excluded.has(f.isin.toUpperCase())) return false;
    if (ethicalExclusionViolation(f, opts.exclusions) !== null) return false;
    if (opts.declaredPolicyStrict && !satisfiesDeclaredExclusions(f, opts.exclusions)) return false;
    if (maxTer != null && f.ter != null && f.ter * 100 > maxTer + 1e-9) return false;
    if (esg === "art8" && !(f.sfdr === 8 || f.sfdr === 9)) return false;
    if (esg === "art9" && f.sfdr !== 9) return false;
    if (regions && f.assetClass === "actions" && f.region != null && !regions.has(f.region)) return false;
    if (sriMax != null && f.sri != null && f.sri > sriMax) return false;
    if (sectorExclusions.length > 0 && !passesSectorExclusions(f, sectorExclusions)) return false;
    return true;
  });
  return { funds: kept, dropped: funds.length - kept.length };
}

/**
 * Restreint l'univers selon les préférences « dures » du profil (frais max, ESG,
 * zones géographiques, exclusions sectorielles). Enveloppe de `filterUniverse`
 * pilotée par le profil.
 */
export function filterFundsByProfile(
  funds: FundInput[],
  profile: Pick<RichClientProfile, "max_ter" | "esg"> &
    Partial<Pick<RichClientProfile, "geographies" | "exclusions">>,
): { funds: FundInput[]; dropped: number } {
  return filterUniverse(funds, {
    maxTer: profile.max_ter,
    esg: profile.esg,
    geographies: profile.geographies ?? [],
    exclusions: profile.exclusions ?? [],
  });
}
