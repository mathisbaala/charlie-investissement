import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { feeFracToPct } from "@/lib/format";
import { searchWords, searchOrClause } from "@/lib/search";
import type { Fund, ScreenerResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// Vue enrichie : cgp + colonne `insurers` (tableau d'assureurs référençant le fonds).
const VIEW = "investissement_funds_cgp_ref";

const COLS = [
  "isin","name","product_type","asset_class_broad","asset_class",
  "category_normalized","region_normalized","sector","management_style",
  "gestionnaire","ter","ongoing_charges","performance_1y","performance_3y",
  "performance_5y","average_performance","volatility_1y","volatility_3y",
  "sharpe_1y","sharpe_3y","max_drawdown_1y","max_drawdown_3y","risk_score",
  "sfdr_article","labels","pea_eligible","pea_pme_eligible","per_eligible",
  "av_fr_eligible","av_lux_eligible","cto_eligible",
  "entry_fee_max","exit_fee_max","performance_fee","retrocession_cgp",
  "ucits_compliant","is_institutional","accessible_retail","hedged",
  "aum_eur","morningstar_rating","currency","inception_date",
  "track_record_years","kid_url","data_completeness","updated_at",
  "share_class_group_id","insurers","contracts"
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
  const sp = req.nextUrl.searchParams;

  const sfdr    = arr(p(sp, "sfdr")).map(Number).filter(n => !isNaN(n));
  const sriMin  = num(p(sp, "sri_min"));
  const sriMax  = num(p(sp, "sri_max"));
  const terMax  = num(p(sp, "ter_max"));
  const p1yMin  = num(p(sp, "perf_1y_min"));
  const p3yMin  = num(p(sp, "perf_3y_min"));
  const volMax  = num(p(sp, "vol_max"));
  const shMin   = num(p(sp, "sharpe_min"));
  const aumMin  = num(p(sp, "aum_min"));  // in M€ from UI
  const trMin   = num(p(sp, "track_record_min"));
  const mstarMin= num(p(sp, "morningstar_min"));
  const retroMin= num(p(sp, "retrocession_min")); // en % → diviser par 100 pour fraction DB
  const envelopes = arr(p(sp, "envelopes"));
  const universe  = arr(p(sp, "universe"));
  const assetClasses = arr(p(sp, "asset_class"));
  const insurers     = arr(p(sp, "insurer"));
  const contracts    = arr(p(sp, "contracts"));
  const regions      = arr(p(sp, "region"));
  const sectors      = arr(p(sp, "sector"));
  const exclSectors  = arr(p(sp, "exclude_sector"));
  const exclRegions  = arr(p(sp, "exclude_region"));
  const mgmtStyles   = arr(p(sp, "management_style"));
  const currency     = arr(p(sp, "currency"));
  const mgr     = p(sp, "manager_search")?.trim() ?? "";
  const gestIn  = arr(p(sp, "gestionnaire_in"));
  const search  = p(sp, "search")?.trim() ?? "";
  const hasKid  = p(sp, "has_kid") === "true";
  const sortBy  = p(sp, "sort_by") ?? "data_completeness";
  const sortDir = p(sp, "sort_dir") === "asc";
  const page    = Math.max(1, int(p(sp, "page")) ?? 1);
  const perPage = Math.min(100, Math.max(1, int(p(sp, "per_page")) ?? 50));

  const VALID_SORT = new Set([
    "performance_3y","performance_1y","performance_5y","ter","ongoing_charges",
    "aum_eur","sharpe_1y","sharpe_3y","volatility_1y","max_drawdown_3y",
    "morningstar_rating","track_record_years","data_completeness",
    "retrocession_cgp","entry_fee_max"
  ]);
  const safeSort = VALID_SORT.has(sortBy) ? sortBy : "data_completeness";

  // Applique tous les filtres de la requête à un builder donné. Factorisé pour pouvoir
  // le rejouer en requête count-only dans le chemin d'erreur 416 (cf. plus bas).
  const applyFilters = (q: any) => {
  if (sfdr.length)      q = q.in("sfdr_article", sfdr);
  if (sriMin != null)   q = q.gte("risk_score", sriMin);
  if (sriMax != null)   q = q.lte("risk_score", sriMax);
  // L'UI envoie ter_max en % ; la base stocke en fraction → diviser par 100.
  if (terMax != null)   q = (q as any).or(`ter.lte.${terMax / 100},ongoing_charges.lte.${terMax / 100}`);
  if (p1yMin != null)   q = q.gte("performance_1y", p1yMin);
  if (p3yMin != null)   q = q.gte("performance_3y", p3yMin);
  if (volMax != null)   q = q.lte("volatility_1y", volMax);
  if (shMin != null)    q = q.gte("sharpe_1y", shMin);
  if (aumMin != null)   q = q.gte("aum_eur", aumMin * 1_000_000);
  if (trMin != null)    q = q.gte("track_record_years", trMin);
  if (mstarMin != null) q = q.gte("morningstar_rating", mstarMin);
  if (retroMin != null) q = q.gte("retrocession_cgp", retroMin / 100);

  // Enveloppes
  if (envelopes.includes("PEA"))     q = q.eq("pea_eligible",     true);
  if (envelopes.includes("PEA-PME")) q = q.eq("pea_pme_eligible", true);
  if (envelopes.includes("PER"))     q = q.eq("per_eligible",     true);
  if (envelopes.includes("AV-FR"))   q = q.eq("av_fr_eligible",   true);
  if (envelopes.includes("AV-LUX"))  q = q.eq("av_lux_eligible",  true);
  if (envelopes.includes("CTO"))     q = q.eq("cto_eligible",     true);

  // Univers → product_type / asset_class
  const productTypes = universe.filter(u =>
    ["opcvm","etf","scpi","fps","fonds_euros","action","crypto"].includes(u)
  );
  if (productTypes.length) {
    q = q.in("product_type", productTypes);
  } else {
    // Défaut CGP : univers collectif. Restent en opt-in via le filtre univers :
    // les titres vifs (action), crypto, et les FPS (Fonds Professionnels Spécialisés,
    // réservés aux pros et sans métriques retail — 1 033 coquilles vides qui pollueraient
    // le tri completeness). Une recherche large remonte ainsi des fonds exploitables.
    q = (q as any).not("product_type", "in", "(action,crypto,fps)");
  }

  // Classe d'actif (nature des sous-jacents) → colonne asset_class_broad.
  // Distinct de l'univers produit (product_type) : un OPCVM peut être actions ou obligataire.
  if (assetClasses.length) q = q.in("asset_class_broad", assetClasses);

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

  if (search) {
    // Chaque mot doit matcher quelque part (ET entre mots, OR entre colonnes) :
    // nom, gestionnaire, mais aussi zone géo / catégorie / classe d'actif /
    // secteur. Cf. lib/search.ts pour le détail.
    for (const word of searchWords(search)) {
      q = (q as any).or(searchOrClause(word));
    }
  }
    return q;
  };

  const base = () =>
    applyFilters(
      supabase.from(VIEW).select(COLS, { count: "exact" }).gte("data_completeness", 50)
    );

  // Pagination exacte sur les lignes brutes : page P = lignes [(P-1)·perPage, P·perPage).
  // Avant, l'offset avançait de perPage·5 (un overfetch ×5 destiné à la dédup share-class,
  // supposant ~5 doublons par fonds). Or le ratio de dédup réel est ~0,85 (peu de doublons) :
  // l'offset sautait donc ~5× trop loin → seules ~1/5 des pages contenaient des données,
  // les autres (≈80 %) renvoyaient une liste vide et ~76 % des fonds étaient inatteignables
  // alors que total_pages les annonçait. On pagine désormais 1 page = perPage lignes ; la
  // dédup share-class reste appliquée À L'INTÉRIEUR de la page (deux classes d'un même fonds
  // présentes sur la même page sont fusionnées en gardant le plus gros encours).
  const offset = (page - 1) * perPage;
  const { data, error, count, status } = await base()
    .order(safeSort, { ascending: sortDir, nullsFirst: false })
    .range(offset, offset + perPage - 1);

  if (error) {
    // PostgREST renvoie 416 « Requested range not satisfiable » (code PGRST103)
    // quand l'offset dépasse le nombre de lignes — typiquement un crawler qui
    // pagine au-delà des résultats (?page=500…). On répond une page vide cohérente
    // plutôt qu'un 500 : on récupère juste le total via une requête count-only.
    //
    // ⚠ On détecte par le STATUS HTTP 416, pas seulement par error.code : en prod
    // (runtime Vercel) le body du 416 arrive parfois tronqué, JSON.parse échoue
    // dans postgrest-js et l'objet error perd son `code` (message = corps brut
    // illisible type `{"`). Le status, lui, reste fiable. Sans ce garde-fou le
    // 416 retombait en 500 malgré le test sur PGRST103.
    if (status === 416 || error.code === "PGRST103") {
      const { count: rawCount } = await applyFilters(
        supabase.from(VIEW).select("isin", { count: "exact", head: true }).gte("data_completeness", 50)
      );
      const total = rawCount ?? 0;
      const emptyResp: ScreenerResponse = {
        data: [],
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      };
      return NextResponse.json(emptyResp);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data as unknown as Fund[]) ?? [];
  // Dédup share-classes intra-page (garde le plus gros encours par groupe) +
  // frontière API : frais fraction (DB) → % (contrat Fund, cf. types.ts).
  const deduped = dedup(raw).map((f) => ({
    ...f,
    ter: feeFracToPct(f.ter),
    ongoing_charges: feeFracToPct(f.ongoing_charges),
  }));
  // total = nombre exact de lignes correspondantes (count: "exact"). Inclut les
  // share-classes ; total_pages couvre ainsi toutes les pages, sans page vide en plein milieu.
  const total = count ?? 0;

  const resp: ScreenerResponse = {
    data: deduped,
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  };
  return NextResponse.json(resp);
}
