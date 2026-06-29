import { describe, it, expect, afterEach } from "vitest";
import { isBotUserAgent, botGuard } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

function req(ua?: string) {
  const headers: Record<string, string> = {};
  if (ua !== undefined) headers["user-agent"] = ua;
  return new NextRequest("https://test.local/api/funds", { headers });
}

// UA d'un navigateur réel (toujours « Mozilla/… »).
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

afterEach(() => {
  delete process.env.BOT_FILTER_ENABLED;
  delete process.env.BOT_UA_EXTRA;
});

describe("isBotUserAgent", () => {
  it("détecte les bibliothèques de scripting connues", () => {
    expect(isBotUserAgent("python-requests/2.31.0")).toBe(true);
    expect(isBotUserAgent("curl/8.4.0")).toBe(true);
    expect(isBotUserAgent("Scrapy/2.11 (+https://scrapy.org)")).toBe(true);
    expect(isBotUserAgent("Go-http-client/2.0")).toBe(true);
  });

  it("UA absent ou vide = bot (un navigateur en envoie toujours un)", () => {
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent("   ")).toBe(true);
  });

  it("laisse passer un vrai navigateur", () => {
    expect(isBotUserAgent(CHROME)).toBe(false);
  });

  it("est insensible à la casse", () => {
    expect(isBotUserAgent("PYTHON-REQUESTS/2.0")).toBe(true);
  });

  it("BOT_UA_EXTRA ajoute des signatures (ex. headlesschrome)", () => {
    expect(isBotUserAgent("Mozilla/5.0 HeadlessChrome/124")).toBe(false);
    process.env.BOT_UA_EXTRA = "headlesschrome,acme-monitor";
    expect(isBotUserAgent("Mozilla/5.0 HeadlessChrome/124")).toBe(true);
    expect(isBotUserAgent("acme-monitor/1.0")).toBe(true);
  });
});

describe("botGuard", () => {
  it("renvoie 403 pour un UA de scraper", async () => {
    const res = botGuard(req("python-requests/2.31.0"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe("forbidden");
  });

  it("renvoie 403 pour un UA absent", () => {
    expect(botGuard(req())!.status).toBe(403);
  });

  it("laisse passer (null) un vrai navigateur", () => {
    expect(botGuard(req(CHROME))).toBeNull();
  });

  it("désactivé par env (BOT_FILTER_ENABLED=0) → null même pour un bot", () => {
    process.env.BOT_FILTER_ENABLED = "0";
    expect(botGuard(req("curl/8.4.0"))).toBeNull();
  });

  it("BOT_FILTER_ENABLED=false désactive aussi", () => {
    process.env.BOT_FILTER_ENABLED = "false";
    expect(botGuard(req("curl/8.4.0"))).toBeNull();
  });

  it("actif par défaut (env absente) → bloque le bot", () => {
    expect(botGuard(req("curl/8.4.0"))!.status).toBe(403);
  });
});
