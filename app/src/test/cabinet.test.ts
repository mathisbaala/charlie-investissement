import { describe, it, expect, beforeEach } from "vitest";
import {
  EMPTY_CABINET,
  emptyContract,
  loadStoredCabinet,
  saveStoredCabinet,
  searchInsurerContracts,
  normalizeContract,
  cabinetContract,
  hasAnyConvention,
  resolveUcRetroShare,
  resolveFundRetrocession,
  type CabinetSettings,
} from "../lib/cabinet";

function cab(): CabinetSettings {
  return {
    ...EMPTY_CABINET,
    insurers: ["Cardif Lux Vie"],
    contracts: [
      normalizeContract({
        key: "Cardif Lux Vie::Cardif Elite Lux",
        contractFeeShare: 0.005,
        ucRetroShare: 0.5,
        fundOverrides: [{ isin: "LU0000000001", share: 0.6 }],
      }),
      emptyContract("Cardif Lux Vie::Cardif Essentiel"),
    ],
  };
}

describe("searchInsurerContracts (ajout des contrats à la recherche)", () => {
  const REF = [
    { company: "Cardif Lux Vie", key: "Cardif Lux Vie::Cardif Elite Lux" },
    { company: "Cardif Lux Vie", key: "Cardif Lux Vie::Cardif Essentiel" },
    { company: "Axa", key: "Axa::Coralis Sélection" },
  ];
  const none = new Set<string>();

  it("recherche vide → tous les contrats de l'assureur, jamais ceux des autres", () => {
    const out = searchInsurerContracts(REF, "Cardif Lux Vie", none, "");
    expect(out.map((o) => o.key)).toEqual([
      "Cardif Lux Vie::Cardif Elite Lux",
      "Cardif Lux Vie::Cardif Essentiel",
    ]);
  });

  it("filtre par la recherche, casse et accents ignorés", () => {
    expect(searchInsurerContracts(REF, "Cardif Lux Vie", none, "ÉLITE").map((o) => o.key))
      .toEqual(["Cardif Lux Vie::Cardif Elite Lux"]);
    expect(searchInsurerContracts(REF, "Cardif Lux Vie", none, "zzz")).toEqual([]);
  });

  it("exclut les contrats déjà ajoutés et respecte la limite", () => {
    const out = searchInsurerContracts(
      REF, "Cardif Lux Vie", new Set(["Cardif Lux Vie::Cardif Elite Lux"]), "",
    );
    expect(out.map((o) => o.key)).toEqual(["Cardif Lux Vie::Cardif Essentiel"]);
    expect(searchInsurerContracts(REF, "Cardif Lux Vie", none, "", 1)).toHaveLength(1);
  });
});

describe("loadStoredCabinet (migration v2 : fin du rattachement d'office)", () => {
  beforeEach(() => localStorage.clear());

  it("un cabinet d'avant v2 perd ses conventions vierges auto-rattachées, garde les renseignées", () => {
    localStorage.setItem(
      "charlie_cabinet_settings",
      JSON.stringify({
        cabinetName: "Cab",
        insurers: ["Cardif Lux Vie"],
        contracts: [
          { key: "Cardif Lux Vie::Cardif Elite Lux", ucRetroShare: 0.5, fundOverrides: [] },
          { key: "Cardif Lux Vie::Cardif Essentiel", ucRetroShare: null, fundOverrides: [] },
        ],
      }),
    );
    const out = loadStoredCabinet();
    expect(out.contracts.map((c) => c.key)).toEqual(["Cardif Lux Vie::Cardif Elite Lux"]);
    expect(out.contracts[0].ucRetroShare).toBe(0.5);
    expect(out.insurers).toEqual(["Cardif Lux Vie"]);
  });

  it("à partir de v2, un contrat ajouté volontairement mais encore vierge survit au rechargement", () => {
    saveStoredCabinet({
      ...EMPTY_CABINET,
      insurers: ["Cardif Lux Vie"],
      contracts: [emptyContract("Cardif Lux Vie::Cardif Essentiel")],
    });
    const out = loadStoredCabinet();
    expect(out.contracts.map((c) => c.key)).toEqual(["Cardif Lux Vie::Cardif Essentiel"]);
    // Le marqueur de version ne fuit pas dans l'objet chargé.
    expect("v" in out).toBe(false);
  });
});

describe("normalizeContract (compatibilité localStorage ancien format)", () => {
  it("complète les champs de rétrocession absents des contrats déjà stockés", () => {
    const legacy = {
      key: "Axa::Coralis",
      contractFeeShare: 0.004,
      ucRetroShare: 0.5,
      fundOverrides: [{ isin: "FR0000000001", share: 0.6 }],
    };
    const n = normalizeContract(legacy);
    expect(n.entryFeeShare).toBeNull();
    expect(n.arbitrageFeeShare).toBeNull();
    expect(n.eurosRetroShare).toBeNull();
    expect(n.customFees).toEqual([]);
    // Les valeurs existantes sont conservées telles quelles.
    expect(n.contractFeeShare).toBe(0.004);
    expect(n.fundOverrides).toHaveLength(1);
  });

  it("conserve les nouveaux champs quand ils sont présents", () => {
    const n = normalizeContract({
      ...emptyContract("Axa::Coralis"),
      entryFeeShare: 0.01,
      customFees: [{ label: "Commission SCPI", rate: 0.005 }],
    });
    expect(n.entryFeeShare).toBe(0.01);
    expect(n.customFees).toEqual([{ label: "Commission SCPI", rate: 0.005 }]);
  });
});

describe("hasAnyConvention", () => {
  it("faux sans convention ou sur un contrat vierge", () => {
    expect(hasAnyConvention(null)).toBe(false);
    expect(hasAnyConvention(emptyContract("Axa::Coralis"))).toBe(false);
  });
  it("vrai dès qu'un taux est renseigné, quel que soit le type", () => {
    expect(hasAnyConvention({ ...emptyContract("k"), ucRetroShare: 0.5 })).toBe(true);
    expect(hasAnyConvention({ ...emptyContract("k"), entryFeeShare: 0.01 })).toBe(true);
    expect(hasAnyConvention({ ...emptyContract("k"), arbitrageFeeShare: 0.002 })).toBe(true);
    expect(hasAnyConvention({ ...emptyContract("k"), eurosRetroShare: 0.003 })).toBe(true);
    expect(hasAnyConvention({ ...emptyContract("k"), customFees: [{ label: "SCPI", rate: 0.005 }] })).toBe(true);
    expect(hasAnyConvention({ ...emptyContract("k"), fundOverrides: [{ isin: "X", share: 0.6 }] })).toBe(true);
  });
  it("une rétrocession libre sans taux ne suffit pas", () => {
    expect(hasAnyConvention({ ...emptyContract("k"), customFees: [{ label: "SCPI", rate: null }] })).toBe(false);
  });
});

describe("cabinetContract", () => {
  it("retrouve la convention par clé, null sinon", () => {
    expect(cabinetContract(cab(), "Cardif Lux Vie::Cardif Elite Lux")?.ucRetroShare).toBe(0.5);
    expect(cabinetContract(cab(), "Axa::Inconnu")).toBeNull();
  });
});

describe("resolveUcRetroShare (cascade)", () => {
  const contract = cab().contracts[0];
  it("l'exception par fonds prime sur le taux du contrat", () => {
    expect(resolveUcRetroShare(contract, "LU0000000001")).toBe(0.6);
    expect(resolveUcRetroShare(contract, "lu0000000001")).toBe(0.6); // insensible à la casse
  });
  it("retombe sur le taux UC du contrat", () => {
    expect(resolveUcRetroShare(contract, "FR0000000009")).toBe(0.5);
  });
  it("null sans convention ou sans taux renseigné", () => {
    expect(resolveUcRetroShare(null, "FR0000000009")).toBeNull();
    expect(resolveUcRetroShare(cab().contracts[1], "FR0000000009")).toBeNull();
  });
});

describe("resolveFundRetrocession", () => {
  const contract = cab().contracts[0];
  it("applique part × frais courants du fonds", () => {
    // 50 % × 1,8 % de frais → 0,9 % d'encours/an
    expect(resolveFundRetrocession(contract, "FR0000000009", 0.018, 0.004)).toBeCloseTo(0.009, 9);
    // exception 60 % × 1,0 % → 0,6 %
    expect(resolveFundRetrocession(contract, "LU0000000001", 0.01, 0.004)).toBeCloseTo(0.006, 9);
  });
  it("retombe sur l'estimation quand la convention ou les frais manquent", () => {
    expect(resolveFundRetrocession(null, "X", 0.018, 0.004)).toBe(0.004);
    expect(resolveFundRetrocession(contract, "X", null, 0.004)).toBe(0.004);
    expect(resolveFundRetrocession(cab().contracts[1], "X", 0.018, null)).toBeNull();
  });
});
