import { describe, it, expect } from "vitest";
import {
  findIsin, findOngoingCharges, findSri, extractDiciFields, diciFeesComplete,
  type DiciDeterministic,
} from "@/lib/diciParse";

// ISIN réels (clé Luhn valide) utilisés dans les fixtures.
const ISIN_ETF = "IE00B4L5Y983";      // iShares Core MSCI World
const ISIN_OPCVM = "FR0000295230";    // Comgest Renaissance Europe

const KID = `Amundi MSCI World UCITS ETF
Document d'informations clés
Code ISIN : ${ISIN_ETF}
Indicateur de risque
Nous avons classé ce produit dans la classe de risque 4 sur 7, ce qui correspond à une classe de risque moyenne.
Quels sont les coûts ?
Frais courants  0,38 %
Frais d'entrée  2,00 %
Frais de sortie  Néant`;

const KIID = `Comgest Renaissance Europe
Informations clés pour l'investisseur
${ISIN_OPCVM}
Profil de risque et de rendement
1 2 3 4 5 6 7
Le fonds est classé dans la catégorie 5.
Frais
Frais courants : 1,50 %
Frais d'entrée : 3 %
Frais de sortie : néant`;

describe("findIsin", () => {
  it("retourne le premier ISIN valide (clé Luhn)", () => {
    expect(findIsin(KID)).toBe(ISIN_ETF);
    expect(findIsin(KIID)).toBe(ISIN_OPCVM);
  });
  it("retourne null quand aucun ISIN valide n'est présent", () => {
    expect(findIsin("Aucun code ici, juste 1234567890.")).toBeNull();
    // Un jeton au bon gabarit mais clé Luhn fausse est rejeté.
    expect(findIsin("FR0000000001")).toBeNull();
  });
});

describe("findOngoingCharges", () => {
  it("lit les frais courants d'un KID/KIID", () => {
    expect(findOngoingCharges(KID)).toBe(0.38);
    expect(findOngoingCharges(KIID)).toBe(1.5);
  });
  it("lit le libellé PRIIPs 'frais de gestion et autres frais'", () => {
    const t = "Frais de gestion et autres frais administratifs ou d'exploitation  0,85 %";
    expect(findOngoingCharges(t)).toBe(0.85);
  });
  it("rejette un pourcentage implausible (faux positif)", () => {
    expect(findOngoingCharges("Frais courants  55 %")).toBeNull();
  });
  it("retourne null si absent", () => {
    expect(findOngoingCharges("Objectif : suivre l'indice.")).toBeNull();
  });
});

describe("findSri", () => {
  it("lit la classe de risque assignée (KID) sans confondre avec le /7", () => {
    expect(findSri(KID)).toBe(4);
  });
  it("lit la catégorie assignée (KIID) sans prendre l'échelle 1..7", () => {
    expect(findSri(KIID)).toBe(5);
  });
  it("retourne null si l'indicateur est absent", () => {
    expect(findSri("Frais courants 1 %")).toBeNull();
  });
});

describe("extractDiciFields", () => {
  it("assemble les champs frais d'un KID", () => {
    const d = extractDiciFields(KID);
    expect(d.isin).toBe(ISIN_ETF);
    expect(d.ongoing_charges).toBe(0.38);
    expect(d.sri).toBe(4);
    expect(d.entry_fees_max).toBe("2.00 %");
    expect(d.exit_fees_max).toBe("Néant");
  });
  it("gère un KIID avec frais d'entrée entier et sortie néant", () => {
    const d = extractDiciFields(KIID);
    expect(d.isin).toBe(ISIN_OPCVM);
    expect(d.ongoing_charges).toBe(1.5);
    expect(d.entry_fees_max).toBe("3 %");
    expect(d.exit_fees_max).toBe("Néant");
  });
});

describe("diciFeesComplete", () => {
  const base: DiciDeterministic = {
    isin: ISIN_ETF, name: null, ongoing_charges: 0.38, sri: 4,
    entry_fees_max: "2 %", exit_fees_max: "Néant",
  };
  it("est vrai avec ISIN + frais courants (les deux indispensables)", () => {
    expect(diciFeesComplete(base)).toBe(true);
  });
  it("est faux sans ISIN", () => {
    expect(diciFeesComplete({ ...base, isin: null })).toBe(false);
  });
  it("est faux sans frais courants (on escaladera vers l'IA)", () => {
    expect(diciFeesComplete({ ...base, ongoing_charges: null })).toBe(false);
  });
});
