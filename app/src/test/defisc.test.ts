import { describe, it, expect } from "vitest";
import { taxSchemeLabel, taxRegimeLabel, hasIrReduction } from "@/lib/defisc";

describe("taxSchemeLabel", () => {
  it("mappe les dispositifs connus (dont FPCI)", () => {
    expect(taxSchemeLabel("fip")).toBe("FIP");
    expect(taxSchemeLabel("fip_corse")).toBe("FIP Corse");
    expect(taxSchemeLabel("fcpi")).toBe("FCPI");
    expect(taxSchemeLabel("fpci")).toBe("FPCI");
  });
  it("insensible à la casse", () => {
    expect(taxSchemeLabel("FCPR")).toBe("FCPR");
  });
  it("repli = code en majuscules si inconnu", () => {
    expect(taxSchemeLabel("truc")).toBe("TRUC");
  });
  it("null si absent", () => {
    expect(taxSchemeLabel(null)).toBeNull();
    expect(taxSchemeLabel(undefined)).toBeNull();
  });
});

describe("taxRegimeLabel", () => {
  it("mappe les régimes connus", () => {
    expect(taxRegimeLabel("ir_pme")).toBe("Réduction d'IR à la souscription");
    expect(taxRegimeLabel("exoneration_pv")).toBe("Exonération d'impôt sur les plus-values");
    expect(taxRegimeLabel("apport_cession_150_0_b_ter")).toBe("Remploi apport-cession (150-0 B ter)");
  });
  it("null si régime absent ou inconnu", () => {
    expect(taxRegimeLabel(null)).toBeNull();
    expect(taxRegimeLabel("autre")).toBeNull();
  });
});

describe("hasIrReduction", () => {
  it("vrai uniquement pour ir_pme", () => {
    expect(hasIrReduction("ir_pme")).toBe(true);
  });
  it("faux pour les régimes d'exonération de plus-values", () => {
    expect(hasIrReduction("exoneration_pv")).toBe(false);
    expect(hasIrReduction("apport_cession_150_0_b_ter")).toBe(false);
  });
  it("faux si absent", () => {
    expect(hasIrReduction(null)).toBe(false);
    expect(hasIrReduction(undefined)).toBe(false);
  });
});
