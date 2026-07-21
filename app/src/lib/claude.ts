import Anthropic from "@anthropic-ai/sdk";
import type { ParsedFilters } from "@/lib/types";
import { SORTABLE_COLUMNS } from "@/lib/screenerParams";

// Initialisation paresseuse : le client n'est construit qu'au premier appel LLM.
// Évite de dépendre de la clé API au chargement du module — les utilitaires purs
// (ex: sanitizeParsedFilters) restent importables (et testables) sans clé.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Modèle pour les tâches d'extraction structurée (phrase / PDF → JSON).
// Haiku 4.5 : ~3× moins cher que Sonnet en entrée comme en sortie, largement
// suffisant pour du mapping déterministe vers des filtres.
// PROMPT CACHING : le seuil minimum cachable de Haiku est de 4096 tokens ; en
// dessous, `cache_control` est un no-op silencieux. Seul le prompt de
// parseFrenchQuery (~4900 tokens, système figé et réutilisé à chaque recherche NL)
// dépasse ce seuil → on l'active LÀ uniquement (voir plus bas). Les prompts DICI
// (~850), profil (~800) et relevé (~440 tokens) restent sous le seuil : inutile
// de les cacher, ce serait sans effet.
export const EXTRACTION_MODEL = "claude-haiku-4-5";

// ─── Validation / nettoyage de la sortie LLM ────────────────────────────────
// Le modèle renvoie du JSON libre : sans garde-fou, une clé hallucinée ou une
// valeur d'enum invalide (« region:["mars"] ») arrive jusqu'à la requête PostgREST
// (`.in("region_normalized", ["mars"])`) → 0 résultat silencieux, indiscernable
// d'une vraie absence. On ne garde donc QUE les champs connus, les valeurs d'enum
// autorisées, et les nombres dans des bornes plausibles. Tout le reste est écarté.

const ENUMS = {
  envelopes: ["PEA", "PEA-PME", "PER", "AV-FR", "AV-LUX", "CTO"],
  universe: ["opcvm", "etf", "scpi", "fonds_euros", "fps", "action", "crypto", "structuré", "fcpr", "fcpi", "fip", "fpci"],
  asset_class: ["action", "obligation", "diversifie", "monetaire", "immobilier", "matieres_premieres", "alternatif", "fonds_euros"],
  allocation_profile: ["prudent", "equilibre", "dynamique", "flexible"],
  region: ["world", "europe", "eurozone", "usa", "france", "emerging", "japan", "asia", "china", "uk", "germany", "switzerland", "india", "brazil"],
  sector: ["Technologie", "Santé", "Finance", "Consommation", "Industrie", "Énergie", "Immobilier", "Environnement", "Communication", "Matériaux"],
  management_style: ["passif", "actif", "smart_beta", "alternatif"],
} as const;

// Labels officiels de durabilité (DDA). Distincts de SFDR (auto-déclaratif) :
// « labellisé ISR/Greenfin/Finansol » → labels ; « ESG / durable » → sfdr.
const LABELS = ["isr", "greenfin", "finansol"] as const;

// Bornes plausibles par champ numérique : [min, max]. Une valeur hors bornes est
// écartée (pas clampée — une valeur aberrante trahit une mauvaise interprétation).
const NUM_BOUNDS: Record<string, [number, number]> = {
  sri_min: [1, 7], sri_max: [1, 7],
  ter_max: [0, 100],
  perf_1y_min: [-100, 1000], perf_3y_min: [-100, 1000], perf_5y_min: [-100, 1000],
  vol_max: [0, 1000], vol_3y_max: [0, 1000],
  sharpe_min: [-100, 100], sharpe_3y_min: [-100, 100],
  drawdown_max: [0, 100],
  aum_min: [0, 1e9],
  track_record_min: [0, 100],
  morningstar_min: [1, 5],
  retrocession_min: [0, 100],
  // Millésime d'échéance des fonds obligataires datés (bornes alignées sur la couverture
  // réelle en base : 2024→2036, marge jusqu'à 2045).
  maturity_year_min: [2024, 2045],
  maturity_year_max: [2024, 2045],
};

function cleanNum(v: unknown, [lo, hi]: [number, number]): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
}

function cleanEnumArray(v: unknown, allowed: readonly string[]): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const set = new Set(allowed);
  const kept = v.filter((x): x is string => typeof x === "string" && set.has(x));
  return kept.length ? kept : undefined;
}

function cleanStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const kept = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.slice(0, 60));
  return kept.length ? kept : undefined;
}

/**
 * Filtre la sortie brute du LLM : ne conserve que les champs ParsedFilters connus,
 * avec des valeurs valides. Fonction pure (testable sans appeler le modèle).
 */
export function sanitizeParsedFilters(raw: unknown): ParsedFilters {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: ParsedFilters = {};

  // sfdr : sous-ensemble de {6,8,9}
  if (Array.isArray(r.sfdr)) {
    const sfdr = r.sfdr
      .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
      .filter((n) => n === 6 || n === 8 || n === 9);
    if (sfdr.length) out.sfdr = sfdr;
  }

  // Nombres bornés
  for (const key of Object.keys(NUM_BOUNDS)) {
    const v = cleanNum(r[key], NUM_BOUNDS[key]);
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }

  // Enums (tableaux)
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const v = cleanEnumArray(r[key], allowed);
    if (v) (out as Record<string, unknown>)[key] = v;
  }
  // Exclusions : mêmes valeurs autorisées que region / sector.
  const exclR = cleanEnumArray(r.exclude_regions, ENUMS.region);
  if (exclR) out.exclude_regions = exclR;
  const exclS = cleanEnumArray(r.exclude_sectors, ENUMS.sector);
  if (exclS) out.exclude_sectors = exclS;

  // Tableaux de chaînes libres (valeurs non contraintes : assureurs, contrats, devises…)
  const insurers = cleanStringArray(r.insurers); if (insurers) out.insurers = insurers;
  const contracts = cleanStringArray(r.contracts); if (contracts) out.contracts = contracts;
  const gestionnaires = cleanStringArray(r.gestionnaires); if (gestionnaires) out.gestionnaires = gestionnaires;
  const currency = cleanStringArray(r.currency); if (currency) out.currency = currency;
  const chips = cleanStringArray(r.chips); if (chips) out.chips = chips;

  // Chaînes simples
  if (typeof r.manager_search === "string" && r.manager_search.trim()) out.manager_search = r.manager_search.trim().slice(0, 100);
  if (typeof r.free_text === "string" && r.free_text.trim()) out.free_text = r.free_text.trim().slice(0, 100);

  // Labels officiels durabilité (sous-ensemble de isr/greenfin/finansol).
  const labels = cleanEnumArray(r.labels, LABELS);
  if (labels) out.labels = labels;

  // Booléens
  if (r.has_kid === true) out.has_kid = true;
  if (r.no_entry_fee === true) out.no_entry_fee = true;
  if (r.beats_benchmark === true) out.beats_benchmark = true;
  // Fonds obligataires datés (à échéance). Un millésime précis (« daté 2028 ») arrive
  // via maturity_year_min/max ; le booléen seul isole le sous-univers sans cibler d'année.
  if (r.target_maturity === true) out.target_maturity = true;

  // Intention de tri (éphémère) : field doit être une colonne triable connue,
  // dir ∈ {asc,desc} (défaut desc). Toute valeur hors liste est écartée — sinon
  // la route retomberait silencieusement sur le tri par défaut.
  if (r.sort_intent && typeof r.sort_intent === "object") {
    const si = r.sort_intent as Record<string, unknown>;
    if (typeof si.field === "string" && (SORTABLE_COLUMNS as readonly string[]).includes(si.field)) {
      out.sort_intent = { field: si.field, dir: si.dir === "asc" ? "asc" : "desc" };
    }
  }

  // ── Cohérence inter-champs ──────────────────────────────────────────────────
  // Les champs sont validés isolément ci-dessus ; rien n'empêche le LLM de produire
  // une fourchette inversée (sri_min > sri_max). On garde alors le PLAFOND (logique
  // d'adéquation : ne jamais proposer plus risqué que demandé) et on écarte le plancher.
  if (out.sri_min != null && out.sri_max != null && out.sri_min > out.sri_max) {
    delete out.sri_min;
  }
  // Fourchette de millésime inversée → on garde le plancher, on écarte le plafond aberrant.
  if (out.maturity_year_min != null && out.maturity_year_max != null &&
      out.maturity_year_min > out.maturity_year_max) {
    delete out.maturity_year_max;
  }

  return out;
}

// Résultat discriminé de l'interprétation NL. `ok` distingue un vrai succès du
// modèle (même si les filtres sont vides — le modèle a bien répondu « rien à
// filtrer ») d'un repli sur erreur (clé manquante / rate-limit / timeout / JSON
// illisible). Seul un succès doit être mis en cache : mémoriser un repli `{}`
// empoisonnerait le cache avec une interprétation ratée.
export type ParseOutcome = { filters: ParsedFilters; ok: boolean };

/**
 * Interprète une requête NL et renvoie les filtres AVEC l'information de succès.
 * `parseFrenchQuery` reste le point d'entrée simple ; cette variante sert aux
 * appelants qui décident de mettre en cache (uniquement sur `ok === true`).
 */
export async function parseFrenchQuery(query: string): Promise<ParsedFilters> {
  return (await parseFrenchQueryResult(query)).filters;
}

export async function parseFrenchQueryResult(query: string): Promise<ParseOutcome> {
  const sanitized = query.slice(0, 500).replace(/[<>]/g, "");

  const SYSTEM = `Tu es un assistant qui convertit des requêtes en langage naturel français en filtres JSON pour un screener de fonds d'investissement.

Retourne un objet JSON valide avec ces champs optionnels :
- sfdr: tableau de numéros SFDR ex: [8,9]
- sri_min, sri_max: indicateur risque PRIIPs 1-7
- ter_max: frais courants max en % ex: 1.5
- perf_1y_min, perf_3y_min, perf_5y_min: performance annualisée min en % ex: 10.0
- vol_max: volatilité 1 an max en %
- vol_3y_max: volatilité 3 ans max en %
- sharpe_min: ratio Sharpe 1 an min
- sharpe_3y_min: ratio Sharpe 3 ans min
- drawdown_max: perte maximale tolérée sur 3 ans, magnitude POSITIVE en % (ex: 20 = « ne pas perdre plus de 20% », drawdown limité à -20%)
- no_entry_fee: true si l'utilisateur veut des fonds SANS frais d'entrée
- aum_min: encours min en M€ ex: 100
- track_record_min: ancienneté min en années
- envelopes: tableau parmi ["PEA","PEA-PME","PER","AV-FR","AV-LUX","CTO"]
  (PEA=Plan Épargne en Actions, PEA-PME=PEA dédié PME, PER=Plan Épargne Retraite,
   AV-FR=Assurance-Vie France, AV-LUX=Assurance-Vie Luxembourg, CTO=Compte-Titres)
- universe: tableau de types de produit ex: ["etf","opcvm","scpi","fonds_euros","fps"]
  Inclut le PRIVATE EQUITY (non coté) : ["fcpr","fcpi","fip","fpci"]. « FCPR » → ["fcpr"],
  « FCPI » → ["fcpi"], « FIP » → ["fip"], « FPCI » → ["fpci"] ; « private equity » / « non
  coté » / « capital investissement » / « capital risque » → ["fcpr","fcpi","fip","fpci"].
  Leur éligibilité assurance-vie est portée par AV Luxembourg → si « en assurance-vie / en AV »
  accompagne du private equity, ajouter envelopes:["AV-LUX"] (pas AV-FR, non renseigné pour le non coté).
- asset_class: tableau de classes d'actifs parmi ["action","obligation","diversifie","monetaire","immobilier","matieres_premieres","alternatif","fonds_euros"]
  (NB: c'est la NATURE des actifs sous-jacents — distinct de "universe" qui est l'enveloppe produit.
   Un OPCVM peut être actions OU obligataire ; toujours renseigner asset_class quand la requête précise la classe.)
- allocation_profile: tableau parmi ["prudent","equilibre","dynamique","flexible"] — profil
  d'allocation d'un fonds DIVERSIFIÉ (ne s'applique qu'aux diversifiés). Quand l'utilisateur
  le précise, renseigner AUSSI asset_class:["diversifie"]. Mapping :
  "prudent"/"défensif"/"sécurisé" → ["prudent"] ; "équilibré"/"balanced"/"modéré" → ["equilibre"] ;
  "dynamique"/"offensif"/"audacieux" → ["dynamique"] ; "flexible"/"patrimonial"/"opportuniste"/
  "allocation flexible" → ["flexible"].
- region: tableau de zones géographiques normalisées parmi
  ["world","europe","eurozone","usa","france","emerging","japan","asia","china","uk","germany","switzerland","india","brazil"]
- sector: tableau parmi ["Technologie","Santé","Finance","Consommation","Industrie","Énergie","Immobilier","Environnement","Communication","Matériaux"]
- exclude_sectors: secteurs à EXCLURE (même liste que sector). Pour les formulations NÉGATIVES : « peu exposé à X », « faible exposition X », « sans X », « hors X », « pas de X », « peu de X », « éviter X ». NE JAMAIS mettre un secteur en positif (sector) quand la phrase est négative — utiliser exclude_sectors.
- exclude_regions: zones à EXCLURE (même liste que region). Mêmes déclencheurs négatifs appliqués à une zone (« peu exposé aux US », « hors USA », « sans Chine »).
- insurers: assureurs référençant le fonds, parmi ["BNP Paribas Cardif","Suravenir","Linxea","AXA France","SwissLife France","Allianz France","AG2R La Mondiale","Generali Luxembourg","Swiss Life Luxembourg","Wealins","Cardif Lux Vie","Baloise Life","AXA Wealth Europe"]
  (mapping : "AXA" / "chez AXA" → "AXA France" ; "Swiss Life" / "SwissLife" → "SwissLife France" ;
   "Allianz" → "Allianz France" ; "Cardif" / "BNP" → "BNP Paribas Cardif" ; "Suravenir" → "Suravenir" ;
   "Linxea" → "Linxea" ; "AG2R" / "La Mondiale" → "AG2R La Mondiale" ; déclenché par "référencé chez X",
   "disponible chez/sur X", "assurance vie X", "je travaille avec X")
- management_style: tableau parmi ["passif","actif","smart_beta","alternatif"]
- currency: tableau ex: ["EUR","USD"]
- morningstar_min: note Morningstar min 1-5
- retrocession_min: rétrocession CGP min en % ex: 0.5
- manager_search: nom du gestionnaire (ex: "Amundi", "BlackRock", "Carmignac")
- has_kid: true si l'utilisateur veut uniquement des fonds avec DICI disponible
- labels: tableau de labels officiels de durabilité parmi ["isr","greenfin","finansol"]
  (LABEL officiel, distinct de SFDR qui est auto-déclaratif). Déclenché par « labellisé »,
  « label ISR », « label Greenfin », « label Finansol », « fonds solidaire » (→ finansol).
  Ne PAS confondre : « ESG » / « durable » → sfdr:[8,9] ; « labellisé ISR » → labels:["isr"].
- beats_benchmark: true si l'utilisateur veut des fonds qui SURPERFORMENT leur indice
  (« bat son indice », « surperforme son benchmark », « alpha positif », « bat le marché »).
- target_maturity: true si l'utilisateur cherche des FONDS OBLIGATAIRES DATÉS (à échéance /
  « target maturity » / millésimés / de portage / « buy and hold » obligataire) — des fonds
  qui portent un panier d'obligations jusqu'à une année cible. Toujours accompagner de
  asset_class:["obligation"].
- maturity_year_min, maturity_year_max: année(s) d'échéance cible si précisée (2024-2045).
  « daté 2028 » → min=2028, max=2028 ; « échéance 2027 à 2030 » → min=2027, max=2030 ;
  « qui arrive à échéance avant 2029 » → max=2029 ; « à partir de 2030 » → min=2030.
  Émettre AUSSI target_maturity:true dès qu'une de ces bornes est posée.
- sort_intent: intention de TRI des résultats déduite de la formulation, objet {field, dir}.
  field parmi ["ter","performance_1y","performance_3y","performance_5y","aum_eur","sharpe_3y",
  "volatility_1y","max_drawdown_3y","morningstar_rating","track_record_years"], dir "asc" ou "desc".
  Mapping : « le moins cher » / « frais bas » / « low cost » → {field:"ter",dir:"asc"} ;
  « le plus performant » / « meilleure perf » / « rendement » → {field:"performance_3y",dir:"desc"}
  (utiliser performance_1y ou performance_5y si l'horizon est précisé) ;
  « le plus sûr » / « le moins risqué » → {field:"volatility_1y",dir:"asc"} ;
  « les plus gros » / « les plus liquides » → {field:"aum_eur",dir:"desc"} ;
  « meilleur Sharpe » → {field:"sharpe_3y",dir:"desc"} ;
  « les mieux notés » → {field:"morningstar_rating",dir:"desc"} ;
  « les plus anciens » / « historique le plus long » → {field:"track_record_years",dir:"desc"}.
  N'émettre sort_intent QUE si la formulation exprime un classement (superlatif/comparatif) ;
  sinon l'omettre. Il complète les filtres, il ne les remplace pas (« ETF monde pas cher » →
  region:["world"] + universe:["etf"] + sort_intent:{field:"ter",dir:"asc"}).
- free_text: recherche libre dans le nom du fonds (pour les noms de fonds spécifiques).
  Y mettre AUSSI un ticker / code de cotation boursière isolé : un jeton court tout
  en majuscules/chiffres sans espace qui n'est ni une zone, ni un secteur, ni un
  gestionnaire connu (ex: "DCAM", "CW8", "ESE", "PUST"). Ne JAMAIS l'interpréter
  comme une zone ou une classe d'actif.
- chips: tableau de labels lisibles courts en français pour afficher dans l'UI (ex: ["ETF monde", "PEA éligible", "Article 8"])

Règles de mapping :
- "monde" / "mondial" / "international" / "global" / "world" / "MSCI World" / "MSCI ACWI" / "ACWI" / "FTSE All-World" → region:["world"]
- "Europe" / "européen" / "STOXX" / "Stoxx 600" / "MSCI Europe" → region:["europe"]
- "zone euro" / "eurozone" / "Euro Stoxx" / "EuroStoxx 50" / "MSCI EMU" → region:["eurozone"]
- "USA" / "américain" / "US" / "États-Unis" / "S&P 500" / "Nasdaq" / "Dow Jones" / "Russell 2000" / "MSCI USA" → region:["usa"]
- "France" / "français" / "CAC 40" / "CAC40" / "SBF 120" → region:["france"]
- "émergents" / "emerging" / "pays émergents" / "MSCI EM" / "marchés émergents" → region:["emerging"]
- "Japon" / "japonais" / "Nikkei" / "Topix" → region:["japan"]
- "Asie" / "asiatique" / "Pacifique" → region:["asia"]
- "Chine" / "chinois" / "Hang Seng" / "CSI 300" → region:["china"]
- "Royaume-Uni" / "UK" / "britannique" / "FTSE" / "FTSE 100" → region:["uk"]
- "Allemagne" / "allemand" / "DAX" → region:["germany"]
- "Suisse" / "suisse" / "SMI" → region:["switzerland"]
- "Inde" / "indien" / "Nifty" / "Sensex" → region:["india"]
- "Brésil" / "brésilien" / "Bovespa" → region:["brazil"]
- "actions" / "fonds actions" / "equity" / "titres" → asset_class:["action"]
- "obligataire" / "obligations" / "oblig" / "bonds" / "crédit" / "taux" / "high yield" / "investment grade" → asset_class:["obligation"]
- "fonds daté" / "obligataire daté" / "fonds à échéance" / "à échéance" / "target maturity" / "fonds de portage" / "millésimé" / "fonds obligataire 20XX" → target_maturity:true + asset_class:["obligation"] (+ maturity_year_min/max si une année est citée)
- "diversifié" / "multi-actifs" / "multi-asset" / "allocation" / "patrimonial" / "flexible" / "mixte" / "profilé" → asset_class:["diversifie"]
- "monétaire" / "money market" / "cash" / "trésorerie" / "court terme" → asset_class:["monetaire"]
- "immobilier" / "SCPI" / "pierre papier" / "foncier" / "SCI" → asset_class:["immobilier"]
- "matières premières" / "or" / "métaux" / "commodités" / "commodities" → asset_class:["matieres_premieres"]
- "ESG" ou "durable" → sfdr:[8,9]
- "article 9" ou "impact" → sfdr:[9]
- "peu risqué" / "défensif" → sri_max:3
- "préserver le capital" / "protéger le capital" / "sécuriser mon épargne" / "capital protégé" / "sans prendre de risque" / "sécurité avant tout" → sri_max:2, drawdown_max:10 (intention de préservation : très défensif + chute limitée). NE PAS confondre avec un ticker/nom : garde le sens « prudence », pas free_text.
- "modéré" / "équilibré" → sri_min:2, sri_max:5
- "dynamique" / "risqué" → sri_min:4
- "low cost" / "peu de frais" → ter_max:0.5
- "assurance-vie" (sans précision) → envelopes:["AV-FR","AV-LUX"]
- "retraite" → envelopes:["PER"]
- "bien noté" / "5 étoiles" → morningstar_min:4
- "rétrocession" / "rétro CGP" → retrocession_min:0.3
- "bonne rétrocession" / "rétrocession élevée" → retrocession_min:0.5
- "ancienneté" / "historique long" → track_record_min:5
- "volatilité faible" / "peu volatile" → vol_max:8
- "perte max" / "drawdown limité" / "ne pas perdre plus de X%" / "chute limitée à X%" / "perte maximale X%" → drawdown_max:X (magnitude positive)
- "résilient" / "qui a bien résisté" / "faible drawdown" → drawdown_max:15
- "performant sur 5 ans" / "perf 5 ans" / "long terme performant" → perf_5y_min (ex: 5.0)
- "bon Sharpe sur 3 ans" / "rendement/risque solide dans la durée" → sharpe_3y_min:0.5
- "gros fonds" / "encours élevés" → aum_min:500
- "tech" / "technologie" / "numérique" / "intelligence artificielle" / "IA" / "semi-conducteurs" / "robotique" / "cybersécurité" / "cloud" / "digital" / "métavers" → sector:["Technologie"]
- "santé" / "pharma" / "médical" / "biotech" / "medtech" / "bien-être" → sector:["Santé"]
- "finance" / "banque" / "assurance" / "fintech" → sector:["Finance"]
- "énergie" / "pétrole" / "gaz" / "renouvelable" / "solaire" / "éolien" / "hydrogène" / "uranium" / "nucléaire" → sector:["Énergie"]
- "REIT" / "actions immobilières cotées" → sector:["Immobilier"] (sinon, pour de l'immobilier en direct/SCPI, préférer asset_class:["immobilier"])
- "environnement" / "eau" / "climat" / "transition écologique" / "économie circulaire" / "biodiversité" → sector:["Environnement"]
- "consommation" / "luxe" / "biens de consommation" / "distribution" (au sens SECTEUR conso, pas dividendes) → sector:["Consommation"]
- "industrie" / "défense" / "aéronautique" / "armement" / "infrastructures" → sector:["Industrie"]
- "matériaux" / "matières de base" / "mines" / "métaux" (au sens SECTEUR actions, distinct de la classe d'actif matieres_premieres) → sector:["Matériaux"]
- "communication" / "médias" / "télécoms" → sector:["Communication"]
- NÉGATION (IMPORTANT) : une formulation comme « peu exposé à X », « faible exposition X », « sans X »,
  « hors X », « pas de X », « éviter X » signifie EXCLURE X, jamais le filtrer en positif.
  → « peu exposé tech » → exclude_sectors:["Technologie"] (et SURTOUT PAS sector:["Technologie"]).
  → « hors US » / « peu exposé aux US » → exclude_regions:["usa"].
  Le reste de la phrase garde son sens positif (ex. « actions monde » → asset_class + region:["world"]).
- "gestion passive" / "index" / "réplication" → management_style:["passif"]
- "gestion active" / "stock-picking" → management_style:["actif"]
- "smart beta" / "factoriel" → management_style:["smart_beta"]
- "hedge fund" / "long-short" / "alternatif" → management_style:["alternatif"]
- "avec DICI" / "DICI disponible" / "document réglementaire" → has_kid:true
- "sans frais d'entrée" / "no load" / "frais d'entrée zéro" / "sans droits d'entrée" → no_entry_fee:true (+ chips:["Sans frais d'entrée"])

Exemples :
- "ETF monde" → {"universe":["etf"],"region":["world"],"chips":["ETF","Monde"]}
- "ETF monde éligibles PEA article 8" → {"sfdr":[8],"envelopes":["PEA"],"universe":["etf"],"region":["world"],"chips":["ETF","Monde","PEA éligible","Article 8"]}
- "fonds actions américaines" → {"asset_class":["action"],"region":["usa"],"chips":["Actions","USA"]}
- "fonds obligataire ISR à faible risque éligible assurance vie" → {"asset_class":["obligation"],"sfdr":[8,9],"sri_max":3,"envelopes":["AV-FR","AV-LUX"],"chips":["Obligataire","ISR","Risque faible","Assurance-vie"]}
- "fonds obligataire daté 2028 éligible assurance vie" → {"asset_class":["obligation"],"target_maturity":true,"maturity_year_min":2028,"maturity_year_max":2028,"envelopes":["AV-FR","AV-LUX"],"chips":["Obligataire daté","Échéance 2028","Assurance-vie"]}
- "fonds à échéance entre 2027 et 2030" → {"asset_class":["obligation"],"target_maturity":true,"maturity_year_min":2027,"maturity_year_max":2030,"chips":["Fonds à échéance","2027-2030"]}
- "obligations de portage qui arrivent à échéance avant 2029" → {"asset_class":["obligation"],"target_maturity":true,"maturity_year_max":2029,"chips":["Fonds à échéance","≤ 2029"]}
- "fonds diversifié patrimonial prudent" → {"asset_class":["diversifie"],"sri_max":3,"chips":["Diversifié","Prudent"]}
- "fonds actions monde référencés chez AXA" → {"asset_class":["action"],"region":["world"],"insurers":["AXA France"],"chips":["Actions","Monde","AXA France"]}
- "fonds action monde peu exposé tech/US" → {"asset_class":["action"],"region":["world"],"exclude_sectors":["Technologie"],"exclude_regions":["usa"],"chips":["Actions","Monde","Hors tech","Hors US"]}
- "ETF actions hors Chine sans énergie" → {"universe":["etf"],"asset_class":["action"],"exclude_regions":["china"],"exclude_sectors":["Énergie"],"chips":["ETF","Actions","Hors Chine","Hors énergie"]}
- "je travaille avec Suravenir, montre les ETF obligataires" → {"universe":["etf"],"asset_class":["obligation"],"insurers":["Suravenir"],"chips":["ETF","Obligataire","Suravenir"]}
- "SCPI immobilier de rendement" → {"asset_class":["immobilier"],"chips":["Immobilier"]}
- "FCPR disponibles en assurance-vie" → {"universe":["fcpr"],"envelopes":["AV-LUX"],"chips":["FCPR","Assurance-vie"]}
- "fonds de private equity non coté" → {"universe":["fcpr","fcpi","fip","fpci"],"chips":["Private equity","Non coté"]}
- "fonds monétaire euro" → {"asset_class":["monetaire"],"currency":["EUR"],"chips":["Monétaire","EUR"]}
- "fonds émergents dynamiques" → {"region":["emerging"],"sri_min":4,"chips":["Émergents","Dynamique"]}
- "fonds avec DICI disponible" → {"has_kid":true,"chips":["DICI disponible"]}
- "fonds peu risqués ESG" → {"sfdr":[8,9],"sri_max":3,"chips":["ESG","Risque faible"]}
- "OPCVM actions US performants éligibles CTO" → {"universe":["opcvm"],"region":["usa"],"envelopes":["CTO"],"chips":["Actions US","CTO éligible"]}
- "fonds retraite PER Amundi" → {"envelopes":["PER"],"manager_search":"Amundi","chips":["PER","Amundi"]}
- "ETF low cost monde" → {"universe":["etf"],"region":["world"],"ter_max":0.3,"chips":["ETF","Monde","Low cost"]}
- "OPCVM avec bonne rétrocession CGP éligibles AV" → {"universe":["opcvm"],"envelopes":["AV-FR","AV-LUX"],"retrocession_min":0.5,"chips":["Rétrocession ≥0.5%","Assurance-vie"]}
- "fonds actions peu volatils 5 étoiles" → {"universe":["opcvm","etf"],"vol_max":10,"morningstar_min":4,"chips":["Actions","Faible volatilité","5 étoiles"]}
- "fonds prudent qui ne perd pas plus de 15% sans frais d'entrée" → {"sri_max":3,"drawdown_max":15,"no_entry_fee":true,"chips":["Prudent","Perte max 15%","Sans frais d'entrée"]}
- "ETF monde performant sur 5 ans" → {"universe":["etf"],"region":["world"],"perf_5y_min":5,"chips":["ETF","Monde","Perf 5 ans"]}
- "fonds technologie innovants" → {"sector":["Technologie"],"chips":["Technologie"]}
- "ETF santé pharma article 9" → {"universe":["etf"],"sector":["Santé"],"sfdr":[9],"chips":["ETF","Santé","Article 9"]}
- "fonds énergie renouvelable ESG" → {"sector":["Énergie"],"sfdr":[8,9],"chips":["Énergie","ESG"]}
- "ETF intelligence artificielle" → {"universe":["etf"],"sector":["Technologie"],"chips":["ETF","IA"]}
- "un fonds pour préserver mon capital" → {"sri_max":2,"drawdown_max":10,"chips":["Préservation du capital","Prudent"]}
- "ETF actions émergentes hors Chine" → {"universe":["etf"],"asset_class":["action"],"region":["emerging"],"exclude_regions":["china"],"chips":["ETF","Émergents","Hors Chine"]}
- "DCAM" → {"free_text":"DCAM","chips":["DCAM"]}
- "ETF CW8" → {"universe":["etf"],"free_text":"CW8","chips":["ETF","CW8"]}
- "ETF monde le moins cher" → {"universe":["etf"],"region":["world"],"sort_intent":{"field":"ter","dir":"asc"},"chips":["ETF","Monde","Frais bas"]}
- "fonds actions US les plus performants" → {"asset_class":["action"],"region":["usa"],"sort_intent":{"field":"performance_3y","dir":"desc"},"chips":["Actions","USA","Performant"]}
- "fonds actions labellisé ISR qui bat son indice" → {"asset_class":["action"],"labels":["isr"],"beats_benchmark":true,"chips":["Actions","Label ISR","Bat son indice"]}
- "ETF monde les plus gros" → {"universe":["etf"],"region":["world"],"sort_intent":{"field":"aum_eur","dir":"desc"},"chips":["ETF","Monde","Gros encours"]}

Retourne UNIQUEMENT l'objet JSON. Pas d'explication.`;

  try {
    const response = await getClient().messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 512,
      // Le system prompt (~4900 tokens) est identique à chaque recherche NL ; seule
      // la requête (dans `messages`, donc après le préfixe) change. On met en cache
      // le préfixe figé : dans une fenêtre de 5 min (TTL éphémère), les recherches
      // distinctes suivantes le relisent à ~0,1× au lieu de le repayer plein tarif
      // (écriture +25% la 1re fois, rentable dès la 2e requête). Se cumule au cache
      // applicatif de /api/parse, qui lui évite carrément l'appel sur les répétitions.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: sanitized }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    // Validation : on n'expose que des champs/valeurs connus (cf. sanitizeParsedFilters).
    return { filters: sanitizeParsedFilters(JSON.parse(json)), ok: true };
  } catch (e) {
    // Repli {} = « Filtres intelligents indisponibles » côté UI. Le log permet
    // de distinguer clé manquante / rate-limit / timeout d'un vrai 0 résultat.
    // ok:false → l'appelant NE met PAS ce repli en cache.
    console.error("[claude] parseFrenchQuery a échoué (repli sur {}):", e);
    return { filters: {}, ok: false };
  }
}

