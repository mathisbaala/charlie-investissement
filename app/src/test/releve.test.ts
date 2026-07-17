import { describe, it, expect } from "vitest";
import {
  isValidIsin, parseFrenchAmount, extractPositions, consolidate, scrubLabel,
  looksLikeFeeDocument,
} from "@/lib/releve";

describe("looksLikeFeeDocument", () => {
  it("vrai quand des supports existent mais qu'aucun n'est valorisé", () => {
    expect(looksLikeFeeDocument([
      { isin: "FR0010094839", label: "Afer Actions Monde", amount: null },
    ])).toBe(true);
  });
  it("faux dès qu'un montant existe, ou sans position", () => {
    expect(looksLikeFeeDocument([
      { isin: "FR0010094839", label: "Afer Actions Monde", amount: 1200 },
      { isin: "LU2216001268", label: "Afer Climat", amount: null },
    ])).toBe(false);
    expect(looksLikeFeeDocument([])).toBe(false);
  });
});

describe("scrubLabel (anonymisation)", () => {
  it("masque n° d'adhérent, e-mails et civilités+nom", () => {
    expect(scrubLabel("Comgest Renaissance — Adhérent 1234567")).toBe("Comgest Renaissance — Adhérent •");
    expect(scrubLabel("Contact jean.dupont@mail.fr Fonds Europe")).toBe("Contact • Fonds Europe");
    expect(scrubLabel("M. Dupont Fonds Patrimoine")).toBe("• Fonds Patrimoine");
    expect(scrubLabel("Madame Martin — poche libre")).toBe("• — poche libre");
  });
  it("préserve les noms de fonds légitimes (millésimes 4 chiffres, sigles)", () => {
    expect(scrubLabel("Horizon 2030 Actions Europe")).toBe("Horizon 2030 Actions Europe");
    expect(scrubLabel("CAC 40 ESG UCITS ETF")).toBe("CAC 40 ESG UCITS ETF");
  });
});

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
  it("ignore les entiers des libellés quand des colonnes décimales existent (cas réel)", () => {
    // Relevé-titres réel : « 500 » appartient au NOM du fonds ; la valorisation
    // est la plus grande colonne décimale (8 parts × 57,49 = 459,92).
    const [p] = extractPositions("8  AM.SP 500 ETF ACC (FR0011871128)  *  57,49  459,92  100,00  45,74");
    expect(p.amount).toBeCloseTo(459.92);
    // Sans aucune colonne décimale, l'entier reste utilisable (repli).
    const [q] = extractPositions("Fonds Divers  FR0000295230  1200");
    expect(q.amount).toBe(1200);
  });
  it("apparie par NOM quand montants et ISIN vivent sur des pages différentes (relevé Afer)", () => {
    // Structure réelle du relevé trimestriel Afer : synthèse chiffrée sans ISIN
    // (page 2), annexe performances avec ISIN sans montants (page 3).
    const text = [
      "AFER ACTIONS MONDE  2 866,84 €  30,97 %  1,5715  1 824,26 €",
      "AFER ACTIONS AMERIQUE  2 810,79 €  30,37 %  9,2442  304,06 €",
      "FONDS GARANTI EN EUROS (2)  1 309,22 €  14,15 %  sans objet",
      "FR0011399658  AFER ACTIONS AMERIQUE  Ofi Invest Asset Management",
      "FR0010094839  AFER ACTIONS MONDE  Ofi Invest Asset Management",
      "AFER ACTIONS MONDE  FR0010094839  MSCI World All Countries Index  11,32%",
    ].join("\n");
    const out = extractPositions(text);
    const byIsin = Object.fromEntries(out.map((p) => [p.isin, p.amount]));
    // Valeur de rachat (le plus grand décimal de la ligne), pas la VL ni la perf.
    expect(byIsin["FR0010094839"]).toBeCloseTo(2866.84);
    expect(byIsin["FR0011399658"]).toBeCloseTo(2810.79);
    expect(out).toHaveLength(2); // le fonds euros sans ISIN n'invente pas de position
  });
  it("n'assimile JAMAIS un pourcentage à un montant (annexes loi PACTE)", () => {
    // Cas réel (annexe Afer) : la ligne porte l'indice de référence et sa perf.
    const [p] = extractPositions("AFER ACTIONS MONDE  FR0010094839  MSCI World All Countries Index  11,32%");
    expect(p.amount).toBeNull();
    // Mixte : perf en % ET vraie valorisation en € sur la même ligne.
    const [q] = extractPositions("Fonds Europe  FR0000295230  11,32%  5 574,67 €");
    expect(q.amount).toBeCloseTo(5574.67);
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
