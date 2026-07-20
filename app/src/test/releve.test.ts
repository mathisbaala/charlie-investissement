import { describe, it, expect } from "vitest";
import {
  isValidIsin, parseFrenchAmount, extractPositions, consolidate, scrubLabel,
  looksLikeFeeDocument, extractDocumentTotal, reconcileTotal, csvToText, rowsToText,
  sanitizeAiPositions, mergePositions, type ExtractedPosition,
} from "@/lib/releve";

describe("csvToText (ingestion CSV)", () => {
  it("convertit un export point-virgule et alimente l'extraction", () => {
    const text = csvToText([
      "Support;ISIN;Quantité;Valorisation",
      "Comgest Renaissance Europe C;FR0000295230;18,45;5 574,67",
    ].join("\n"));
    const [p] = extractPositions(text);
    expect(p.isin).toBe("FR0000295230");
    expect(p.amount).toBeCloseTo(5574.67);
  });
  it("respecte les guillemets : virgule décimale ET délimiteur virgule", () => {
    const text = csvToText('"Fonds Europe",FR0000295230,"1 234,56"');
    const [p] = extractPositions(text);
    expect(p.amount).toBeCloseTo(1234.56);
  });
});

describe("rowsToText (ingestion Excel)", () => {
  it("rend les nombres JS en décimales à virgule (sinon 1234.56 serait faux)", () => {
    const text = rowsToText([
      ["Support", "ISIN", "Valorisation"],
      ["Comgest Renaissance Europe C", "FR0000295230", 5574.67],
    ]);
    const [p] = extractPositions(text);
    expect(p.amount).toBeCloseTo(5574.67);
  });
  it("cellules vides et non-chaînes sans casse", () => {
    expect(rowsToText([[null, undefined, "x", 12]])).toBe("    x  12");
  });
});

describe("extractDocumentTotal", () => {
  it("prend le plus grand total de valorisation (cas Afer et relevé titres)", () => {
    expect(extractDocumentTotal([
      "TOTAL VALEUR DE RACHAT  9 255,86 Euros",
      "TOTAL DE L'EPARGNE DISPONIBLE au 01/04/2026  9 255,86 Euros",
    ].join("\n"))).toBeCloseTo(9255.86);
    expect(extractDocumentTotal([
      "Sous-Total  459,92  100,00",
      "TOTAL VALEURS FRANCAISES  459,92  100,00",
    ].join("\n"))).toBeCloseTo(459.92);
  });
  it("ignore les totaux de frais/versements et rend null sans total", () => {
    expect(extractDocumentTotal("Total des frais  123,45 €")).toBeNull();
    expect(extractDocumentTotal("Total des versements  10 000,00 €")).toBeNull();
    expect(extractDocumentTotal("aucune ligne de synthèse")).toBeNull();
  });
});

describe("reconcileTotal", () => {
  it("ok dans la tolérance (1 € ou 0,5 %), gap au-delà avec l'écart chiffré", () => {
    expect(reconcileTotal(9255.5, 9255.86)?.status).toBe("ok");
    const gap = reconcileTotal(7946.64, 9255.86);
    expect(gap?.status).toBe("gap");
    expect(gap?.diff).toBeCloseTo(1309.22); // le fonds euros manquant du cas Afer
  });
  it("null quand le document n'a pas de total exploitable", () => {
    expect(reconcileTotal(1000, null)).toBeNull();
    expect(reconcileTotal(1000, 0)).toBeNull();
  });
});

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

describe("sanitizeAiPositions (validation de la sortie IA)", () => {
  it("ne retient que les ISIN à clé Luhn valide (filet anti-hallucination)", () => {
    const out = sanitizeAiPositions([
      { isin: "FR0000295230", label: "Comgest Europe", amount: 5000 },
      { isin: "FR0000295231", label: "code inventé", amount: 9999 }, // check digit faux
      { isin: "pas un isin", amount: 1 },
      "chaîne parasite",
    ]);
    expect(out.map((p) => p.isin)).toEqual(["FR0000295230"]);
  });
  it("coerce les montants nombre ET chaîne française, écarte les négatifs", () => {
    const out = sanitizeAiPositions([
      { isin: "FR0000295230", amount: "12 345,67 €" },
      { isin: "FR0010959676", amount: 1000 },
      { isin: "IE00B4L5Y983", amount: -50 },
    ]);
    const by = Object.fromEntries(out.map((p) => [p.isin, p.amount]));
    expect(by["FR0000295230"]).toBeCloseTo(12345.67);
    expect(by["FR0010959676"]).toBe(1000);
    expect(by["IE00B4L5Y983"]).toBeNull();
  });
  it("fusionne les doublons d'ISIN en sommant (multi-poches)", () => {
    const out = sanitizeAiPositions([
      { isin: "FR0000295230", amount: 100 },
      { isin: "FR0000295230", amount: 250 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(350);
  });
  it("normalise la casse de l'ISIN et anonymise le libellé", () => {
    const out = sanitizeAiPositions([{ isin: "fr0000295230", label: "M. Dupont — Fonds X", amount: 10 }]);
    expect(out[0].isin).toBe("FR0000295230");
    expect(out[0].label).not.toContain("Dupont");
  });
  it("entrée non-tableau → tableau vide", () => {
    expect(sanitizeAiPositions(null)).toEqual([]);
    expect(sanitizeAiPositions({})).toEqual([]);
  });
});

describe("mergePositions (fusion IA primary + regex filet)", () => {
  const P = (isin: string, amount: number | null, label = ""): ExtractedPosition => ({ isin, amount, label });
  it("union par ISIN : ajoute les ISIN vus par la seule regex", () => {
    const merged = mergePositions([P("FR0000295230", 100)], [P("FR0010959676", 200)]);
    expect(merged.map((p) => p.isin).sort()).toEqual(["FR0000295230", "FR0010959676"]);
  });
  it("primary (IA) fait autorité sur le montant en cas de conflit", () => {
    const merged = mergePositions([P("FR0000295230", 100)], [P("FR0000295230", 999)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(100);
  });
  it("le filet regex comble un montant manquant de l'IA", () => {
    const merged = mergePositions([P("FR0000295230", null)], [P("FR0000295230", 500)]);
    expect(merged[0].amount).toBe(500);
  });
  it("le filet regex comble un libellé vide de l'IA", () => {
    const merged = mergePositions([P("FR0000295230", 100, "")], [P("FR0000295230", 100, "Comgest")]);
    expect(merged[0].label).toBe("Comgest");
  });
});
