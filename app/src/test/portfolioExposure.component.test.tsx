import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortfolioExposure } from "@/components/portfolio/PortfolioExposure";

// Compositions par fonds renvoyées par /api/portfolio/exposure : AAA ventilé
// US/France + Technologie ; BBB n'a que sa géo (France), pas de secteurs.
const ROWS = {
  geo: [
    { isin: "AAA", key: "US", label: "États-Unis", weight: 0.6 },
    { isin: "AAA", key: "FR", label: "France", weight: 0.4 },
    { isin: "BBB", key: "FR", label: "France", weight: 1 },
  ],
  sectors: [
    { isin: "AAA", label: "Technologie", weight: 0.7 },
    { isin: "AAA", label: "Santé", weight: 0.3 },
  ],
};

describe("PortfolioExposure — camemberts géo / secteurs pondérés par les poids", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(ROWS) }),
    ));
  });
  afterEach(() => vi.unstubAllGlobals());

  const lines = [
    { isin: "AAA", weight: 50 },
    { isin: "BBB", weight: 50 },
  ];

  it("agrège la géo et les secteurs pondérés par les poids du portefeuille", async () => {
    render(<PortfolioExposure lines={lines} />);
    expect(await screen.findByText("Répartition géographique")).toBeTruthy();
    expect(screen.getByText("Répartition sectorielle")).toBeTruthy();
    // Géo : France = 50 % × 0,4 + 50 % × 1 = 70 % ; États-Unis = 30 %.
    // Secteurs : seul AAA contribue → normalisé sur lui : 70 % / 30 %.
    // → chaque valeur apparaît deux fois (légende géo + légende secteurs).
    expect(screen.getByText("France")).toBeTruthy();
    expect(screen.getByText("Technologie")).toBeTruthy();
    expect(screen.getByText("Santé")).toBeTruthy();
    expect(screen.getAllByText("70 %")).toHaveLength(2);
    expect(screen.getAllByText("30 %")).toHaveLength(2);
    // BBB (50 % du portefeuille) n'a pas de ventilation sectorielle → note.
    expect(screen.getByText(/Hors 50 % du portefeuille sans donnée/)).toBeTruthy();
  });

  it("recalcule les parts quand les poids changent (poids simulés)", async () => {
    const { rerender } = render(<PortfolioExposure lines={lines} />);
    await screen.findAllByText("70 %");
    // Le conseiller pousse AAA à 100 % : géo = ventilation propre d'AAA (60/40),
    // sans nouvel appel réseau (mêmes ISIN). Les secteurs (AAA seul) ne bougent
    // pas : « 70 % » ne subsiste que dans la légende sectorielle.
    rerender(<PortfolioExposure lines={[{ isin: "AAA", weight: 100 }, { isin: "BBB", weight: 0 }]} />);
    expect(await screen.findByText("60 %")).toBeTruthy();
    expect(screen.getByText("40 %")).toBeTruthy();
    expect(screen.getAllByText("70 %")).toHaveLength(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("ne rend rien quand aucun fonds n'a de composition en base", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ geo: [], sectors: [] }) }),
    ));
    const { container } = render(<PortfolioExposure lines={lines} />);
    await vi.waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("ne rend rien en cas d'erreur réseau (pas de carte cassée)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau"))));
    const { container } = render(<PortfolioExposure lines={lines} />);
    await vi.waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
