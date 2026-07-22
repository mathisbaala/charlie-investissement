import { describe, it, expect } from "vitest";
import { buildSystemPrompt, sanitizeParsedCalc } from "../lib/calculators/parse";
import { CALCULATORS } from "../lib/calculators/registry";

describe("buildSystemPrompt", () => {
  it("liste tous les calculateurs du registre (ids et champs)", () => {
    const p = buildSystemPrompt();
    for (const c of CALCULATORS) {
      expect(p).toContain(`id "${c.id}"`);
      for (const f of c.fields) expect(p).toContain(`- ${f.key} (`);
    }
  });
});

describe("sanitizeParsedCalc — validation dure de la sortie LLM", () => {
  it("écarte un id inconnu et des candidats inconnus", () => {
    const r = sanitizeParsedCalc({ calculator_id: "hallucination", candidates: ["autre-halu", "droits-partage"] });
    expect(r.calculatorId).toBeNull();
    expect(r.candidates).toEqual(["droits-partage"]);
  });
  it("garde un id connu et ne retient que ses champs valides", () => {
    const r = sanitizeParsedCalc({
      calculator_id: "droits-donation-succession",
      values: {
        montant: 300000,
        lien: "enfant",
        mode: "donation",
        champ_inconnu: 42,       // clé hallucinée → écartée
        handicap: "true",        // bool en string → coercé
        abattement_consomme: -5, // sous le min → écarté
      },
    });
    expect(r.calculatorId).toBe("droits-donation-succession");
    expect(r.values).toEqual({ montant: 300000, lien: "enfant", mode: "donation", handicap: true });
  });
  it("écarte une valeur d'enum hors options", () => {
    const r = sanitizeParsedCalc({
      calculator_id: "droits-donation-succession",
      values: { lien: "cousin_lointain" },
    });
    expect(r.values.lien).toBeUndefined();
  });
  it("parse les nombres en notation française (« 300 000 », « 1,5 »)", () => {
    const r = sanitizeParsedCalc({
      calculator_id: "droits-donation-succession",
      values: { montant: "300 000" },
    });
    expect(r.values.montant).toBe(300000);
  });
  it("borne les candidats à 3 et exclut l'id retenu", () => {
    const ids = CALCULATORS.map((c) => c.id);
    const r = sanitizeParsedCalc({ calculator_id: ids[0], candidates: ids });
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    expect(r.candidates).not.toContain(ids[0]);
  });
  it("entrée non-objet → résultat vide sans jeter", () => {
    expect(sanitizeParsedCalc("n'importe quoi")).toEqual({ calculatorId: null, candidates: [], values: {} });
    expect(sanitizeParsedCalc(null)).toEqual({ calculatorId: null, candidates: [], values: {} });
  });
});
