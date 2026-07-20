import { describe, it, expect } from "vitest";
import { sanitizeFundReport } from "@/lib/fundReport";

// ISIN réels (clé Luhn valide) utilisés dans les fixtures.
const ISIN_ETF = "IE00B4L5Y983"; // iShares Core MSCI World
const ISIN_OPCVM = "FR0000295230"; // Comgest Renaissance Europe

describe("sanitizeFundReport", () => {
  it("accepte une fiche complète et arrondit les frais", () => {
    const r = sanitizeFundReport({
      isin: ISIN_ETF,
      name: "  iShares Core MSCI World  ",
      ongoing_charges: 0.204,
      sri: 4,
      matched_isin: null,
    });
    expect(r).toEqual({
      ok: true,
      fund: {
        isin: ISIN_ETF,
        name: "iShares Core MSCI World",
        ter: 0.2,
        sri: 4,
        catalogued: false,
      },
    });
  });

  it("normalise l'ISIN (casse, espaces)", () => {
    const r = sanitizeFundReport({ isin: `  ${ISIN_ETF.toLowerCase()} ` });
    expect(r.ok && r.fund.isin).toBe(ISIN_ETF);
  });

  it("refuse une fiche sans ISIN lisible ni ISIN attendu", () => {
    for (const isin of [undefined, null, "", "PAS-UN-ISIN", "FR0000000001"]) {
      const r = sanitizeFundReport({ isin, name: "Fonds X" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/ISIN/i);
    }
  });

  it("retombe sur l'ISIN attendu quand le document n'en porte pas", () => {
    const r = sanitizeFundReport({ isin: null, name: "Autocall Stellantis" }, ISIN_OPCVM);
    expect(r.ok && r.fund.isin).toBe(ISIN_OPCVM);
  });

  it("refuse un document dont l'ISIN diffère de la ligne visée", () => {
    const r = sanitizeFundReport({ isin: ISIN_ETF }, ISIN_OPCVM);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain(ISIN_ETF);
      expect(r.error).toContain(ISIN_OPCVM);
    }
  });

  it("accepte un document dont l'ISIN confirme la ligne visée", () => {
    const r = sanitizeFundReport({ isin: ISIN_OPCVM, sri: 5 }, ISIN_OPCVM);
    expect(r.ok && r.fund.sri).toBe(5);
  });

  it("écarte les frais hors bornes ou non numériques", () => {
    for (const ongoing_charges of [-0.1, 21, Number.NaN, "1,50", null]) {
      const r = sanitizeFundReport({ isin: ISIN_ETF, ongoing_charges });
      expect(r.ok && r.fund.ter).toBeNull();
    }
    const ok = sanitizeFundReport({ isin: ISIN_ETF, ongoing_charges: 1.5 });
    expect(ok.ok && ok.fund.ter).toBe(1.5);
  });

  it("écarte un SRI hors bornes ou non entier", () => {
    for (const sri of [0, 8, 3.5, "4", null]) {
      const r = sanitizeFundReport({ isin: ISIN_ETF, sri });
      expect(r.ok && r.fund.sri).toBeNull();
    }
  });

  it("nettoie le nom (scrub) et tronque à 120 caractères", () => {
    const r = sanitizeFundReport({
      isin: ISIN_ETF,
      name: `Fonds dédié M. Dupont 1234567 ${"x".repeat(200)}`,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fund.name).not.toContain("Dupont");
      expect(r.fund.name).not.toContain("1234567");
      expect((r.fund.name ?? "").length).toBeLessThanOrEqual(120);
    }
  });

  it("signale un fonds finalement au catalogue via matched_isin", () => {
    const r = sanitizeFundReport({ isin: ISIN_ETF, matched_isin: ISIN_ETF });
    expect(r.ok && r.fund.catalogued).toBe(true);
    const other = sanitizeFundReport({ isin: ISIN_ETF, matched_isin: ISIN_OPCVM });
    expect(other.ok && other.fund.catalogued).toBe(false);
  });

  it("tolère une fiche vide ou non-objet", () => {
    expect(sanitizeFundReport(null).ok).toBe(false);
    expect(sanitizeFundReport(undefined, ISIN_ETF).ok).toBe(true);
  });
});
