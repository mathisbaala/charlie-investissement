import { describe, it, expect } from "vitest";
import { normalizeNlQuery, NLP_CACHE_VERSION } from "@/lib/nlpCache";

describe("normalizeNlQuery", () => {
  it("passe en minuscules", () => {
    expect(normalizeNlQuery("ETF Monde")).toBe("etf monde");
  });

  it("réduit les espaces multiples et coupe les bords", () => {
    expect(normalizeNlQuery("  ETF   Monde  ")).toBe("etf monde");
    expect(normalizeNlQuery("fonds\tprudent\n")).toBe("fonds prudent");
  });

  it("regroupe les variantes de casse/espaces sur une même clé", () => {
    expect(normalizeNlQuery("ETF  MONDE")).toBe(normalizeNlQuery("etf monde"));
  });

  it("retire les chevrons < > (comme le prompt)", () => {
    expect(normalizeNlQuery("ETF <Monde>")).toBe("etf monde");
  });

  it("conserve les accents (porteurs de sens en français)", () => {
    expect(normalizeNlQuery("Fonds à Échéance 2028")).toBe("fonds à échéance 2028");
  });

  it("borne à 500 caractères", () => {
    const long = "a".repeat(600);
    expect(normalizeNlQuery(long).length).toBe(500);
  });

  it("renvoie une chaîne vide pour une entrée vide ou d'espaces", () => {
    expect(normalizeNlQuery("   ")).toBe("");
    expect(normalizeNlQuery("")).toBe("");
  });

  it("expose une version de cache stable et non vide (pour l'invalidation)", () => {
    expect(typeof NLP_CACHE_VERSION).toBe("string");
    expect(NLP_CACHE_VERSION.length).toBeGreaterThan(0);
  });
});
