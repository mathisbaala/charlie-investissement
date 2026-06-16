import { describe, it, expect } from "vitest";
import {
  typesOf, inEnvelope, realContracts, visibleContracts,
  isInsurerVisible, otherEnvelopes, parseContractKey, type ContractLike,
} from "@/lib/insurer-envelope";

const c = (over: Partial<ContractLike>): ContractLike => ({
  company: "Suravenir", contract: "Linxea Spirit 2", ...over,
});

describe("typesOf", () => {
  it("retourne les types explicites", () => {
    expect(typesOf(c({ types: ["per", "av"] }))).toEqual(["per", "av"]);
  });
  it("défaut « av » si types absent", () => {
    expect(typesOf(c({ types: undefined }))).toEqual(["av"]);
  });
  it("défaut « av » si types vide", () => {
    expect(typesOf(c({ types: [] }))).toEqual(["av"]);
  });
});

describe("inEnvelope", () => {
  it("vrai quand le type est présent", () => {
    expect(inEnvelope(c({ types: ["av", "per"] }), "per")).toBe(true);
  });
  it("faux quand le type est absent", () => {
    expect(inEnvelope(c({ types: ["capi"] }), "av")).toBe(false);
  });
  it("un contrat sans type compte comme AV", () => {
    expect(inEnvelope(c({ types: undefined }), "av")).toBe(true);
    expect(inEnvelope(c({ types: undefined }), "per")).toBe(false);
  });
});

describe("realContracts", () => {
  it("retire le contrat redondant unique (= nom assureur)", () => {
    const all = [c({ contract: "Suravenir" })];
    expect(realContracts(all, "Suravenir")).toEqual([]);
  });
  it("garde le contrat homonyme s'il n'est pas seul", () => {
    const all = [c({ contract: "Suravenir" }), c({ contract: "Linxea Spirit 2" })];
    expect(realContracts(all, "Suravenir")).toHaveLength(2);
  });
  it("retire les contrats au libellé vide", () => {
    const all = [c({ contract: "" }), c({ contract: "Linxea Avenir 2" })];
    expect(realContracts(all, "Suravenir")).toHaveLength(1);
  });
});

describe("visibleContracts", () => {
  const all = [
    c({ contract: "Linxea Spirit 2", types: ["av", "per"] }),
    c({ contract: "Suravenir Capi", types: ["capi"] }),
    c({ contract: "Suravenir Évolution", types: ["av"], closed: true }),
  ];
  it("filtre sur l'enveloppe active", () => {
    expect(visibleContracts(all, "Suravenir", "av", false).map((x) => x.contract))
      .toEqual(["Linxea Spirit 2", "Suravenir Évolution"]);
    expect(visibleContracts(all, "Suravenir", "capi", false).map((x) => x.contract))
      .toEqual(["Suravenir Capi"]);
  });
  it("masque les contrats fermés quand demandé", () => {
    expect(visibleContracts(all, "Suravenir", "av", true).map((x) => x.contract))
      .toEqual(["Linxea Spirit 2"]);
  });
});

describe("isInsurerVisible", () => {
  it("visible si ≥1 contrat de l'enveloppe", () => {
    const all = [c({ contract: "Suravenir Capi", types: ["capi"] })];
    expect(isInsurerVisible(all, "Suravenir", "capi", false)).toBe(true);
    expect(isInsurerVisible(all, "Suravenir", "av", false)).toBe(false);
  });
  it("AV : visible même sans détail de contrat (cas AV Lux redondant)", () => {
    const all = [c({ contract: "Suravenir" })]; // redondant → 0 contrat réel
    expect(isInsurerVisible(all, "Suravenir", "av", false)).toBe(true);
    expect(isInsurerVisible(all, "Suravenir", "per", false)).toBe(false);
  });
  it("non-AV : pas de repli en-tête seule", () => {
    const all: ContractLike[] = [];
    expect(isInsurerVisible(all, "Spirica", "per", false)).toBe(false);
  });
  it("invisible en AV si l'unique contrat AV est fermé et qu'on masque les fermés", () => {
    const all = [c({ contract: "Vie Plus", types: ["av"], closed: true })];
    expect(isInsurerVisible(all, "Generali", "av", true)).toBe(false);
    expect(isInsurerVisible(all, "Generali", "av", false)).toBe(true);
  });
});

describe("otherEnvelopes", () => {
  it("retourne les types hors enveloppe active (marqueur « aussi X »)", () => {
    expect(otherEnvelopes(c({ types: ["av", "per"] }), "av")).toEqual(["per"]);
  });
  it("vide quand le contrat n'a que l'enveloppe active", () => {
    expect(otherEnvelopes(c({ types: ["av"] }), "av")).toEqual([]);
  });
});

describe("parseContractKey", () => {
  it("décompose « Assureur::Contrat »", () => {
    expect(parseContractKey("Suravenir::Linxea Spirit 2"))
      .toEqual({ company: "Suravenir", contract: "Linxea Spirit 2" });
  });
  it("split sur le PREMIER « :: » (le nom de contrat peut en contenir)", () => {
    expect(parseContractKey("Generali::Contrat :: Edition 2"))
      .toEqual({ company: "Generali", contract: "Contrat :: Edition 2" });
  });
  it("fallback sans « :: » : assureur null, clé = nom de contrat", () => {
    expect(parseContractKey("Linxea Spirit 2"))
      .toEqual({ company: null, contract: "Linxea Spirit 2" });
  });
});
