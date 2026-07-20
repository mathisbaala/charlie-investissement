import { describe, it, expect } from "vitest";
import { buildFraisReport, type SimulationInput, type FraisReportSupportInput } from "@/lib/feeSimulator";

const input: SimulationInput = {
  versementInitial: 10_000,
  versementAnnuel: 0,
  dureeAnnees: 10,
  partUC: 100,
  rendementUC: 5,
  rendementFE: 2.5,
  frais: {
    contratEntree: 2, contratGestionUC: 0.8, contratGestionFE: 0.7, contratSortie: 0,
    ucEntree: 0, ucGestion: 1.8, ucSortie: 0,
  },
  retroCgp: 0.9,
  commissionCabinet: 2,
};

const supports: FraisReportSupportInput[] = [
  { isin: "FR0000295230", name: "Comgest Renaissance Europe", poids: 100, ter: 1.8, entryFee: 0, retro: 0.9 },
];

describe("buildFraisReport", () => {
  it("construit un rapport à l'horizon le plus lointain simulé", () => {
    const r = buildFraisReport(input, supports);
    expect(r).not.toBeNull();
    // Défaut [5,10,15] borné à la durée 10 → horizons [5,10], final = 10.
    expect(r!.horizons.map((h) => h.annees)).toEqual([5, 10]);
    expect(r!.final.annees).toBe(10);
  });

  it("calcule la rémunération par support au prorata de la poche UC", () => {
    const r = buildFraisReport(input, supports)!;
    expect(r.supports).toHaveLength(1);
    const s = r.supports[0];
    // Poche UC = 10 000 € × 100 % ; un seul support à 100 % → 10 000 €.
    expect(s.montant).toBe(10_000);
    expect(s.retroAnnuelle).toBe(90);      // 10 000 × 0,9 %
    expect(s.commissionUpfront).toBe(200); // 10 000 × 2 %
    expect(s.effRetro).toBe(0.9);
  });

  it("ventile le coût total sans perte (assureur + gestion + cabinet ≈ total)", () => {
    const r = buildFraisReport(input, supports)!;
    const { assureur, societeGestion, cabinet } = r.repart;
    expect(assureur + societeGestion + cabinet).toBeCloseTo(r.final.totalFrais, 1);
    expect(cabinet).toBeGreaterThan(0);
    expect(r.remuTotale).toBeCloseTo(r.final.retroCgpCumulee + r.final.commCabinetCumulee, 2);
  });

  it("fonctionne sans supports (le détail est simplement vide)", () => {
    const r = buildFraisReport(input, []);
    expect(r).not.toBeNull();
    expect(r!.supports).toHaveLength(0);
    expect(r!.final.annees).toBe(10);
  });

  it("retourne null quand aucun horizon n'est exploitable", () => {
    // Durée 1 an mais on ne demande que l'horizon 5 → filtré, aucun horizon.
    const r = buildFraisReport({ ...input, dureeAnnees: 1 }, supports, [5]);
    expect(r).toBeNull();
  });

  it("retombe sur le taux de rétrocession du contrat quand le support ne le connaît pas", () => {
    const r = buildFraisReport(input, [{ ...supports[0], retro: null }])!;
    expect(r.supports[0].effRetro).toBe(0.9); // retroCgp du contrat
  });
});
