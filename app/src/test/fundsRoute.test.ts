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
  for (const m of ["in", "not", "overlaps", "ilike", "order", "limit", "filter"]) {
    builder[m] = () => builder;
  }
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

import { GET } from "@/app/api/funds/route";
import { NextRequest } from "next/server";

function req(qs: string) {
  return new NextRequest(`https://test.local/api/funds${qs}`);
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
    dataQueue = [];
    rpcResult = { data: null, error: null };
    rpcCalls = [];
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

    const res = await GET(req("?page=500&per_page=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(137);
    expect(body.page).toBe(500);
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

    const res = await GET(req("?page=500&per_page=50"));
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

    const res = await GET(req("?page=500&per_page=50"));
    expect(res.status).toBe(200);
    expect(eqHead).toContainEqual(["is_primary_share_class", true]);
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
  it("drawdown_max borne max_drawdown_3y à la magnitude négative", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?drawdown_max=20"));
    expect(gteData).toContainEqual(["max_drawdown_3y", -20]);
  });

  // Magnitude toujours négative même si l'appelant envoie un nombre négatif.
  it("drawdown_max normalise un signe négatif (abs)", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?drawdown_max=-30"));
    expect(gteData).toContainEqual(["max_drawdown_3y", -30]);
  });

  it("perf_5y_min filtre performance_5y", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?perf_5y_min=8"));
    expect(gteData).toContainEqual(["performance_5y", 8]);
  });

  it("vol_3y_max filtre volatility_3y et sharpe_3y_min filtre sharpe_3y", async () => {
    dataResult = { data: [], error: null, count: 0 };
    await GET(req("?vol_3y_max=12&sharpe_3y_min=0.5"));
    expect(lteData).toContainEqual(["volatility_3y", 12]);
    expect(gteData).toContainEqual(["sharpe_3y", 0.5]);
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
});
