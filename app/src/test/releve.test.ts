import { describe, it, expect } from "vitest";
import {
  isValidIsin, parseFrenchAmount, extractPositions, consolidate,
} from "@/lib/releve";

describe("isValidIsin", () => {
  it("accepte des ISIN réels (clé Luhn valide)", () => {
    expect(isValidIsin("FR0000120271")).toBe(true); // TotalEnergies
    expect(isValidIsin("LU1829221024")).toBe(true); // Amundi Nasdaq
    expect(isValidIsin("IE00B4L5Y983")).toBe(true); // iShares Core MSCI World
  });
  it("rejette une clé de contrôle fausse", () => {
    expect(isValidIsin("FR0000120272")).toBe(false);
  });
  it("rejette les formats invalides (longueur, codes internes)", () => {
    expect(isValidIsin("FRSGK0000000")).toBe(false); // code interne Sogécap
    expect(isValidIsin("FR00001202")).toBe(false);
    expect(isValidIsin("")).toBe(false);
  });
});

describe("parseFrenchAmount", () => {
  it("lit les formats français usuels", () => {
    expect(parseFrenchAmount("12 345,67")).toBeCloseTo(12345.67);
    expect(parseFrenchAmount("1.234,56 €")).toBeCloseTo(1234.56);
    expect(parseFrenchAmount("12 345,67 EUR")).toBeCloseTo(12345.67); // espace insécable
    expect(parseFrenchAmount("845")).toBe(845);
  });
  it("retourne null sur du texte non numérique", () => {
    expect(parseFrenchAmount("N/A")).toBeNull();
    expect(parseFrenchAmount("")).toBeNull();
  });
});

describe("extractPositions", () => {
  it("extrait libellé avant l'ISIN + le plus grand montant de la ligne", () => {
    const text = "Comgest Renaissance Europe C   FR0000295230   45,2100   123,45   5 581,23 €";
    const [p] = extractPositions(text);
    expect(p.isin).toBe("FR0000295230");
    expect(p.label).toContain("Comgest");
    expect(p.amount).toBeCloseTo(5581.23);
  });
  it("extrait le libellé APRÈS l'ISIN quand la colonne est inversée", () => {
    const text = "FR0000295230   Comgest Renaissance Europe C   1 200,00";
    const [p] = extractPositions(text);
    expect(p.label).toContain("Comgest");
    expect(p.amount).toBe(1200);
  });
  it("ignore les faux ISIN (clé Luhn invalide) et les en-têtes", () => {
    const text = [
      "Code ISIN   Libellé du support   Montant",
      "FR0000120272   Fonds Fantôme   9 999,99", // clé fausse
    ].join("\n");
    expect(extractPositions(text)).toHaveLength(0);
  });
  it("fusionne les occurrences multiples d'un même ISIN en sommant", () => {
    const text = [
      "Poche libre   LU1829221024  Amundi Nasdaq  1 000,00",
      "Poche gérée   LU1829221024  Amundi Nasdaq  2 500,00",
    ].join("\n");
    const out = extractPositions(text);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(3500);
  });
  it("laisse amount à null quand la ligne ne porte aucun montant", () => {
    const [p] = extractPositions("Support en euros Nouvelle Génération  FR0000120271");
    expect(p.amount).toBeNull();
  });
});

describe("consolidate", () => {
  it("somme par ISIN et calcule des poids qui totalisent 1", () => {
    const out = consolidate([
      { isin: "A0000000000", name: "A", amount: 3000 },
      { isin: "B0000000000", name: "B", amount: 1000 },
      { isin: "A0000000000", name: "A", amount: 1000 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].isin).toBe("A0000000000"); // trié par montant décroissant
    expect(out[0].amount).toBe(4000);
    expect(out[0].weight).toBeCloseTo(0.8);
    expect(out.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1);
  });
  it("ignore les montants nuls/négatifs et rend [] si rien de valorisé", () => {
    expect(consolidate([{ isin: "A", name: "A", amount: 0 }])).toHaveLength(0);
    expect(consolidate([])).toHaveLength(0);
  });
});
