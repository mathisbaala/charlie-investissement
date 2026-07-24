import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReferencementCard } from "@/app/(app)/fonds/[isin]/ReferencementCard";
import type { FundDetailHF } from "@/lib/types";

// ReferencementCard ne lit que fund.insurers — on caste un objet minimal.
function fundWith(insurers: FundDetailHF["insurers"]): FundDetailHF {
  return { insurers } as FundDetailHF;
}

// Regression: une fiche fonds renvoyait 500 (SSR) + error boundary (client) dès
// qu'un assureur référencé avait `contracts: null` (sortie get_fund_insurers).
// .filter sur null → TypeError → crash de la fiche entière. ~6,5% des fonds.
describe("ReferencementCard", () => {
  it("ne crashe pas quand un assureur a contracts: null", () => {
    const fund = fundWith([
      { company: "BNP Paribas Cardif", contracts: ["Triptis Patrimoine"] },
      { company: "Generali Luxembourg", contracts: null },
    ]);

    expect(() => render(<ReferencementCard fund={fund} />)).not.toThrow();

    // L'assureur sans contrats détaillés reste affiché (juste sans puces).
    expect(screen.getByText("Generali Luxembourg")).toBeTruthy();
    expect(screen.getByText("BNP Paribas Cardif")).toBeTruthy();
  });

  it("affiche l'état vide quand aucun référencement", () => {
    render(<ReferencementCard fund={fundWith([])} />);
    expect(screen.getByText("Aucun référencement renseigné")).toBeTruthy();
  });

  it("annote les contrats avec leurs frais d'enveloppe + fourchette agrégée", () => {
    const fund = {
      insurers: [{ company: "Spirica", contracts: ["Linxea Spirit", "Linxea Spirit 2"] }],
      contract_terms: [
        { key: "Spirica::Linxea Spirit", company: "Spirica", contract: "Linxea Spirit", frais_entree_pct: 0, frais_gestion_uc_pct: 0.5, frais_gestion_fonds_euros_pct: null, frais_arbitrage_pct: 0, confidence: "curated" },
        { key: "Spirica::Linxea Spirit 2", company: "Spirica", contract: "Linxea Spirit 2", frais_entree_pct: 0, frais_gestion_uc_pct: 0.6, frais_gestion_fonds_euros_pct: null, frais_arbitrage_pct: 0, confidence: "curated" },
      ],
    } as FundDetailHF;
    render(<ReferencementCard fund={fund} />);
    // Fourchette de gestion d'enveloppe (0,5 → 0,6 %).
    expect(screen.getByText(/0,5 %\s*–\s*0,6 %\/an/)).toBeTruthy();
    // Frais par contrat affichés.
    expect(screen.getByText("0,5 %/an")).toBeTruthy();
    expect(screen.getByText("0,6 %/an")).toBeTruthy();
  });
});
