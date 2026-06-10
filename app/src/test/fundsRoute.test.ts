import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chaînable et « thenable » du client supabase. Chaque méthode de filtre/tri
// renvoie le builder lui-même ; `await query` résout selon le scénario configuré.
// On distingue la requête de données (avec .range) de la requête count-only
// (select avec { head: true }) déclenchée dans le chemin d'erreur 416.
let dataResult: any;
let countResult: any;

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
  // Toutes les méthodes de filtre/tri/range renvoient le builder.
  for (const m of ["gte", "lte", "eq", "in", "or", "not", "overlaps", "ilike", "order", "range"]) {
    builder[m] = () => builder;
  }
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
});
