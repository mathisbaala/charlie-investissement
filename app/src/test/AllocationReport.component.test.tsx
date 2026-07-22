import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AllocationReport } from "@/components/portfolio/AllocationReport";
import { buildPresentation } from "@/lib/allocationRationale";
import type { AllocationResult, AllocationLine } from "@/lib/optimizer";

function line(over: Partial<AllocationLine> & { isin: string }): AllocationLine {
  return {
    name: over.isin, assetClass: "actions", category: "Actions Monde", weight: 10,
    sri: 4, sfdr: 8, ter: 0.01, rating: null, expectedReturn: 0.08, volatility: 0.12, ...over,
  };
}

const RESULT: AllocationResult = {
  lines: [
    line({ isin: "LU1135865084", name: "Amundi S&P 500 ETF", category: "Actions USA", weight: 33.4, assetClass: "actions", sri: 5, rating: 5 }),
    line({ isin: "LU1164219682", name: "AXA WF Euro Credit TR", category: "Oblig. Crédit", weight: 30, assetClass: "obligations", sri: 3 }),
    line({ isin: "FR0013267663", name: "Hugau Moneterme", category: "Monétaire", weight: 10, assetClass: "monetaire", sri: 1 }),
    line({ isin: "LU1897556517", name: "Groupama Global Disruption", category: "Actions Disruption", weight: 26.6, assetClass: "actions", sri: 5, sfdr: 9 }),
  ],
  method: "sharpe" as const,
  expectedReturn: 0.119, volatility: 0.109, sharpe: 0.92, weightedSri: 3.7,
  classWeights: { actions: 60, obligations: 30, monetaire: 10 },
  diversification: { effectiveHoldings: 3.4, averageCorrelation: 0.3, assetClasses: 3 },
  notes: [],
};

describe("AllocationReport", () => {
  const presentation = buildPresentation(RESULT, {
    contractName: "Cardif ELITE",
    universeSize: 1400,
    advisorName: "Charlie Gestion Privée",
  });

  it("affiche l'en-tête, les KPI et toutes les sections", () => {
    render(<AllocationReport presentation={presentation} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Cardif ELITE");
    expect(screen.getByText("Contexte et objectifs")).toBeTruthy();
    expect(screen.getByText("Répartition par classe d'actifs")).toBeTruthy();
    expect(screen.getByText("Portefeuille détaillé")).toBeTruthy();
    expect(screen.getByText("Profil de risque")).toBeTruthy();
    expect(screen.getByText("Avertissements")).toBeTruthy();
    // Réservées au PDF client : absentes de la restitution écran.
    expect(screen.queryByText("Analyse et justification par support")).toBeNull();
    expect(screen.queryByText("Nos convictions de gestion")).toBeNull();
  });

  it("liste chaque support avec son ISIN dans le tableau", () => {
    render(<AllocationReport presentation={presentation} />);
    expect(screen.getByText("LU1135865084")).toBeTruthy();
    expect(screen.getByText("Amundi S&P 500 ETF")).toBeTruthy();
    expect(screen.getByText("AXA WF Euro Credit TR")).toBeTruthy();
  });

  it("affiche le bouton PDF uniquement si pdfHref est fourni", () => {
    const { rerender } = render(<AllocationReport presentation={presentation} />);
    expect(screen.queryByText(/Télécharger la présentation/)).toBeNull();
    rerender(<AllocationReport presentation={presentation} pdfHref="/api/portfolio/optimize/pdf?contract=X" />);
    expect(screen.getByText(/Télécharger la présentation/)).toBeTruthy();
  });

  it("ne crashe pas quand des champs optionnels sont nuls", () => {
    const bare = buildPresentation(
      { ...RESULT, weightedSri: null, lines: RESULT.lines.map((l) => ({ ...l, sri: null, ter: null, category: null })) },
      { contractName: "X" },
    );
    expect(() => render(<AllocationReport presentation={bare} />)).not.toThrow();
  });

  it("rend chaque nom de fonds en lien vers sa fiche /fonds/[isin]", () => {
    render(<AllocationReport presentation={presentation} />);
    const link = screen.getByRole("link", { name: "Amundi S&P 500 ETF" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/fonds/LU1135865084");
  });

  it("affiche la colonne Notation : étoiles si noté, tiret sinon", () => {
    render(<AllocationReport presentation={presentation} />);
    expect(screen.getByText("Notation")).toBeTruthy();
    expect(screen.getByText("★★★★★")).toBeTruthy(); // Amundi, rating 5
    // Les fonds non notés affichent un tiret dans la colonne.
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("affiche l'en-tête de colonne Frais (et plus TER)", () => {
    render(<AllocationReport presentation={presentation} />);
    expect(screen.getByText("Frais")).toBeTruthy();
    expect(screen.queryByText("TER")).toBeNull();
  });

  it("montre le bouton de retrait seulement si onRemoveLine est fourni, et le déclenche avec l'ISIN", () => {
    const onRemove = vi.fn();
    const { rerender } = render(<AllocationReport presentation={presentation} />);
    expect(screen.queryByLabelText(/Retirer Amundi/)).toBeNull();
    rerender(<AllocationReport presentation={presentation} onRemoveLine={onRemove} />);
    fireEvent.click(screen.getByLabelText("Retirer Amundi S&P 500 ETF du portefeuille"));
    expect(onRemove).toHaveBeenCalledWith("LU1135865084");
  });
});
