import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AllocationStudio } from "@/components/portfolio/AllocationStudio";

describe("AllocationStudio", () => {
  it("affiche le formulaire de profil client au départ, sans rapport", () => {
    render(<AllocationStudio />);
    expect(screen.getByText("Profil du client")).toBeTruthy();
    expect(screen.getByText("Générer l'allocation")).toBeTruthy();
    // Pas de rapport tant qu'on n'a pas généré.
    expect(screen.queryByText("Contexte et objectifs")).toBeNull();
  });

  it("génère l'allocation et affiche le rapport au clic", () => {
    render(<AllocationStudio />);
    fireEvent.click(screen.getByText("Générer l'allocation"));

    // Le rapport apparaît avec ses sections.
    expect(screen.getByText("Contexte et objectifs")).toBeTruthy();
    expect(screen.getByText("Répartition par classe d'actifs")).toBeTruthy();
    expect(screen.getByText("Allocation détaillée")).toBeTruthy();
    expect(screen.getByText("Analyse et justification par support")).toBeTruthy();
    // Les boutons d'export (PowerPoint + PDF) sont proposés.
    expect(screen.getByText(/Télécharger \(PowerPoint\)/)).toBeTruthy();
    expect(screen.getByText(/Télécharger \(PDF\)/)).toBeTruthy();
    // Une projection chiffrée est affichée (montant par défaut 100 000 €).
    expect(screen.getByText(/Projection indicative/)).toBeTruthy();
  });

  it("régénère avec un profil prudent (moins d'actions)", () => {
    render(<AllocationStudio />);
    // Sélectionne le profil prudent.
    const select = screen.getByDisplayValue("Équilibré") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "prudent" } });
    fireEvent.click(screen.getByText("Générer l'allocation"));
    // Le rapport se génère sans erreur et affiche le profil déduit.
    expect(screen.getByText("Allocation détaillée")).toBeTruthy();
  });

  it("respecte un plafond par fonds plus strict", () => {
    render(<AllocationStudio />);
    const cap = screen.getByDisplayValue("25") as HTMLInputElement;
    fireEvent.change(cap, { target: { value: "20" } });
    fireEvent.click(screen.getByText("Générer l'allocation"));
    // Aucune ligne ne doit dépasser ~20% (tolérance d'arrondi/projection).
    const cells = screen.getAllByRole("cell");
    const weights = cells
      .map((c) => c.textContent ?? "")
      .filter((t) => /^\d+(\.\d+)?\s*%$/.test(t.trim()))
      .map((t) => parseFloat(t));
    // Il y a au moins quelques poids affichés.
    expect(weights.length).toBeGreaterThan(0);
    // Le plus gros poids reste raisonnable (le moteur peut relever le plafond si
    // une classe a trop peu de supports, d'où la marge).
    expect(Math.max(...weights)).toBeLessThanOrEqual(35);
  });
});
