import { describe, it, expect } from "vitest";
import { partnerKind, supportsSub } from "@/lib/partenaires";

describe("partnerKind", () => {
  it("classe les courtiers/banques", () => {
    expect(partnerKind("Fortuneo")).toBe("courtier");
    expect(partnerKind("Bourse Direct")).toBe("courtier");
  });
  it("classe tout le reste en assureur (défaut)", () => {
    expect(partnerKind("Suravenir")).toBe("assureur");
    expect(partnerKind("")).toBe("assureur");
  });
});

describe("supportsSub", () => {
  it("PEA chez un courtier → fonds et ETF négociables", () => {
    expect(supportsSub("Fortuneo", ["pea"])).toBe("fonds et ETF négociables");
  });
  it("PEA de capitalisation chez un ASSUREUR → unités de compte", () => {
    expect(supportsSub("BNP Paribas Cardif", ["pea"])).toBe("unités de compte");
  });
  it("courtier mais contrat non-PEA (Linxea AV) → unités de compte", () => {
    expect(supportsSub("Linxea", ["av"])).toBe("unités de compte");
    expect(supportsSub("Linxea", ["av", "pea"])).toBe("unités de compte");
  });
});
