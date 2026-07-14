import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkowitzChart } from "@/components/portfolio/MarkowitzChart";
import { covarianceMatrix } from "@/lib/correlation";
import type { AllocationLine } from "@/lib/optimizer";

const LINES: AllocationLine[] = [
  { isin: "FR0000000001", name: "Fonds Actions Monde", assetClass: "actions", weight: 50, expectedReturn: 0.08, volatility: 0.18, sri: 5, sfdr: 8, ter: 0.004 },
  { isin: "FR0000000002", name: "Fonds Obligations Euro", assetClass: "obligations", weight: 30, expectedReturn: 0.035, volatility: 0.05, sri: 2, sfdr: 8, ter: 0.006 },
  { isin: "FR0000000003", name: "Fonds Monétaire", assetClass: "monetaire", weight: 20, expectedReturn: 0.025, volatility: 0.006, sri: 1, sfdr: 6, ter: 0.001 },
];
const COV = covarianceMatrix(
  LINES.map((l) => l.volatility),
  [
    [1, 0.2, 0.0],
    [0.2, 1, 0.1],
    [0.0, 0.1, 1],
  ],
  0,
);

describe("MarkowitzChart", () => {
  it("trace le plan : frontière, un point par support, portefeuilles et légende", () => {
    const { container } = render(<MarkowitzChart lines={LINES} cov={COV} riskFree={0.02} />);
    expect(screen.getByText("Positionnement risque / rendement")).toBeTruthy();
    // Légende complète.
    expect(screen.getByText("Frontière efficiente")).toBeTruthy();
    expect(screen.getByText("Supports retenus")).toBeTruthy();
    expect(screen.getByText("Portefeuille optimal")).toBeTruthy();
    expect(screen.getByText("Portefeuille simulé")).toBeTruthy();
    // 3 supports (r=4) + 2 portefeuilles (r=6) dans le SVG principal.
    const chart = container.querySelector('svg[role="img"]')!;
    expect(chart.querySelectorAll('circle[r="4"]').length).toBe(3);
    expect(chart.querySelectorAll('circle[r="6"]').length).toBe(2);
    // Frontière tracée.
    expect(chart.querySelector("path")).toBeTruthy();
    // Un curseur par support.
    expect(screen.getAllByRole("slider").length).toBe(3);
  });

  it("recalcule le portefeuille simulé quand on bouge un poids", () => {
    render(<MarkowitzChart lines={LINES} cov={COV} riskFree={0.02} />);
    // À l'ouverture, poids = optimaux → pas de comparatif ni de bouton de reset.
    expect(screen.queryByText("Revenir à l'optimal")).toBeNull();

    const slider = screen.getByLabelText("Poids de Fonds Actions Monde");
    fireEvent.change(slider, { target: { value: "10" } });

    // Le mode « édité » s'active : comparatif vs optimal + bouton de reset.
    expect(screen.getAllByText(/optimal/i).length).toBeGreaterThan(1);
    const reset = screen.getByText("Revenir à l'optimal");
    fireEvent.click(reset);
    expect(screen.queryByText("Revenir à l'optimal")).toBeNull();
  });

  it("recalcule le SRI moyen pondéré quand on bouge un poids", () => {
    render(<MarkowitzChart lines={LINES} cov={COV} riskFree={0.02} />);
    // Départ : 0,5×5 + 0,3×2 + 0,2×1 = 3,3.
    expect(screen.getByTestId("simulated-sri").textContent).toContain("3,3".replace(",", "."));

    // Tout le poids sur le monétaire (SRI 1) → le SRI simulé plonge vers 1.
    fireEvent.change(screen.getByLabelText("Poids de Fonds Actions Monde"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Poids de Fonds Obligations Euro"), { target: { value: "0" } });
    const sri = screen.getByTestId("simulated-sri").textContent!;
    expect(sri).toContain("1.0 / 7");
    // Le comparatif vs optimal s'affiche en mode édité.
    expect(sri).toContain("optimal 3.3");
  });

  it("affiche un tiret quand aucun SRI n'est renseigné", () => {
    const noSri = LINES.map((l) => ({ ...l, sri: null }));
    render(<MarkowitzChart lines={noSri} cov={COV} riskFree={0.02} />);
    expect(screen.getByTestId("simulated-sri").textContent).toContain("-");
  });

  it("normalise les poids affichés à 100 %", () => {
    render(<MarkowitzChart lines={LINES} cov={COV} riskFree={0.02} />);
    const slider = screen.getByLabelText("Poids de Fonds Monétaire");
    fireEvent.change(slider, { target: { value: "0" } });
    // Total saisi 50+30+0=80 → note de normalisation présente.
    expect(screen.getByText(/normalisé à 100 %/)).toBeTruthy();
    // Les 2 poids restants normalisés : 62,5 % et 37,5 %.
    expect(screen.getByText("62,5 %")).toBeTruthy();
    expect(screen.getByText("37,5 %")).toBeTruthy();
  });

  it("mode piloté : notifie le parent des poids, null au retour à l'optimal", () => {
    const received: (number[] | null)[] = [];
    const { rerender } = render(
      <MarkowitzChart lines={LINES} cov={COV} riskFree={0.02} weights={null}
        onWeightsChange={(w) => received.push(w)} />,
    );
    fireEvent.change(screen.getByLabelText("Poids de Fonds Actions Monde"), { target: { value: "10" } });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([10, 30, 20]);

    // Le parent répercute les poids → le mode « édité » s'active.
    rerender(
      <MarkowitzChart lines={LINES} cov={COV} riskFree={0.02} weights={received[0]}
        onWeightsChange={(w) => received.push(w)} />,
    );
    fireEvent.click(screen.getByText("Revenir à l'optimal"));
    expect(received[1]).toBeNull();
  });

  it("survit à une allocation régénérée avec MOINS de lignes (régression)", () => {
    // Bug d'origine : après édition des poids (état à 3 entrées), un re-rendu
    // avec 2 lignes croisait les anciens poids avec la nouvelle covariance 2×2
    // → cov[2] undefined → TypeError dans portfolioStats.
    const { rerender } = render(<MarkowitzChart lines={LINES} cov={COV} riskFree={0.02} />);
    fireEvent.change(screen.getByLabelText("Poids de Fonds Actions Monde"), { target: { value: "10" } });

    const fewer = LINES.slice(0, 2);
    const fewerCov = covarianceMatrix(
      fewer.map((l) => l.volatility),
      [
        [1, 0.2],
        [0.2, 1],
      ],
      0,
    );
    expect(() =>
      rerender(<MarkowitzChart lines={fewer} cov={fewerCov} riskFree={0.02} />),
    ).not.toThrow();
    // Les curseurs suivent la nouvelle allocation (2 supports).
    expect(screen.getAllByRole("slider").length).toBe(2);
  });
});
