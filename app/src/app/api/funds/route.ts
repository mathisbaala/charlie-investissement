import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { feeFracToPct } from "@/lib/format";
import { asExactIsin, expandSearchAliases } from "@/lib/search";
import { logEvent, activeFilters } from "@/lib/analytics";
import { relaxationOrder, relaxLabel } from "@/lib/screenerParams";
import { rankByFit, SOFT_TOLERANCE, type FitContext } from "@/lib/fitScore";
import { botGuard, dataRateLimit } from "@/lib/rateLimit";
import type { Fund, ScreenerResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// Plafond de pagination PROFONDE (anti-scraping). Le screener est en next/prev
// only (per_page=50) : aucun parcours humain n'atteint des offsets profonds — un
// offset au-delà de ce plafond trahit une énumération automatisée de l'univers.
// Au-delà : page vide cohérente, sans interroger la base. Réglable par env.
const MAX_OFFSET = Number(process.env.DATA_MAX_OFFSET ?? 5000);

// Set vide partagé : jeu de filtres relâchés par défaut (cas nominal, aucun relâchement).
const EMPTY_DISABLED: Set<string> = new Set();

// Taille du vivier re-classé par adéquation (couloir intention/profil). On récupère
// les CANDIDATE_CAP fonds les plus COMPLETS qualifiant les filtres, puis on les
// re-classe en TS par fit. Au-delà (rare sur une recherche ciblée), la pagination
// profonde retombe sur le tri completeness côté DB (cf. loadPage).
const CANDIDATE_CAP = 300;

// Planchers de complétude (data_completeness, 0-100). Base = garde-fou minimal de l'univers
// curé ; intent = relevé pour les tris par intention (ne pas mettre en avant un fonds vide
// qui ne « gagne » que sur le critère trié).
const BASE_MIN_COMPLETENESS = 50;
const INTENT_MIN_COMPLETENESS = 70;

// Vue enrichie : cgp + colonne `insurers` (tableau d'assureurs référençant le fonds).
const VIEW = "investissement_funds_cgp_ref";

const COLS = [
  "isin","name","product_type","asset_class_broad","asset_class","allocation_profile",
  "category_normalized","region_normalized","sector","management_style",
  "gestionnaire","ter","ongoing_charges","performance_1y","performance_3y",
  "performance_5y","volatility_1y","volatility_3y",
  "sharpe_1y","sharpe_3y","max_drawdown_1y","max_drawdown_3y","risk_score",
  "sfdr_article","labels","pea_eligible","pea_pme_eligible","per_eligible",
  "av_fr_eligible","av_lux_eligible","cto_eligible",
  "entry_fee_max","exit_fee_max","performance_fee","retrocession_cgp",
  "ucits_compliant","is_institutional","accessible_retail","hedged",
  "aum_eur","morningstar_rating","currency","inception_date",
  "track_record_years","kid_url","data_completeness","updated_at",
  "share_class_group_id","insurers","contracts","tickers",
  "benchmark_index","benchmark_variant","benchmark_is_category",
  "alpha_1y","alpha_3y","alpha_5y","maturity_year",
  "tax_scheme","tax_reduction_rate"
].join(",");

function p(sp: URLSearchParams, key: string) { return sp.get(key); }
function arr(v: string | null) { return v ? v.split(",").filter(Boolean) : []; }
function num(v: string | null) { const n = parseFloat(v ?? ""); return isNaN(n) ? undefined : n; }
function int(v: string | null) { const n = parseInt(v ?? "", 10); return isNaN(n) ? undefined : n; }

function dedup(funds: Fund[]): Fund[] {
  const best = new Map<string, Fund>();
  for (const f of funds) {
    const key = f.share_class_group_id ?? f.isin;
    const ex = best.get(key);
    if (!ex || (f.aum_eur ?? -1) > (ex.aum_eur ?? -1)) best.set(key, f);
  }
  return Array.from(best.values());
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const bot = botGuard(req);
  if (bot) return bot;
  const limited = await dataRateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;

  const sfdr    = arr(p(sp, "sfdr")).map(Number).filter(n => !isNaN(n));
  const sriMin  = num(p(sp, "sri_min"));
  const sriMax  = num(p(sp, "sri_max"));
  const terMax  = num(p(sp, "ter_max"));
  const p1yMin  = num(p(sp, "perf_1y_min"));
  const p3yMin  = num(p(sp, "perf_3y_min"));
  const p5yMin  = num(p(sp, "perf_5y_min"));
  const volMax  = num(p(sp, "vol_max"));
  const vol3Max = num(p(sp, "vol_3y_max"));
  const shMin   = num(p(sp, "sharpe_min"));
  const sh3Min  = num(p(sp, "sharpe_3y_min"));
  const ddMax   = num(p(sp, "drawdown_max"));   // magnitude positive (%) → max_drawdown_3y >= -ddMax
  const noEntryFee = p(sp, "no_entry_fee") === "true";
  const aumMin  = num(p(sp, "aum_min"));  // in M€ from UI
  const trMin   = num(p(sp, "track_record_min"));
  const mstarMin= num(p(sp, "morningstar_min"));
  const retroMin= num(p(sp, "retrocession_min")); // en % → diviser par 100 pour fraction DB
  const envelopes = arr(p(sp, "envelopes"));
  const universe  = arr(p(sp, "universe"));
  const taxSchemes = arr(p(sp, "tax_scheme"));  // dispositifs défisc (fip/fcpi/fcpr…) → colonne tax_scheme
  const assetClasses = arr(p(sp, "asset_class"));
  const allocProfiles = arr(p(sp, "allocation_profile"));
  const insurers     = arr(p(sp, "insurer"));
  const contracts    = arr(p(sp, "contracts"));
  const regions      = arr(p(sp, "region"));
  const sectors      = arr(p(sp, "sector"));
  const exclSectors  = arr(p(sp, "exclude_sector"));
  const exclRegions  = arr(p(sp, "exclude_region"));
  const mgmtStyles   = arr(p(sp, "management_style"));
  const currency     = arr(p(sp, "currency"));
  const esgLabels    = arr(p(sp, "labels"));  // labels officiels durabilité (isr/greenfin/finansol)
  const mgr     = p(sp, "manager_search")?.trim() ?? "";
  const gestIn  = arr(p(sp, "gestionnaire_in"));
  // Alias d'indices « collés » (« sp500 » → « s&p 500 ») réécrits avant la RPC :
  // sinon 0 résultat (sous-chaîne cassée par le « & »/l'espace). Cf. expandSearchAliases.
  const search  = expandSearchAliases(p(sp, "search")?.trim() ?? "");
  const exactIsin = asExactIsin(search);
  const hasKid  = p(sp, "has_kid") === "true";
  const beatsBenchmark = p(sp, "beats_benchmark") === "true"; // alpha 3 ans > 0
  // Fonds obligataires datés (à échéance). `target_maturity` isole le sous-univers ;
  // les bornes de millésime restreignent l'échéance (un range implique fonds daté :
  // maturity_year est NULL hors univers daté → écarté par gte/lte). Colonnes portées
  // par la vue _ref uniquement → on force needsRef (cf. plus bas).
  const targetMaturity = p(sp, "target_maturity") === "true";
  const matYearMin = int(p(sp, "maturity_year_min"));
  const matYearMax = int(p(sp, "maturity_year_max"));
  const sortBy  = p(sp, "sort_by") ?? "data_completeness";
  const sortDir = p(sp, "sort_dir") === "asc";
  const page    = Math.max(1, int(p(sp, "page")) ?? 1);
  const perPage = Math.min(100, Math.max(1, int(p(sp, "per_page")) ?? 50));
  // Plancher de complétude. Plancher de base : on n'expose que des fonds suffisamment
  // renseignés. Quand un tri par INTENTION est actif (« le moins cher »…), on relève le
  // plancher : trier sur un seul critère ne doit pas propulser en tête un fonds quasi vide
  // (frais bas mais aucune perf / aucun contrat / aucune info). Le relâchement gracieux
  // ramène au plancher de base AVANT de toucher aux critères du client (cf. plus bas).
  const prioritizeComplete = p(sp, "prioritize_complete") === "true";
  // Private equity (fcpr/fcpi/fip/fpci) explicitement demandé : on bypasse le plancher de
  // complétude. Le non coté a structurellement peu de données (pas de VL quotidienne, perf
  // en TRI/multiple) ; quand le CGP le demande nommément, on montre TOUT le catalogue plutôt
  // que de le réduire à la poignée « complète » — même esprit que la recherche par ISIN.
  const PE_PRODUCT_TYPES = ["fcpr", "fcpi", "fip", "fpci"];
  const peOnly = universe.length > 0 && universe.every(u => PE_PRODUCT_TYPES.includes(u));
  // Un dispositif de défiscalisation explicitement demandé (FIP/FCPI/FCPR) relève du même
  // registre : produits fiscaux non cotés, structurellement peu renseignés → on bypasse
  // aussi le plancher de complétude pour ne pas réduire l'offre à la poignée « complète ».
  const bypassCompleteness = peOnly || taxSchemes.length > 0;
  const minCompleteness = bypassCompleteness
    ? 0
    : prioritizeComplete ? INTENT_MIN_COMPLETENESS : BASE_MIN_COMPLETENESS;

  const VALID_SORT = new Set([
    "performance_3y","performance_1y","performance_5y","ter","ongoing_charges",
    "aum_eur","sharpe_1y","sharpe_3y","volatility_1y","max_drawdown_3y",
    "morningstar_rating","track_record_years","data_completeness",
    "retrocession_cgp","entry_fee_max","alpha_3y"
  ]);
  const safeSort = VALID_SORT.has(sortBy) ? sortBy : "data_completeness";

  // ── Préférences DOUCES (couloir fit, jamais des filtres durs) ───────────────
  // Issues du profil client (objectif revenus, TMI, novice, petit montant). Elles
  // ne restreignent pas l'univers — elles nuancent le classement par adéquation.
  const prefIncome      = p(sp, "pref_income") === "true";
  const prefEnvelopes   = arr(p(sp, "pref_envelopes"));
  const prefNovice      = p(sp, "pref_novice") === "true";
  const prefSmallTicket = p(sp, "pref_small_ticket") === "true";

  // « Intention/profil actif » = la requête porte au moins un filtre dur OU une
  // préférence douce. À l'inverse, la NAVIGATION NEUTRE (aucun filtre, tri par
  // défaut) reste triée par data_completeness côté DB — inchangée, « strict ».
  const anyHardFilter =
    sfdr.length > 0 || sriMin != null || sriMax != null || terMax != null ||
    p1yMin != null || p3yMin != null || p5yMin != null || volMax != null ||
    vol3Max != null || shMin != null || sh3Min != null || ddMax != null ||
    noEntryFee || aumMin != null || trMin != null || mstarMin != null ||
    retroMin != null || envelopes.length > 0 || universe.length > 0 ||
    taxSchemes.length > 0 ||
    assetClasses.length > 0 || allocProfiles.length > 0 || insurers.length > 0 ||
    contracts.length > 0 || regions.length > 0 || sectors.length > 0 ||
    exclSectors.length > 0 || exclRegions.length > 0 || mgmtStyles.length > 0 ||
    currency.length > 0 || !!mgr || gestIn.length > 0 || hasKid ||
    beatsBenchmark || esgLabels.length > 0 ||
    targetMaturity || matYearMin != null || matYearMax != null;
  const anyPref = prefIncome || prefEnvelopes.length > 0 || prefNovice || prefSmallTicket;
  const hasIntent = anyHardFilter || anyPref;

  // Re-classement par adéquation : seulement hors recherche texte (qui a déjà son
  // score `relevance`), quand il y a une intention/profil, ET que le tri est le tri
  // PAR DÉFAUT (data_completeness desc). Un tri explicite (clic colonne, intention
  // « le moins cher ») reste prioritaire et n'est jamais écrasé par le fit.
  const reRank = search.length === 0 && hasIntent && safeSort === "data_completeness" && !sortDir;
  // La proximité douce (élargissement des seuils non structurants) n'est active que
  // dans ce couloir : ailleurs (texte, neutre, relâchement), les seuils restent durs.
  const softProximity = reRank;

  const fitCtx: FitContext = {
    terMax, drawdownMax: ddMax,
    perf1yMin: p1yMin, perf3yMin: p3yMin, perf5yMin: p5yMin,
    volMax, vol3yMax: vol3Max, sharpeMin: shMin, sharpe3yMin: sh3Min, sriMax,
    sfdr: sfdr.length ? sfdr : undefined,
    labels: esgLabels.length ? esgLabels : undefined,
    beatsBenchmark: beatsBenchmark || undefined,
    envelopes: envelopes.length ? envelopes : undefined,
    preferIncome: prefIncome || undefined,
    preferEnvelopes: prefEnvelopes.length ? prefEnvelopes : undefined,
    novice: prefNovice || undefined,
    smallTicket: prefSmallTicket || undefined,
  };

  // ── Raccourci recherche par ISIN exact ──────────────────────────────────────
  // Coller un ISIN = « trouve-moi CE fonds précisément ». On court-circuite donc
  // les autres filtres ET les garde-fous de l'univers curé (data_completeness,
  // is_primary_share_class, exclusion action/crypto/fps) : l'ISIN d'un DIC pointe
  // souvent une part secondaire ou peu renseignée, qui sinon serait masquée — d'où
  // le « la recherche par ISIN ne fonctionne jamais » remonté par les utilisateurs.
  // L'ISIN étant unique par part, on borne à 1 ligne.
  if (exactIsin) {
    const { data, error } = await supabase
      .from(VIEW).select(COLS).eq("isin", exactIsin).limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const hit = (data as unknown as Fund[] | null)?.[0];
    const mapped = hit
      ? [{ ...hit, ter: feeFracToPct(hit.ter), ongoing_charges: feeFracToPct(hit.ongoing_charges) }]
      : [];
    logEvent(req, {
      event_type: "search",
      query: search,
      filters: null,
      result_count: mapped.length,
      meta: { sort_by: safeSort, page: 1, isin: true },
    });
    const resp: ScreenerResponse = {
      data: mapped, total: mapped.length, page: 1, per_page: perPage,
      total_pages: mapped.length ? 1 : 0,
    };
    return NextResponse.json(resp);
  }

  // Applique tous les filtres de la requête à un builder donné. Factorisé pour pouvoir
  // le rejouer en requête count-only dans le chemin d'erreur 416 (cf. plus bas).
  // Applique les filtres STRUCTURÉS (hors texte). Le matching texte est géré en
  // amont par la source : la RPC classée inv_funds_search pour une recherche texte,
  // la vue brute sinon (cf. dataSource ci-dessous). applyFilters s'applique par-dessus
  // les deux — source unique de vérité pour les filtres.
  // `disabled` : ensemble de clés de filtres RELÂCHÉS (relâchement gracieux quand
  // 0 résultat). Seuls les filtres non structurants sont gardables (cf. RELAXABLE_ORDER) ;
  // les filtres structurants ignorent ce set. Vide par défaut (cas nominal).
  const applyFilters = (q: any, disabled: Set<string> = EMPTY_DISABLED) => {
  const on = (k: string) => !disabled.has(k);
  // PROXIMITÉ DOUCE (couloir fit uniquement) : on élargit les seuils de CONFORT non
  // structurants d'une marge de tolérance (SOFT_TOLERANCE) pour ne plus exclure un
  // quasi-match (frais 0,52 % vs seuil 0,50 %) ; le score de fit pénalise ensuite le
  // dépassement → le quasi-match passe juste DERRIÈRE le match exact. Hors couloir fit
  // (softProximity=false), les seuils restent stricts. SRI/SFDR restent toujours durs.
  if (sfdr.length)      q = q.in("sfdr_article", sfdr);
  if (sriMin != null)   q = q.gte("risk_score", sriMin);
  if (sriMax != null)   q = q.lte("risk_score", sriMax);
  // L'UI envoie ter_max en % ; la base stocke en fraction → diviser par 100.
  if (terMax != null && on("ter_max")) {
    const terCut = (softProximity ? terMax * (1 + SOFT_TOLERANCE.terRel) : terMax) / 100;
    q = (q as any).or(`ter.lte.${terCut},ongoing_charges.lte.${terCut}`);
  }
  const perfFloor = (m: number) => softProximity ? m - SOFT_TOLERANCE.perfAbs : m;
  if (p1yMin != null && on("perf_1y_min")) q = q.gte("performance_1y", perfFloor(p1yMin));
  if (p3yMin != null && on("perf_3y_min")) q = q.gte("performance_3y", perfFloor(p3yMin));
  if (p5yMin != null && on("perf_5y_min")) q = q.gte("performance_5y", perfFloor(p5yMin));
  if (volMax != null && on("vol_max"))     q = q.lte("volatility_1y", softProximity ? volMax + SOFT_TOLERANCE.volAbs : volMax);
  if (vol3Max != null && on("vol_3y_max")) q = q.lte("volatility_3y", softProximity ? vol3Max + SOFT_TOLERANCE.volAbs : vol3Max);
  if (shMin != null && on("sharpe_min"))   q = q.gte("sharpe_1y", softProximity ? shMin - SOFT_TOLERANCE.sharpeAbs : shMin);
  if (sh3Min != null && on("sharpe_3y_min")) q = q.gte("sharpe_3y", softProximity ? sh3Min - SOFT_TOLERANCE.sharpeAbs : sh3Min);
  // Perte max (drawdown) : la colonne est un % négatif (ex: -25). « limité à 20% »
  // → on garde les fonds dont le drawdown 3 ans est >= -20 (chute moins profonde).
  if (ddMax != null && on("drawdown_max")) q = q.gte("max_drawdown_3y", -(Math.abs(ddMax) + (softProximity ? SOFT_TOLERANCE.drawdownAbs : 0)));
  // « Sans frais d'entrée » : exclut les fonds à frais d'entrée connus (> 0). On
  // conserve null (inconnu) ET 0 — la plupart des fonds no-load ont entry_fee_max
  // non renseigné ; l'intention est d'écarter les fonds explicitement chargés.
  if (noEntryFee)       q = (q as any).or("entry_fee_max.is.null,entry_fee_max.lte.0");
  if (aumMin != null && on("aum_min"))   q = q.gte("aum_eur", aumMin * 1_000_000);
  if (trMin != null && on("track_record_min")) q = q.gte("track_record_years", trMin);
  if (mstarMin != null && on("morningstar_min")) q = q.gte("morningstar_rating", mstarMin);
  if (retroMin != null && on("retrocession_min")) q = q.gte("retrocession_cgp", retroMin / 100);

  // Enveloppes
  if (envelopes.includes("PEA"))     q = q.eq("pea_eligible",     true);
  if (envelopes.includes("PEA-PME")) q = q.eq("pea_pme_eligible", true);
  if (envelopes.includes("PER"))     q = q.eq("per_eligible",     true);
  if (envelopes.includes("AV-FR"))   q = q.eq("av_fr_eligible",   true);
  if (envelopes.includes("AV-LUX"))  q = q.eq("av_lux_eligible",  true);
  if (envelopes.includes("CTO"))     q = q.eq("cto_eligible",     true);

  // Univers → product_type / asset_class
  const productTypes = universe.filter(u =>
    ["opcvm","etf","scpi","fps","fonds_euros","action","crypto","structuré",
     "fcpr","fcpi","fip","fpci"].includes(u)
  );
  if (productTypes.length) {
    q = q.in("product_type", productTypes);
  }
  // Sinon : navigation neutre = TOUT l'univers (opcvm, etf, scpi, fonds euros,
  // mais aussi actions, crypto, FPS, structurés et private equity). Décision du
  // 15/07/2026 : les CGP doivent voir l'intégralité du catalogue ; le tri par
  // data_completeness et le plancher de complétude relèguent naturellement les
  // supports peu renseignés en fin de classement sans les cacher.

  // Défiscalisation : dispositif fiscal du fonds (FIP/FCPI/FCPR). Filtre STRUCTURANT
  // (jamais relâché) — le CGP demande explicitement du produit défisc. tax_scheme est
  // NULL hors univers fiscal → in.(...) écarte de facto tous les fonds non défisc.
  if (taxSchemes.length) q = q.in("tax_scheme", taxSchemes);

  // Classe d'actif (nature des sous-jacents) → colonne asset_class_broad.
  // Distinct de l'univers produit (product_type) : un OPCVM peut être actions ou obligataire.
  if (assetClasses.length) q = q.in("asset_class_broad", assetClasses);

  // Profil d'allocation (diversifiés uniquement) : prudent / équilibré / dynamique / flexible.
  // Heuristique partielle (colonne NULL pour la plupart) → filtre opt-in, jamais appliqué par défaut.
  if (allocProfiles.length && on("allocation_profile")) q = q.in("allocation_profile", allocProfiles);

  // Référencement assureur : fonds disponibles chez au moins un des assureurs choisis.
  if (insurers.length)     q = (q as any).overlaps("insurers", insurers);
  // Référencement par contrat précis (clé composite "Assureur::Contrat").
  if (contracts.length)    q = (q as any).overlaps("contracts", contracts);

  if (regions.length)      q = q.in("region_normalized", regions);
  if (sectors.length)      q = q.in("sector", sectors);
  // Exclusions (négation NL : « peu exposé tech / hors US »). On écarte les fonds
  // CLASSÉS sur ce secteur / cette zone — approximation honnête (l'exposition fine
  // sous-jacente n'est pas filtrable, donnée trop éparse). Un fonds Monde a
  // region_normalized='world' donc « not in (usa) » le conserve.
  // ⚠ Forme null-safe « IS NULL OR NOT IN » : en SQL `NULL NOT IN (...)` vaut NULL
  // (donc exclu) — sans ce garde-fou on écarterait tous les fonds diversifiés/monde
  // dont le secteur n'est pas renseigné, soit l'inverse de l'intention.
  if (exclSectors.length)
    q = (q as any).or(`sector.is.null,sector.not.in.(${exclSectors.join(",")})`);
  if (exclRegions.length)
    q = (q as any).or(`region_normalized.is.null,region_normalized.not.in.(${exclRegions.join(",")})`);
  if (mgmtStyles.length)   q = q.in("management_style", mgmtStyles);
  if (currency.length)     q = q.in("currency", currency);
  if (mgr)              q = q.ilike("gestionnaire", `%${mgr}%`);
  if (gestIn.length)    q = q.in("gestionnaire", gestIn);

  if (hasKid)   q = q.not("kid_url", "is", null);
  // « Bat son indice » : surperformance nette vs benchmark sur 3 ans (alpha > 0).
  // Implique alpha_3y non null (les fonds sans benchmark sont écartés).
  if (beatsBenchmark && on("beats_benchmark")) q = q.gt("alpha_3y", 0);
  // Labels officiels durabilité (DDA) : fonds portant AU MOINS UN des labels
  // demandés. labels est un jsonb array → contains (@>) ORé sur chaque label.
  // Élément simple ["isr"] sans virgule interne → sûr dans la syntaxe or().
  if (esgLabels.length && on("labels"))
    q = (q as any).or(esgLabels.map((l) => `labels.cs.["${l}"]`).join(","));

  // Fonds obligataires datés (à échéance). Filtre STRUCTURANT (jamais relâché) : c'est
  // l'intention de fond, pas un confort. Les colonnes is_target_maturity / maturity_year
  // ne vivent que sur la vue _ref → needsRef garantit que la source les expose.
  if (targetMaturity)     q = q.eq("is_target_maturity", true);
  if (matYearMin != null) q = q.gte("maturity_year", matYearMin);
  if (matYearMax != null) q = q.lte("maturity_year", matYearMax);

    return q;
  };

  // Filtres de base communs à la requête de données ET à la requête count-only (416) :
  //  - data_completeness >= 50 : on n'expose que des fonds suffisamment renseignés ;
  //  - is_primary_share_class : DÉDUP share-class côté DB. La colonne marque, dans chaque
  //    groupe de share-classes, un unique représentant (frère screener-éligible en priorité,
  //    puis plus gros encours), maintenu par inv_refresh_primary_share_class() en fin de
  //    pipeline. → OFFSET/LIMIT et count: "exact" portent directement sur les fonds uniques,
  //    donc pagination et total exacts, sans dédup applicative ni estimation par ratio.
  // RECALIBRAGE VISIBILITÉ RÉFÉRENCEMENT (chantier Partie 1, marketplace) : sous un
  // filtre assureur/contrat, CHAQUE ligne renvoyée est déjà référencée (overlaps le
  // garantit) → on relâche le SEUL plancher de complétude : un fonds référencé AYANT
  // une performance devient visible même sous le plancher. Débloque l'offre réelle d'un
  // assureur (ex. AXA 139→820, BNP Cardif 409→3 287 ; ~5 400 supports, tous avec nom +
  // perf — 0 coquille). La dédup share-class et l'univers curé restent intacts ; hors
  // filtre assureur/contrat, le plancher dur est INCHANGÉ (navigation neutre stricte).
  // Invariant carte==total préservé : get_insurers_list / contract_groups_mv relâchés
  // du MÊME prédicat (migration 20260625210000).
  const relaxReferenced = insurers.length > 0 || contracts.length > 0;
  const baseFilters = (q: any, disabled: Set<string> = EMPTY_DISABLED, floor: number = minCompleteness) => {
    const primary = q.eq("is_primary_share_class", true);
    const gated = relaxReferenced
      ? (primary as any).or(`data_completeness.gte.${floor},performance_1y.not.is.null`)
      : primary.gte("data_completeness", floor);
    return applyFilters(gated, disabled);
  };

  // Source des données : pour une recherche TEXTE, on lit la RPC classée par
  // pertinence (inv_funds_search) — le tri par `relevance` agit alors sur TOUTES les
  // pages, plus seulement la 1re. Sinon (navigation/filtres sans texte), la vue brute.
  // Les filtres structurés (applyFilters) et les garde-fous d'univers s'appliquent
  // par-dessus dans les deux cas.
  const useRanked = search.length > 0; // exactIsin est déjà court-circuité plus haut
  // On sélectionne aussi `relevance` : PostgREST exige que la colonne de tri figure
  // dans la projection d'une fonction (sinon « column record.relevance does not exist »).
  // Elle est retirée de la réponse au mapping (cf. toApi).
  const rankedSource = (opts: Record<string, unknown>) =>
    (supabase as any).rpc("inv_funds_search", { q: search }, opts).select(`${COLS},relevance`);

  // ── Tri / pagination / count : phase 1 sur la vue LÉGÈRE ────────────────────
  // La vue _ref (VIEW) ajoute un LEFT JOIN vers la matview assureurs ; un tri par colonne
  // NON-défaut empêche le push-down du LIMIT → cette jointure se matérialise pour TOUT
  // l'univers curé (~13,8k lignes) → statement timeout. On trie/pagine/compte donc d'abord
  // sur la vue légère `investissement_funds_cgp` (projection `isin` + colonne de tri, aucune
  // jointure ; inv_annualize_pt est IMMUTABLE SQL = inlinée, donc trier la perf reste bon
  // marché), puis on n'enrichit (assureurs/contrats) que les ISIN de la page (phase 2).
  // Bascule sur la vue _ref en phase 1 seulement si un filtre assureur/contrat l'exige —
  // il réduit l'ensemble, donc pas de timeout. Le chemin texte (RPC) narrow déjà : inchangé.
  // Le filtre échéance lit is_target_maturity / maturity_year, portées par _ref seule.
  // Comme le filtre assureur, il RÉDUIT l'ensemble (≤ ~313 fonds datés) → pas de timeout
  // malgré la jointure matview de _ref.
  const needsRef = insurers.length > 0 || contracts.length > 0 ||
    targetMaturity || matYearMin != null || matYearMax != null;
  const sortSource = needsRef ? VIEW : "investissement_funds_cgp";

  // Pagination exacte : page P = fonds uniques [(P-1)·perPage, P·perPage). La dédup est
  // portée par is_primary_share_class (cf. baseFilters), donc 1 page = perPage lignes.
  const offset = (page - 1) * perPage;

  // Garde anti-scraping : pagination profonde (énumération de l'univers). Hors de
  // portée d'un parcours humain (next/prev) → page vide cohérente sans toucher la
  // base. Placé APRÈS le raccourci ISIN exact (toujours autorisé) et le relâchement/
  // fuzzy (page 1 uniquement) → aucun chemin légitime n'est affecté.
  if (offset >= MAX_OFFSET) {
    const resp: ScreenerResponse = { data: [], total: 0, page, per_page: perPage, total_pages: 0 };
    return NextResponse.json(resp);
  }

  // Frontière API : frais fraction (DB) → % (contrat Fund, cf. types.ts). `relevance`
  // (chemin RPC classé) est un score interne de tri : non exposé dans la réponse publique.
  const toApi = (f: Fund): Fund => {
    const { relevance: _drop, ...rest } = f as Fund & { relevance?: number };
    void _drop;
    return {
      ...rest,
      ter: feeFracToPct(rest.ter),
      ongoing_charges: feeFracToPct(rest.ongoing_charges),
    };
  };

  // Compte exact (count-only, HEAD) pour un jeu de filtres relâchés donné — sonde bon
  // marché du relâchement gracieux (ne récupère ni page ni enrichissement phase 2).
  const countWith = async (disabled: Set<string>, floor: number = minCompleteness): Promise<number> => {
    const { count: c } = await baseFilters(
      useRanked
        ? rankedSource({ count: "exact", head: true })
        : supabase.from(sortSource).select("isin", { count: "exact", head: true }),
      disabled,
      floor,
    );
    return c ?? 0;
  };

  // Charge une page complète (tri + count + enrichissement phase 2) pour un jeu de filtres
  // relâchés donné. Retourne {data,total}, ou une réponse d'erreur à propager telle quelle
  // (500 ; page vide cohérente sur 416). Factorisé pour pouvoir être rejoué après relâchement.
  type PageOk = { data: Fund[]; total: number };
  type PageErr = { errorResp: NextResponse };
  const loadPage = async (disabled: Set<string>, floor: number = minCompleteness): Promise<PageOk | PageErr> => {
    // ── Couloir ADÉQUATION (intention/profil, tri par défaut) ──────────────────
    // On récupère le vivier des CANDIDATE_CAP fonds les plus COMPLETS qualifiant les
    // filtres (tri/cut côté DB sur la vue légère, bon marché), on l'enrichit (COLS),
    // puis on le RE-CLASSE en TS par score de fit (complétude dominante + adéquation
    // − dépassement doux + préférences profil). La pagination profonde au-delà du
    // vivier retombe sur le chemin DB classique (tri completeness).
    if (reRank && offset < CANDIDATE_CAP) {
      // Sélection du vivier phase-1 : on prend les CANDIDATE_CAP fonds les plus complets,
      // DÉPARTAGÉS par l'encours (aum_eur desc) — sans ce tiebreak, à complétude égale (la
      // plupart des fonds curés sont à 100) l'ordre retombe sur l'ordre physique ISIN
      // (alphabétique → biais géographique : les ISIN AT… de tête monopolisaient le vivier
      // et les flagships FR/LU n'étaient jamais scorés). Le re-score fit TS reste l'autorité
      // finale ; ce tri ne fait que garantir un vivier représentatif et déterministe.
      const { data: poolRows, error: poolErr, count: poolCount, status: poolStatus } =
        await baseFilters(
          supabase.from(sortSource).select("isin", { count: "exact" }), disabled, floor,
        )
          .order("data_completeness", { ascending: false, nullsFirst: false })
          .order("aum_eur", { ascending: false, nullsFirst: false })
          .range(0, CANDIDATE_CAP - 1);
      if (poolErr) {
        if (poolStatus === 416 || poolErr.code === "PGRST103")
          return { data: [], total: await countWith(disabled, floor) };
        return { errorResp: NextResponse.json({ error: poolErr.message }, { status: 500 }) };
      }
      const poolIsins = ((poolRows as { isin: string }[] | null) ?? []).map((r) => r.isin);
      if (!poolIsins.length) return { data: [], total: poolCount ?? 0 };
      const { data: enriched, error: enrichErr } = await supabase
        .from(VIEW).select(COLS).in("isin", poolIsins);
      if (enrichErr) return { errorResp: NextResponse.json({ error: enrichErr.message }, { status: 500 }) };
      const ranked = rankByFit(dedup((enriched as unknown as Fund[]) ?? []).map(toApi), fitCtx);
      return { data: ranked.slice(offset, offset + perPage), total: poolCount ?? 0 };
    }

    let pageQuery = useRanked
      ? baseFilters(rankedSource({ count: "exact" }), disabled, floor)
      : baseFilters(supabase.from(sortSource).select(`isin,${safeSort}`, { count: "exact" }), disabled, floor);
    // Recherche texte : la PERTINENCE prime toujours, le tri choisi/intention n'est que
    // tie-break secondaire. Sinon, choisir un tri non-défaut (ex. TER) ferait remonter un
    // match faible (relevance=1) devant le nom exact (relevance=3) — perte de pertinence.
    // À pertinence ÉGALE, on départage par l'ENCOURS (aum_eur desc) AVANT le tri par
    // défaut/intention : entre plusieurs « MSCI World »
    // également pertinents, le flagship (gros encours) prime sur une coquille / une variante
    // de niche. Quand un tri explicite non-défaut est choisi (clic colonne), il reste
    // prioritaire sur l'AUM (cf. tri appliqué juste après).
    if (useRanked) {
      pageQuery = pageQuery.order("relevance", { ascending: false, nullsFirst: false });
      if (safeSort === "data_completeness") {
        pageQuery = pageQuery.order("aum_eur", { ascending: false, nullsFirst: false });
      }
    }
    const { data: pageData, error, count, status } = await pageQuery
      .order(safeSort, { ascending: sortDir, nullsFirst: false })
      .range(offset, offset + perPage - 1);

    if (error) {
      // 416 « Requested range not satisfiable » (PGRST103) : offset au-delà des lignes
      // (crawler ?page=500…). Page vide cohérente + total via count-only. ⚠ détecter par
      // le STATUS 416 (body 416 parfois tronqué sur Vercel → error.code perdu dans postgrest-js).
      if (status === 416 || error.code === "PGRST103") {
        return { data: [], total: await countWith(disabled, floor) };
      }
      return { errorResp: NextResponse.json({ error: error.message }, { status: 500 }) };
    }

    // ── Phase 2 : enrichissement de la page ───────────────────────────────────
    // Chemin texte : la RPC renvoie déjà COLS, classé par `relevance` → rien à réordonner.
    // Chemin non-texte : on n'a que les ISIN triés → on enrichit (assureurs/contrats) ces
    // seuls ISIN sur la vue _ref, en préservant l'ordre du tri de la phase 1.
    let raw: Fund[];
    if (useRanked) {
      raw = (pageData as unknown as Fund[]) ?? [];
    } else {
      const pageIsins = ((pageData as { isin: string }[] | null) ?? []).map((r) => r.isin);
      if (!pageIsins.length) {
        raw = [];
      } else {
        const { data: enriched, error: enrichErr } = await supabase
          .from(VIEW).select(COLS).in("isin", pageIsins);
        if (enrichErr) {
          return { errorResp: NextResponse.json({ error: enrichErr.message }, { status: 500 }) };
        }
        const ord = new Map(pageIsins.map((isin, i) => [isin, i] as const));
        raw = ((enriched as unknown as Fund[]) ?? [])
          .sort((a, b) => (ord.get(a.isin) ?? 1e9) - (ord.get(b.isin) ?? 1e9));
      }
    }
    // dedup() = filet (double-primary transitoire entre refreshs, doublons prio↔page).
    return { data: dedup(raw).map(toApi).slice(0, perPage), total: count ?? 0 };
  };

  // ── Chargement nominal, puis relâchement gracieux si 0 résultat ──────────────
  const first = await loadPage(EMPTY_DISABLED);
  if ("errorResp" in first) return first.errorResp;
  let deduped = first.data;
  let total = first.total;
  let relaxed: string[] = [];

  // 0 résultat (1re page) → relâchement gracieux progressif. Étapes, du moins coûteux au
  // plus coûteux :
  //  1) RETOUR au plancher de complétude de base (si on était au plancher « intent » relevé) :
  //     c'est NOTRE préférence de qualité, pas un critère du client → on la cède en premier,
  //     silencieusement (mieux vaut des fonds peu renseignés que zéro résultat).
  //  2) RETRAIT des filtres NON structurants un à un (RELAXABLE_ORDER), signalés à l'UI.
  //  Les filtres structurants (univers, zone, sri_max…) ne sont jamais touchés.
  if (total === 0 && page === 1) {
    const order = relaxationOrder({
      retrocession_min: retroMin != null,
      morningstar_min: mstarMin != null,
      track_record_min: trMin != null,
      aum_min: aumMin != null,
      labels: esgLabels.length > 0,
      allocation_profile: allocProfiles.length > 0,
      beats_benchmark: beatsBenchmark,
      sharpe_3y_min: sh3Min != null,
      sharpe_min: shMin != null,
      vol_3y_max: vol3Max != null,
      vol_max: volMax != null,
      perf_5y_min: p5yMin != null,
      perf_3y_min: p3yMin != null,
      perf_1y_min: p1yMin != null,
      drawdown_max: ddMax != null,
      ter_max: terMax != null,
    });
    // Étape 1 d'abord (label null = silencieux), puis chaque filtre relâchable.
    const steps: Array<{ key: string | null; label: string | null }> = [];
    if (minCompleteness > BASE_MIN_COMPLETENESS) steps.push({ key: null, label: null });
    for (const k of order) steps.push({ key: k, label: relaxLabel(k) });

    // Les étapes sont CUMULATIVES et le count est MONOTONE (relâcher davantage ne peut
    // qu'augmenter le nombre de résultats) : on cherche la PREMIÈRE étape à count > 0.
    // Plutôt que de sonder séquentiellement (jusqu'à ~17 allers-retours en série, sur le
    // SEUL cas « 0 résultat »), on matérialise l'état cumulé de chaque étape puis on lance
    // toutes les sondes count EN PARALLÈLE (elles tapent la vue légère, pas le join matview
    // → bon marché), et on ne charge la page que pour la première étape gagnante. Résultat
    // strictement identique (mêmes étapes, même premier hit), latence ~divisée par le nombre
    // d'étapes.
    const snapshots: Array<{ disabled: Set<string>; floor: number; applied: string[] }> = [];
    {
      const disabled = new Set<string>();
      let floor = minCompleteness;
      const applied: string[] = [];
      for (const step of steps) {
        if (step.key === null) floor = BASE_MIN_COMPLETENESS;
        else disabled.add(step.key);
        if (step.label) applied.push(step.label);
        // Snapshot immuable de l'état cumulé à cette étape (copie du Set + des labels).
        snapshots.push({ disabled: new Set(disabled), floor, applied: applied.slice() });
      }
    }
    const counts = await Promise.all(snapshots.map((s) => countWith(s.disabled, s.floor)));
    const hit = counts.findIndex((c) => c > 0);
    if (hit !== -1) {
      const s = snapshots[hit];
      const r = await loadPage(s.disabled, s.floor);
      if ("errorResp" in r) return r.errorResp;
      deduped = r.data;
      total = r.total;
      relaxed = s.applied;
    }
  }

  // ── Filet recherche approximative (tolérance aux fautes) ────────────────────
  // Zéro correspondance exacte sur une recherche texte (1re page) : on propose les
  // fonds dont le NOM est le plus proche (RPC trigramme inv_search_funds_fuzzy),
  // en réappliquant les filtres ad hoc par intersection sur l'ISIN. Pas de contrainte
  // texte ici : la source est la liste d'ISIN approchants (applyFilters = structurés).
  let fuzzyData = deduped;
  let fuzzyTotal = total;
  let isFuzzy = false;
  if (total === 0 && search && page === 1) {
    const { data: fz } = await supabase.rpc("inv_search_funds_fuzzy", { q: search, lim: perPage });
    const isins = ((fz as { isin: string }[] | null) ?? []).map((r) => r.isin);
    if (isins.length) {
      const fuzzyBase = supabase.from(VIEW).select(COLS).eq("is_primary_share_class", true);
      const fuzzyGated = relaxReferenced
        ? (fuzzyBase as any).or("data_completeness.gte.50,performance_1y.not.is.null")
        : fuzzyBase.gte("data_completeness", 50);
      const { data: frows } = await applyFilters(fuzzyGated).in("isin", isins);
      const rank = new Map(isins.map((id, i) => [id, i] as const));
      const rows = ((frows as unknown as Fund[]) ?? [])
        .sort((a, b) => (rank.get(a.isin) ?? 1e9) - (rank.get(b.isin) ?? 1e9));
      const mapped = dedup(rows).map(toApi).slice(0, perPage);
      if (mapped.length) {
        fuzzyData = mapped;
        fuzzyTotal = mapped.length;
        isFuzzy = true;
      }
    }
  }

  const resp: ScreenerResponse = {
    data: fuzzyData,
    total: fuzzyTotal,
    page,
    per_page: perPage,
    total_pages: Math.ceil(fuzzyTotal / perPage),
    fuzzy: isFuzzy || undefined,
    relaxed: relaxed.length ? relaxed : undefined,
  };

  // Télémétrie : on ne journalise que les recherches « signifiantes » — première page
  // (= une visite du screener) ou toute requête filtrée. La pagination profonde (page>1
  // sans filtre) est du bruit (crawlers, défilement) et est ignorée.
  const filters = activeFilters({
    sfdr, sri_min: sriMin, sri_max: sriMax, ter_max: terMax,
    perf_1y_min: p1yMin, perf_3y_min: p3yMin, perf_5y_min: p5yMin,
    vol_max: volMax, vol_3y_max: vol3Max, sharpe_min: shMin, sharpe_3y_min: sh3Min,
    drawdown_max: ddMax, no_entry_fee: noEntryFee || undefined,
    aum_min: aumMin, track_record_min: trMin, morningstar_min: mstarMin,
    retrocession_min: retroMin, envelopes, universe, tax_scheme: taxSchemes,
    asset_class: assetClasses,
    allocation_profile: allocProfiles,
    insurer: insurers, contracts, region: regions, sector: sectors,
    exclude_sector: exclSectors, exclude_region: exclRegions,
    management_style: mgmtStyles, currency, manager_search: mgr,
    gestionnaire_in: gestIn, has_kid: hasKid || undefined,
    beats_benchmark: beatsBenchmark || undefined,
    labels: esgLabels.length ? esgLabels : undefined,
    target_maturity: targetMaturity || undefined,
    maturity_year_min: matYearMin, maturity_year_max: matYearMax,
  });
  if (page === 1 || filters || search) {
    logEvent(req, {
      event_type: "search",
      query: search || null,
      filters,
      result_count: fuzzyTotal,
      meta: { sort_by: safeSort, page, fuzzy: isFuzzy || undefined },
    });
  }

  return NextResponse.json(resp);
}
