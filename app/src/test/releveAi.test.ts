import { describe, it, expect } from "vitest";
import { scrubDocumentText, sanitizeAiExtraction } from "@/lib/releveAi";

// Fonctions PURES de la lecture IA des relevés (le call LLM n'est pas testé ici).

describe("scrubDocumentText (anonymisation avant envoi au tiers)", () => {
  it("masque n° de contrat, e-mails et civilité+nom", () => {
    const t = scrubDocumentText(
      "Adhérent n° 12345678 — Madame Martin — contact : jean.martin@mail.fr\n" +
        "Téléphone 0612345678",
    );
    expect(t).not.toContain("12345678");
    expect(t).not.toContain("Martin");
    expect(t).not.toContain("@mail.fr");
    expect(t).not.toContain("0612345678");
  });

  it("préserve les ISIN malgré leurs 10 chiffres", () => {
    const t = scrubDocumentText("AMUNDI MSCI WORLD  FR0010655746  12 345,67 EUR");
    expect(t).toContain("FR0010655746");
    expect(t).toContain("12 345,67");
  });

  it("préserve montants français formatés et millésimes", () => {
    const t = scrubDocumentText("Horizon 2030 — total 1 234 567,89 EUR — perf 11,32%");
    expect(t).toContain("2030");
    expect(t).toContain("1 234 567,89");
    expect(t).toContain("11,32%");
  });

  it("plusieurs ISIN sont tous restaurés à leur place", () => {
    const t = scrubDocumentText("A FR0010655746 x\nB LU1135865084 y — dossier 9876543");
    expect(t).toContain("FR0010655746");
    expect(t).toContain("LU1135865084");
    expect(t).not.toContain("9876543");
  });
});

describe("sanitizeAiExtraction (validation de la sortie LLM)", () => {
  it("retombe sur zéro position pour une sortie invalide", () => {
    for (const raw of [null, "texte", 42, [], {}]) {
      const r = sanitizeAiExtraction(raw);
      expect(r.positions).toEqual([]);
      expect(r.documentTotal).toBeNull();
    }
  });

  it("écarte les ISIN invalides ou hallucinés, garde les valides", () => {
    const r = sanitizeAiExtraction({
      positions: [
        { isin: "FR0010655746", libelle: "Moneta Multi Caps", montant_eur: 1000 },
        { isin: "XX0000000000", libelle: "Halluciné", montant_eur: 500 }, // checksum KO
        { isin: "PASUNISIN", libelle: "Trop court", montant_eur: 10 },
      ],
      total_document: 1000,
    });
    expect(r.positions.map((p) => p.isin)).toEqual(["FR0010655746"]);
    expect(r.documentTotal).toBe(1000);
  });

  it("fusionne les doublons d'ISIN en sommant (multi-poches)", () => {
    const r = sanitizeAiExtraction({
      positions: [
        { isin: "FR0010655746", libelle: "Moneta", montant_eur: 600 },
        { isin: "FR0010655746", libelle: "", montant_eur: 400.5 },
      ],
    });
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0].amount).toBeCloseTo(1000.5, 6);
  });

  it("neutralise les montants non plausibles (négatif, infini, énorme) en null", () => {
    const r = sanitizeAiExtraction({
      positions: [
        { isin: "FR0010655746", libelle: "A", montant_eur: -5 },
        { isin: "LU1135865084", libelle: "B", montant_eur: 1e12 },
      ],
    });
    expect(r.positions.every((p) => p.amount === null)).toBe(true);
  });

  it("re-scrube les libellés (défense en profondeur RGPD)", () => {
    const r = sanitizeAiExtraction({
      positions: [
        { isin: "FR0010655746", libelle: "Fonds de M. Dupont n° 99887766", montant_eur: 10 },
      ],
    });
    expect(r.positions[0].label).not.toContain("Dupont");
    expect(r.positions[0].label).not.toContain("99887766");
  });

  it("rejette un total_document non plausible", () => {
    expect(sanitizeAiExtraction({ positions: [], total_document: -3 }).documentTotal).toBeNull();
    expect(sanitizeAiExtraction({ positions: [], total_document: "beaucoup" }).documentTotal).toBeNull();
  });
});
