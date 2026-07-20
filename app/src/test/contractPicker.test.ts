import { describe, it, expect } from "vitest";
import { rankContracts, contractLabel, type ContractOption } from "../components/portfolio/ContractPicker";
import { SAMPLE_CONTRACT } from "../lib/sampleUniverse";

// Référencement minimal : trois assureurs, contrats mélangés.
const OPTIONS: ContractOption[] = [
  { company: "Cardif Lux Vie", key: "Cardif Lux Vie::Cardif Elite Lux", contract: "Cardif Elite Lux", funds: 420 },
  { company: "Cardif Lux Vie", key: "Cardif Lux Vie::Cardif Essentiel", contract: "Cardif Essentiel", funds: 210 },
  { company: "Axa", key: "Axa::Coralis Sélection", contract: "Coralis Sélection", funds: 300 },
  { company: "Generali Luxembourg", key: "Generali Luxembourg::Espace Lux Vie", contract: "Espace Lux Vie", funds: 716 },
];

describe("rankContracts (périmètre STRICT : l'allocation ne sort jamais des partenaires)", () => {
  it("sans assureur renseigné, cherche dans tous les contrats", () => {
    const hits = rankContracts(OPTIONS, "lux", [], new Set());
    expect(hits.map((o) => o.company)).toContain("Generali Luxembourg");
    expect(hits.map((o) => o.company)).toContain("Cardif Lux Vie");
  });

  it("restreint la recherche aux assureurs renseignés", () => {
    const hits = rankContracts(OPTIONS, "", ["Cardif Lux Vie"], new Set());
    expect(hits).toHaveLength(2);
    expect(hits.every((o) => o.company === "Cardif Lux Vie")).toBe(true);
  });

  it("les contrats déclarés dans Mon cabinet remontent en tête", () => {
    const hits = rankContracts(
      OPTIONS, "", ["Cardif Lux Vie"],
      new Set(["Cardif Lux Vie::Cardif Essentiel"]),
    );
    expect(hits[0].key).toBe("Cardif Lux Vie::Cardif Essentiel");
  });

  it("ne propose JAMAIS un contrat hors des assureurs renseignés, même en recherche active", () => {
    // « Coralis » existe chez Axa, mais Axa n'est pas partenaire → aucun résultat.
    const hits = rankContracts(OPTIONS, "coralis", ["Cardif Lux Vie"], new Set());
    expect(hits).toEqual([]);
  });

  it("la recherche ignore accents et casse", () => {
    const hits = rankContracts(OPTIONS, "CORALIS SELECTION", [], new Set());
    expect(hits.map((o) => o.key)).toEqual(["Axa::Coralis Sélection"]);
  });
});

describe("contractLabel", () => {
  it("rend la clé composite lisible et nomme le contrat d'exemple", () => {
    expect(contractLabel("Axa::Coralis Sélection")).toBe("Axa — Coralis Sélection");
    // Contrat d'exemple : libellé réaliste préfixé « Ex. » (affiché grisé).
    expect(contractLabel(SAMPLE_CONTRACT)).toBe("Ex. Charlie Vie Premium");
  });
});
