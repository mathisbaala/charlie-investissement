import { describe, it, expect, vi, beforeEach } from "vitest";

// Résultat configurable de supabase.rpc("inv_data_rate_limit", …) + capture des args.
let rpcResult: { data: any; error: any };
let lastRpc: { name: string; args: any } | null;
let throwOnRpc: boolean;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (name: string, args: any) => {
      lastRpc = { name, args };
      if (throwOnRpc) throw new Error("boom");
      return Promise.resolve(rpcResult);
    },
  },
}));

import { dataRateLimit, clientIp } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://test.local/api/funds", { headers });
}

describe("dataRateLimit", () => {
  beforeEach(() => {
    rpcResult = { data: null, error: null };
    lastRpc = null;
    throwOnRpc = false;
  });

  it("laisse passer (null) quand allowed=true", async () => {
    rpcResult = { data: { allowed: true, scope: "ok" }, error: null };
    expect(await dataRateLimit(req({ "x-real-ip": "1.2.3.4" }))).toBeNull();
    expect(lastRpc?.name).toBe("inv_data_rate_limit");
    expect(lastRpc?.args.p_ip).toBe("1.2.3.4");
  });

  it("renvoie 429 + Retry-After 60 quand le plafond MINUTE est franchi", async () => {
    rpcResult = { data: { allowed: false, scope: "minute" }, error: null };
    const res = await dataRateLimit(req({ "x-real-ip": "1.2.3.4" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBe("60");
    const body = await res!.json();
    expect(body.error).toBe("rate_limited");
    expect(body.scope).toBe("minute");
  });

  it("renvoie 429 + Retry-After 3600 quand le plafond HEURE est franchi", async () => {
    rpcResult = { data: { allowed: false, scope: "hour" }, error: null };
    const res = await dataRateLimit(req({ "x-real-ip": "1.2.3.4" }));
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBe("3600");
  });

  // Fail-open : une erreur de comptage ne doit JAMAIS bloquer un utilisateur.
  it("fail-open : erreur RPC → null", async () => {
    rpcResult = { data: null, error: { message: "db down" } };
    expect(await dataRateLimit(req({ "x-real-ip": "1.2.3.4" }))).toBeNull();
  });

  it("fail-open : data absente → null", async () => {
    rpcResult = { data: null, error: null };
    expect(await dataRateLimit(req({ "x-real-ip": "1.2.3.4" }))).toBeNull();
  });

  // Sémantique STRICTE : on ne bloque que sur allowed===false explicite. Un retour
  // inattendu (sans champ allowed) laisse passer plutôt que de générer un faux 429.
  it("retour inattendu (pas de champ allowed) → null (pas de faux 429)", async () => {
    rpcResult = { data: { scope: "ok" }, error: null };
    expect(await dataRateLimit(req({ "x-real-ip": "1.2.3.4" }))).toBeNull();
  });

  it("fail-open : exception → null", async () => {
    throwOnRpc = true;
    expect(await dataRateLimit(req({ "x-real-ip": "1.2.3.4" }))).toBeNull();
  });
});

describe("clientIp — résolution non usurpable", () => {
  it("privilégie x-real-ip", () => {
    expect(clientIp(req({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
  });

  it("retombe sur le 1er maillon de x-vercel-forwarded-for", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": "8.8.8.8, 10.0.0.1" }))).toBe("8.8.8.8");
  });

  // Hors Vercel : on prend le DERNIER maillon de XFF (le plus proche du proxy de
  // confiance), pas le premier (que le client peut usurper).
  it("hors Vercel : prend le dernier maillon de x-forwarded-for", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("aucun en-tête → 'unknown'", () => {
    expect(clientIp(req())).toBe("unknown");
  });
});
