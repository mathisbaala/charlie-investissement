import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chaînable et « thenable » du client supabase. Chaque méthode de filtre/tri
// renvoie le builder lui-même ; `await query` résout selon le scénario configuré.
// On distingue la requête de données (avec .range) de la requête count-only
// (select avec { head: true }) déclenchée dans le chemin d'erreur 416.
let dataResult: any;
let countResult: any;
// Capture les bornes du dernier .range(from, to) de la requête de données (pas de la
// requête count-only head), pour vérifier le calcul d'offset de la pagination.
let lastRange: { from: number; to: number } | null;

function makeBuilder() {
  let isHead = false;
  const builder: any = {
    select: (_cols: string, opts?: { head?: boolean }) => {
      if (opts?.head) isHead = true;
      return builder;
    },
    then: (resolve: (v: any) => any) =>
      Promise.resolve(isHead ? countResult : dataResult).then(resolve),
  };
  // Toutes les méthodes de filtre/tri renvoient le builder.
  for (const m of ["gte", "lte", "eq", "in", "or", "not", "overlaps", "ilike", "order"]) {
    builder[m] = () => builder;
  }
  // range : on enregistre les bornes (uniquement pour la requête de données).
  builder.range = (from: number, to: number) => {
    if (!isHead) lastRange = { from, to };
    return builder;
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => makeBuilder() },
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
});
