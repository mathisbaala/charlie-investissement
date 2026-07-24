import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chaînable et « thenable » du client supabase. Chaque méthode de filtre/tri
// renvoie le builder lui-même ; `await query` résout selon le scénario configuré.
// On distingue la requête de données (avec .range) de la requête count-only
// (select avec { head: true }) déclenchée dans le chemin d'erreur 416.
let dataResult: any;
let countResult: any;
// File de résultats pour les requêtes de données successives (principale, puis
// prepend pertinence / fuzzy). Si vide, on retombe sur dataResult (cas simple).
let dataQueue: any[];
// Résultat de supabase.rpc(...) (RPC fuzzy inv_search_funds_fuzzy).
let rpcResult: any;
// Capture des appels rpc(name, args).
let rpcCalls: Array<[string, any]>;
// Capture les bornes du dernier .range(from, to) de la requête de données (pas de la
// requête count-only head), pour vérifier le calcul d'offset de la pagination.
let lastRange: { from: number; to: number } | null;
// Capture les .eq(col, val) par type de requête (données vs count-only head), pour
// vérifier que la dédup is_primary_share_class est appliquée des deux côtés.
let eqData: Array<[string, any]>;
let eqHead: Array<[string, any]>;
// Capture des bornes (col, val) et des clauses .or() de la requête de données,
// pour vérifier les filtres numériques (gte/lte) et composés (or).
let gteData: Array<[string, any]>;
let lteData: Array<[string, any]>;
let orData: string[];
// Capture des .in(col, vals) et .not(col, op, vals) de la requête de données, pour
// vérifier l'univers produit (navigation neutre = AUCUNE exclusion de product_type).
let inData: Array<[string, any]>;
let notData: Array<[string, string, any]>;

// Le builder est chaînable ET thenable. Il sert à la fois pour supabase.from(...)
// et pour supabase.rpc("inv_funds_search", ...) (recherche classée par pertinence,
// chaînée avec .select/.eq/.order/.range). La RPC fuzzy (inv_search_funds_fuzzy)
// est, elle, awaited directement → un builder "fuzzy" qui résout rpcResult.
function makeBuilder({ head = false, fuzzy = false }: { head?: boolean; fuzzy?: boolean } = {}) {
  let isHead = head;
  const builder: any = {
    select: (_cols: string, opts?: { head?: boolean }) => {
      if (opts?.head) isHead = true;
      return builder;
    },
    then: (resolve: (v: any) => any) =>
      Promise.resolve(
        fuzzy ? rpcResult
          : isHead ? countResult
          : (dataQueue.length ? dataQueue.shift() : dataResult),
      ).then(resolve),
  };
  // Méthodes de filtre/tri sans capture (renvoient le builder).
  for (const m of ["overlaps", "ilike", "order", "limit", "filter"]) {
    builder[m] = () => builder;
  }
  // in / not : on enregistre les arguments (requête de données uniquement).
  builder.in = (col: string, vals: any) => { if (!isHead) inData.push([col, vals]); return builder; };
  builder.not = (col: string, op: string, vals: any) => { if (!isHead) notData.push([col, op, vals]); return builder; };
  // gte / lte / or : on enregistre les arguments (requête de données uniquement).
  builder.gte = (col: string, val: any) => { if (!isHead) gteData.push([col, val]); return builder; };
  builder.lte = (col: string, val: any) => { if (!isHead) lteData.push([col, val]); return builder; };
  builder.or = (clause: string) => { if (!isHead) orData.push(clause); return builder; };
  // eq : on enregistre (col, val) selon le type de requête.
  builder.eq = (col: string, val: any) => {
    (isHead ? eqHead : eqData).push([col, val]);
    return builder;
  };
  // range : on enregistre les bornes (uniquement pour la requête de données).
  builder.range = (from: number, to: number) => {
    if (!isHead) lastRange = { from, to };
    return builder;
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => makeBuilder(),
    rpc: (name: string, args: any, opts?: { head?: boolean }) => {
      rpcCalls.push([name, args]);
      // inv_search_funds_fuzzy est awaited directement (résout rpcResult).
      // inv_funds_search est chaînée comme une requête de données classée.
      if (name === "inv_search_funds_fuzzy") return makeBuilder({ fuzzy: true });
      return makeBuilder({ head: !!opts?.head });
    },
  },
}));

// Le rate-limit anti-scraping et le filtre anti-bot sont testés en isolation
// (dataRateLimit.test.ts / botGuard.test.ts). Ici on les neutralise (toujours
// « autorisé ») pour ne pas polluer le mock supabase ni les assertions rpcCalls.
vi.mock("@/lib/rateLimit", () => ({
  dataRateLimit: () => Promise.resolve(null),
  botGuard: () => null,
}));

import { GET, dedup } from "@/app/api/funds/route";
import { NextRequest } from "next/server";

function req(qs: string) {
  // UA de navigateur : un client réel en envoie toujours un (sinon botGuard 403).
  return new NextRequest(`https://test.local/api/funds${qs}`, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/124.0 Safari/537.36" },
  });
}

describe("GET /api/funds — robustesse pagination", () => {
  beforeEach(() => {
    dataResult = { data: null, error: null, count: null };
    countResult = { data: null, error: null, count: null };
    lastRange = null;
    eqData = [];
    eqHead = [];
    gteData = [];
    lteData = [];
    orData = [];
    inData = [];
    notData = [];
    dataQueue = [];
    rpcResult = { data: null, error: null };
    rpcCalls = [];
  });

  // Univers complet par défaut (décision 15/07/2026) : la navigation neutre expose
  // TOUS les types de produit — plus aucune exclusion product_type (action, crypto,
  // fps, structuré, private equity compris). Régression garde le comptage honnête :
  // « on est à combien de fonds ? » = tout le catalogue.
  it("navigation neutre : aucune exclusion de product_type", async () => {
    dataResult = { data: [], error: null, count: 0 };
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect(notData.filter(([col]) => col === "product_type")).toHaveLength(0);
    expect(inData.filter(([col]) => col === "product_type")).toHaveLength(0);
  });

  // Le filtre univers reste opérant : universe=action,crypto → .in("product_type", …).
  it("filtre universe : restreint bien product_type aux types demandés", async () => {
    dataResult = { data: [], error: null, count: 0 };
    const res = await GET(req("?universe=action,crypto,structuré"));
    expect(res.status).toBe(200);
    const inPt = inData.filter(([col]) => col === "product_type");
    expect(inPt).toHaveLength(1);
    expect(inPt[0][1]).toEqual(["action", "crypto", "structuré"]);
    expect(notData.filter(([col]) => col === "product_type")).toHaveLength(0);
  });

  // Garde anti-scraping : la pagination PROFONDE (énumération de l'univers) est
  // court-circuitée — page vide cohérente SANS interroger la base (lastRange reste
  // null). page=200, per_page=50 → offset 9950 ≥ MAX_OFFSET (5000) → bloqué.
  it("plafond de pagination : page profonde → page vide sans requête DB", async () => {
    dataResult = {
      data: [{ isin: "FR0000000001", aum_eur: 1000, share_class_group_id: "g1", ter: 0.01, ongoing_charges: 0.012 }],
      error: null,
      count: 9999,
    };

    const res = await GET(req("?page=200&per_page=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.total_pages).toBe(0);
    expect(body.page).toBe(200);
    // Court-circuit AVANT toute requête de données : aucun .range() émis.
    expect(lastRange).toBeNull();
  });

  // Une page normale (offset sous le plafond) n'est PAS affectée par la garde.
  it("plafond de pagination : page normale interroge bien la base", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?page=2&per_page=50"));
    expect(lastRange).toEqual({ from: 50, to: 99 });
  });

  // Régression : un crawler paginant au-delà des résultats (?page=500) provoquait
  // un 416 PostgREST (PGRST103) → 500. On doit renvoyer une page vide cohérente.
  it("renvoie 200 + page vide quand l'offset dépasse les lignes (416 PGRST103)", async () => {
    dataResult = {
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable" },
      count: null,
    };
    countResult = { data: null, error: null, count: 137 };

    const res = await GET(req("?page=50&per_page=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(137);
    expect(body.page).toBe(50);
    expect(body.total_pages).toBe(Math.ceil(137 / 50));
  });

  // Régression prod : sur le runtime Vercel, le body du 416 arrive tronqué, donc
  // JSON.parse échoue dans postgrest-js → l'objet error n'a PAS de `code` PGRST103
  // (message = corps brut illisible). Seul le status HTTP 416 reste fiable. Le fix
  // initial testant uniquement error.code laissait passer ce cas en 500 (incident
  // /api/funds 89 % d'erreurs, crawler charlie-db-dump).
  it("renvoie 200 + page vide sur un 416 dont le body est illisible (status seul)", async () => {
    dataResult = {
      data: null,
      error: { message: '{"' }, // body tronqué, pas de code
      count: null,
      status: 416,
    };
    countResult = { data: null, error: null, count: 137 };

    const res = await GET(req("?page=50&per_page=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(137);
  });

  it("renvoie toujours 500 pour une erreur Supabase non liée au range", async () => {
    dataResult = {
      data: null,
      error: { code: "PGRST500", message: "boom" },
      count: null,
    };

    const res = await GET(req("?page=1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
  });

  it("renvoie 200 + données pour une page valide", async () => {
    dataResult = {
      data: [
        { isin: "FR0000000001", aum_eur: 1000, share_class_group_id: "g1", ter: 0.01, ongoing_charges: 0.012 },
      ],
      error: null,
      count: 1,
    };

    const res = await GET(req("?page=1&per_page=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].isin).toBe("FR0000000001");
    // Frontière API : frais fraction (DB) → % (×100).
    expect(body.data[0].ter).toBeCloseTo(1);
  });

  // Régression : l'offset doit avancer de perPage par page, PAS de perPage×5.
  // L'ancien overfetch ×5 (offset = (page-1)·perPage·5) sautait 5× trop loin →
  // ~80 % des pages annoncées renvoyaient une liste vide et ~76 % des fonds
  // étaient inatteignables. page=3, per_page=50 → range(100, 149).
  it("l'offset suit perPage et non perPage×5", async () => {
    dataResult = { data: [], error: null, count: 0 };

    await GET(req("?page=3&per_page=50"));
    expect(lastRange).toEqual({ from: 100, to: 149 });
  });

  // Régression : total = count exact (count: "exact"), pas une estimation par ratio
  // de dédup ; total_pages couvre toutes les pages. La dédup share-class reste
  // appliquée à l'intérieur de la page (g1 dédupliqué → garde le plus gros encours).
  it("total = count exact et dédup share-class intra-page", async () => {
    dataResult = {
      data: [
        { isin: "FR0000000001", aum_eur: 2000, share_class_group_id: "g1", ter: 0.01, ongoing_charges: 0.012 },
        { isin: "FR0000000002", aum_eur: 1000, share_class_group_id: "g1", ter: 0.02, ongoing_charges: 0.022 },
        { isin: "FR0000000003", aum_eur: 5000, share_class_group_id: "g2", ter: 0.03, ongoing_charges: 0.032 },
      ],
      error: null,
      count: 137,
    };

    const res = await GET(req("?page=1&per_page=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // g1 fusionné (garde l'encours 2000 = FR0000000001), g2 conservé.
    expect(body.data).toHaveLength(2);
    expect(body.data.map((f: any) => f.isin)).toEqual(["FR0000000001", "FR0000000003"]);
    // total = count brut exact, indépendant de la dédup intra-page.
    expect(body.total).toBe(137);
    expect(body.total_pages).toBe(Math.ceil(137 / 50));
  });

  // Dédup share-class portée par la DB : la requête de données doit filtrer
  // is_primary_share_class = true (un seul représentant par groupe) → OFFSET/LIMIT
  // exacts sur les fonds uniques.
  it("filtre is_primary_share_class sur la requête de données", async () => {
    dataResult = { data: [], error: null, count: 0 };

    await GET(req("?page=1&per_page=50"));
    expect(eqData).toContainEqual(["is_primary_share_class", true]);
  });

  // Le même filtre doit s'appliquer à la requête count-only du chemin 416, sinon le
  // `total` d'une page hors-limites compterait les share-classes (≠ fonds uniques).
  it("filtre is_primary_share_class aussi sur la requête count-only (416)", async () => {
    dataResult = {
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable" },
      count: null,
    };
    countResult = { data: null, error: null, count: 137 };

    const res = await GET(req("?page=50&per_page=50"));
    expect(res.status).toBe(200);
    expect(eqHead).toContainEqual(["is_primary_share_class", true]);
  });

  // Retour CGP (23/07) : une recherche TEXTE doit faire remonter les share-classes de
  // PRIVATE EQUITY même non primaires (EPVE3 = Eurazeo PVE3). baseFilters admet alors
  // « is_primary OU product_type non coté » au lieu du filtre dur is_primary.
  it("recherche texte : admet les share-classes de PE (or is_primary/product_type)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?search=eurazeo"));
    expect(orData).toContainEqual("is_primary_share_class.eq.true,product_type.in.(fcpr,fcpi,fip,fpci)");
    // Chemin texte : plus de filtre DUR is_primary (remplacé par le or ci-dessus).
    expect(eqData).not.toContainEqual(["is_primary_share_class", true]);
  });

  // Symétrique : la navigation NEUTRE (sans texte) garde le filtre dur is_primary —
  // l'admission PE est cantonnée au chemin texte (invariant carte==total intact).
  it("navigation neutre : garde le filtre dur is_primary (pas d'admission PE)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?page=1"));
    expect(eqData).toContainEqual(["is_primary_share_class", true]);
    expect(orData).not.toContainEqual("is_primary_share_class.eq.true,product_type.in.(fcpr,fcpi,fip,fpci)");
  });

  // Régression « la recherche par ISIN ne fonctionne jamais » : un ISIN exact doit
  // déclencher une recherche ciblée par eq("isin", …) qui IGNORE les garde-fous de
  // l'univers curé — sinon une part secondaire ou peu renseignée reste introuvable.
  it("recherche par ISIN exact : eq(isin) sans garde-fou is_primary_share_class", async () => {
    dataResult = {
      data: [{ isin: "FR0010315770", aum_eur: 500, ter: 0.015, ongoing_charges: 0.017 }],
      error: null,
      count: null,
    };

    const res = await GET(req("?search=FR0010315770"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].isin).toBe("FR0010315770");
    expect(body.total).toBe(1);
    expect(body.total_pages).toBe(1);
    // Frontière API : frais fraction (DB) → % (×100).
    expect(body.data[0].ter).toBeCloseTo(1.5);
    // Correspondance exacte sur l'ISIN, et AUCUN garde-fou d'univers curé.
    expect(eqData).toContainEqual(["isin", "FR0010315770"]);
    expect(eqData).not.toContainEqual(["is_primary_share_class", true]);
  });

  // L'ISIN est normalisé (minuscules + espaces) avant la correspondance exacte.
  it("recherche par ISIN : normalise casse et espaces", async () => {
    dataResult = { data: [{ isin: "LU0496786574", ter: 0, ongoing_charges: 0 }], error: null, count: null };

    await GET(req(`?search=${encodeURIComponent("  lu0496786574 ")}`));
    expect(eqData).toContainEqual(["isin", "LU0496786574"]);
  });

  // ISIN exact introuvable : page vide cohérente (total 0), pas d'erreur.
  it("recherche par ISIN sans correspondance : page vide", async () => {
    dataResult = { data: [], error: null, count: null };

    const res = await GET(req("?search=FR0000000000"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.total_pages).toBe(0);
  });

  // ─── Filtres Sprint 2 (pertinence) ──────────────────────────────────────────

  // Perte max : la colonne max_drawdown_3y est un % négatif. drawdown_max=20
  // (magnitude) → on garde les fonds dont le drawdown est >= -20.
  // Un filtre seul + tri par défaut = couloir ADÉQUATION → PROXIMITÉ DOUCE active :
  // les seuils de confort sont élargis de SOFT_TOLERANCE (drawdown +5, perf -3, vol +3,
  // sharpe -0.2) ; le score de fit pénalise ensuite le dépassement. La colonne ciblée
  // reste la bonne (c'est ce que vérifient ces tests). Le mode STRICT (tri explicite)
  // est couvert juste après.
  it("drawdown_max borne max_drawdown_3y (magnitude négative, élargie de 5)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?drawdown_max=20"));
    expect(gteData).toContainEqual(["max_drawdown_3y", -25]);
  });

  // Magnitude toujours négative même si l'appelant envoie un nombre négatif.
  it("drawdown_max normalise un signe négatif (abs, élargie de 5)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?drawdown_max=-30"));
    expect(gteData).toContainEqual(["max_drawdown_3y", -35]);
  });

  it("perf_5y_min filtre performance_5y (seuil élargi de 3 en proximité douce)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?perf_5y_min=8"));
    expect(gteData).toContainEqual(["performance_5y", 5]);
  });

  it("vol_3y_max filtre volatility_3y et sharpe_3y_min filtre sharpe_3y (élargis)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?vol_3y_max=12&sharpe_3y_min=0.5"));
    expect(lteData).toContainEqual(["volatility_3y", 15]);
    expect(gteData).toContainEqual(["sharpe_3y", 0.3]);
  });

  // Mode STRICT : un tri EXPLICITE (clic colonne / intention « le moins cher ») sort du
  // couloir adéquation → la proximité douce est désactivée, les seuils restent exacts.
  it("tri explicite désactive la proximité douce (seuils stricts)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?perf_5y_min=8&drawdown_max=20&sort_by=performance_3y"));
    expect(gteData).toContainEqual(["performance_5y", 8]);
    expect(gteData).toContainEqual(["max_drawdown_3y", -20]);
  });

  // Couloir ADÉQUATION : un filtre + tri par défaut → vivier des plus complets
  // re-classé par fit. La complétude domine (B 90 passe devant A 60), le total vient
  // du count exact du vivier.
  it("re-classe le vivier par adéquation (complétude dominante)", async () => {
    const min = (isin: string, dc: number) => ({
      isin, data_completeness: dc, aum_eur: 1_000_000, ter: null,
      share_class_group_id: null,
    });
    dataQueue = [
      { data: [{ isin: "A" }, { isin: "B" }], error: null, count: 2 }, // vivier (ISIN)
      { data: [min("A", 60), min("B", 90)], error: null, count: null }, // enrichissement
    ];
    const res = await GET(req("?asset_class=action"));
    const body = await res.json();
    expect(body.data.map((f: { isin: string }) => f.isin)).toEqual(["B", "A"]);
    expect(body.total).toBe(2);
  });

  // « Sans frais d'entrée » : clause OR null-safe (null inconnu OU <= 0), pour
  // exclure les fonds explicitement chargés sans écarter les no-load non renseignés.
  it("no_entry_fee applique une clause OR null-safe sur entry_fee_max", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?no_entry_fee=true"));
    expect(orData).toContainEqual("entry_fee_max.is.null,entry_fee_max.lte.0");
  });

  // Sans le paramètre, aucun filtre frais d'entrée ne doit être posé.
  it("pas de clause entry_fee_max sans no_entry_fee", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?page=1"));
    expect(orData).not.toContainEqual("entry_fee_max.is.null,entry_fee_max.lte.0");
  });

  // ─── Relâchement gracieux (0 résultat → on desserre les filtres) ────────────

  // 0 résultat + plusieurs filtres relâchables → on sonde les états cumulés EN
  // PARALLÈLE et on s'arrête au PREMIER qui redonne des résultats (findIndex). Ici
  // toutes les sondes count renvoient > 0 : on ne relâche donc QUE le premier filtre
  // (relaxed.length === 1, pas les deux), et la page est rechargée pour cet état.
  it("relâchement gracieux : s'arrête au premier filtre qui redonne des résultats", async () => {
    // 1er chargement = 0 résultat (déclenche le relâchement) ; les requêtes suivantes
    // (phase 1 + enrichissement du rechargement) retombent sur dataResult (count 7).
    dataQueue = [{ data: [], error: null, count: 0 }];
    dataResult = {
      data: [{ isin: "FR0000000009", aum_eur: 10, share_class_group_id: "s", ter: 0, ongoing_charges: 0 }],
      error: null,
      count: 7,
    };
    countResult = { data: null, error: null, count: 7 }; // toute sonde count est > 0
    const res = await GET(req("?drawdown_max=20&ter_max=1&sort_by=performance_3y"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(7);
    expect(body.data.map((f: any) => f.isin)).toEqual(["FR0000000009"]);
    // Un SEUL filtre relâché (le premier dans l'ordre de priorité), pas les deux.
    expect(body.relaxed).toHaveLength(1);
  });

  // Aucun filtre relâchable ne redonne de résultat → aucune donnée, aucun drapeau
  // `relaxed`, page vide cohérente (les sondes parallèles renvoient toutes 0).
  it("relâchement gracieux : toutes les sondes à 0 → page vide sans drapeau relaxed", async () => {
    dataResult = { data: [], error: null, count: 0 };
    countResult = { data: null, error: null, count: 0 };
    const res = await GET(req("?drawdown_max=20&ter_max=1&sort_by=performance_3y"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.data).toEqual([]);
    expect(body.relaxed).toBeUndefined();
  });

  // ─── Ranking de pertinence (toutes les pages) ───────────────────────────────

  // Une recherche texte passe par la RPC classée inv_funds_search (et non la vue
  // brute), avec un tri par `relevance` : l'ordre renvoyé est préservé tel quel sur
  // toutes les pages (le classement est fait côté SQL, ici mocké).
  it("recherche texte : interroge la RPC classée et préserve l'ordre de pertinence", async () => {
    dataResult = {
      data: [
        { isin: "FR0000000002", aum_eur: 999, share_class_group_id: "b", ter: 0, ongoing_charges: 0 },
        { isin: "FR0000000001", aum_eur: 100, share_class_group_id: "a", ter: 0, ongoing_charges: 0 },
      ],
      error: null,
      count: 2,
    };
    const res = await GET(req("?search=amundi%20world"));
    const body = await res.json();
    expect(body.data.map((f: any) => f.isin)).toEqual(["FR0000000002", "FR0000000001"]);
    expect(body.total).toBe(2);
    expect(body.fuzzy).toBeUndefined();
    expect(rpcCalls).toContainEqual(["inv_funds_search", { q: "amundi world" }]);
    expect(rpcCalls.map((c) => c[0])).not.toContain("inv_search_funds_fuzzy"); // résultats présents
  });

  // Tri non-défaut (ex. perf) : on respecte le choix utilisateur, sans tri pertinence
  // prioritaire — mais la source reste la RPC classée (la pertinence reste calculée).
  it("recherche texte : utilise la RPC classée même avec un tri explicite", async () => {
    dataResult = { data: [], error: null, count: 0 };
    rpcResult = { data: [], error: null };
    await GET(req("?search=amundi&sort_by=performance_3y"));
    expect(rpcCalls).toContainEqual(["inv_funds_search", { q: "amundi" }]);
  });

  // Pas de recherche texte → on N'utilise PAS la RPC classée (vue brute + tri normal).
  it("sans recherche texte : pas d'appel à la RPC classée", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?universe=etf"));
    expect(rpcCalls.map((c) => c[0])).not.toContain("inv_funds_search");
  });

  // Fallback fuzzy : 0 résultat exact sur une recherche texte → appel RPC trigramme,
  // résultats approchants réintégrés avec le drapeau fuzzy=true.
  it("fallback fuzzy : 0 résultat exact → RPC trigramme + fuzzy:true", async () => {
    dataQueue = [
      { data: [], error: null, count: 0 },                       // principale : vide
      { data: [{ isin: "FR0010251660", aum_eur: 50, share_class_group_id: "z", ter: 0, ongoing_charges: 0 }], error: null, count: null }, // .in(isins) fuzzy
    ];
    rpcResult = { data: [{ isin: "FR0010251660" }], error: null };
    const res = await GET(req("?search=Amundee"));
    const body = await res.json();
    expect(rpcCalls).toContainEqual(["inv_search_funds_fuzzy", { q: "Amundee", lim: 50 }]);
    expect(body.fuzzy).toBe(true);
    expect(body.data.map((f: any) => f.isin)).toEqual(["FR0010251660"]);
    expect(body.total).toBe(1);
  });

  // Pas de fallback fuzzy quand la RPC ne renvoie rien (typo sans voisin proche).
  it("fallback fuzzy vide : pas de drapeau, page vide cohérente", async () => {
    dataResult = { data: [], error: null, count: 0 };
    rpcResult = { data: [], error: null };
    const res = await GET(req("?search=zzzznotafund"));
    const body = await res.json();
    // RPC classée (0 résultat) puis RPC fuzzy (0 voisin) → toujours vide, sans drapeau.
    expect(rpcCalls.map((c) => c[0])).toEqual(["inv_funds_search", "inv_search_funds_fuzzy"]);
    expect(body.fuzzy).toBeUndefined();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
  });

  // ── Recalibrage visibilité référencement (chantier Partie 1) ────────────────
  // Navigation NEUTRE / filtres hors assureur : le plancher de complétude reste
  // DUR (gte 50). On ne relâche pas l'univers général.
  it("hors filtre assureur : plancher dur data_completeness >= 50 (gte, pas de or relâché)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?universe=etf"));
    expect(gteData).toContainEqual(["data_completeness", 50]);
    expect(orData).not.toContain("data_completeness.gte.50,performance_1y.not.is.null");
  });

  // Sous filtre ASSUREUR : chaque ligne est déjà référencée → on relâche le SEUL
  // plancher de complétude (un fonds référencé AYANT une perf devient visible).
  // Le gate bascule de gte(data_completeness) vers un or(perf présente).
  it("sous filtre assureur : gate relâché (référencé + perf), plus de gte dur sur la complétude", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?insurer=AXA%20France"));
    expect(orData).toContain("data_completeness.gte.50,performance_1y.not.is.null");
    expect(gteData).not.toContainEqual(["data_completeness", 50]);
  });

  // Idem pour un filtre CONTRAT précis (clé composite Assureur::Contrat).
  it("sous filtre contrat : gate relâché (référencé + perf)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?contracts=AXA%20France::Contrat%20X"));
    expect(orData).toContain("data_completeness.gte.50,performance_1y.not.is.null");
    expect(gteData).not.toContainEqual(["data_completeness", 50]);
  });
});

// dedup() est le filet applicatif de dédup des share-classes. Pour le NON COTÉ
// (fcpr/fcpi/fip/fpci), chaque part est un produit distinct → jamais collapsée
// (clé = ISIN). Sinon, un seul représentant par groupe (le plus gros encours).
describe("dedup — non coté (PE) vs OPCVM/ETF", () => {
  const f = (o: Record<string, unknown>) => o as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("collapse les share-classes OPCVM d'un même groupe → représentant au plus gros encours", () => {
    const out = dedup([
      f({ isin: "A", product_type: "opcvm", share_class_group_id: "G1", aum_eur: 100 }),
      f({ isin: "B", product_type: "opcvm", share_class_group_id: "G1", aum_eur: 300 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].isin).toBe("B");
  });

  it("garde CHAQUE part d'un fonds de PE (fcpr/fcpi/fip/fpci) d'un même groupe", () => {
    for (const pt of ["fcpr", "fcpi", "fip", "fpci"]) {
      const out = dedup([
        f({ isin: "P1", product_type: pt, share_class_group_id: "G", aum_eur: 10 }),
        f({ isin: "P2", product_type: pt, share_class_group_id: "G", aum_eur: 20 }),
      ]);
      expect(out.map((r) => r.isin).sort()).toEqual(["P1", "P2"]);
    }
  });

  it("cas EPVE3 : la part non primaire et la part « A » (même groupe) coexistent", () => {
    const out = dedup([
      f({ isin: "FR0013301546", product_type: "fcpr", share_class_group_id: "FR0013301546", aum_eur: 500 }),
      f({ isin: "FR00140107M9", product_type: "fcpr", share_class_group_id: "FR0013301546", aum_eur: 50 }),
    ]);
    expect(out.map((r) => r.isin).sort()).toEqual(["FR0013301546", "FR00140107M9"]);
  });

  it("fps/structuré ne sont PAS du non coté au sens dédup → restent collapsés", () => {
    expect(
      dedup([
        f({ isin: "X", product_type: "fps", share_class_group_id: "G", aum_eur: 1 }),
        f({ isin: "Y", product_type: "fps", share_class_group_id: "G", aum_eur: 2 }),
      ]),
    ).toHaveLength(1);
  });
});
