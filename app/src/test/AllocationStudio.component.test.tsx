import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// AllocationStudio embarque ClientProfileForm, qui utilise useRouter → on le neutralise.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { AllocationStudio } from "@/components/portfolio/AllocationStudio";

describe("AllocationStudio", () => {
  beforeEach(() => {
    // Profil vierge → l'outil retombe sur « équilibré » par défaut.
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("affiche le formulaire de profil (partagé avec l'accueil) et les paramètres", () => {
    render(<AllocationStudio />);
    expect(screen.getByText("Profil du client")).toBeTruthy();
    expect(screen.getByText(/Partagé avec l'accueil/)).toBeTruthy();
    expect(screen.getByText("Paramètres de l'allocation")).toBeTruthy();
    expect(screen.getByText("Générer l'allocation")).toBeTruthy();
    // Pas de rapport tant qu'on n'a pas généré.
    expect(screen.queryByText("Allocation détaillée")).toBeNull();
  });

  it("génère l'allocation depuis le profil au clic", () => {
    render(<AllocationStudio />);
    fireEvent.click(screen.getByText("Générer l'allocation"));

    expect(screen.getByText("Contexte et objectifs")).toBeTruthy();
    expect(screen.getByText("Allocation détaillée")).toBeTruthy();
    expect(screen.getByText("Analyse et justification par support")).toBeTruthy();
    // Résumé du profil utilisé + boutons d'export.
    expect(screen.getByText(/Profil utilisé/)).toBeTruthy();
    expect(screen.getByText(/Télécharger \(PowerPoint\)/)).toBeTruthy();
    expect(screen.getByText(/Télécharger \(PDF\)/)).toBeTruthy();
  });

  it("réutilise le profil enregistré (stockage local) pour le résumé", () => {
    localStorage.setItem(
      "charlie_client_profile",
      JSON.stringify({ risk_profile: "dynamique", asset_classes: ["actions"], esg: "art8", max_ter: null, perte_max: null, envelopes: [], exclusions: [], geographies: [], insurers: [] }),
    );
    render(<AllocationStudio />);
    fireEvent.click(screen.getByText("Générer l'allocation"));
    expect(screen.getByText(/Profil utilisé — Profil Dynamique/)).toBeTruthy();
  });
});
