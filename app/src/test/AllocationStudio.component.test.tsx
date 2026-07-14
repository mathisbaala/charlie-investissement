import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

  it("affiche l'étape profil puis l'étape portefeuille (réglages conseiller)", () => {
    render(<AllocationStudio />);
    // Étape 1 — profil client (n'existe plus que dans Portefeuille).
    expect(screen.getByText("Profil du client")).toBeTruthy();
    expect(screen.getByText(/Enregistré automatiquement/)).toBeTruthy();
    // Étape 2 — portefeuille : réglages du conseiller + génération.
    expect(screen.getByText(/Réglages du conseiller/)).toBeTruthy();
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

  it("affiche la matrice de corrélation, la colonne Notation et les liens vers les fiches", () => {
    render(<AllocationStudio />);
    fireEvent.click(screen.getByText("Générer l'allocation"));

    expect(screen.getByText("Corrélation des supports retenus")).toBeTruthy();
    expect(screen.getByText("Notation")).toBeTruthy();
    expect(screen.getByText("Frais")).toBeTruthy();
    // Chaque ligne du tableau pointe vers la fiche du fonds.
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/fonds/"));
    expect(links.length).toBeGreaterThanOrEqual(4);
  });

  it("retire un fonds de l'allocation, propose un similaire et recalcule sans lui", async () => {
    render(<AllocationStudio />);
    fireEvent.click(screen.getByText("Générer l'allocation"));

    const firstRemove = screen.getAllByLabelText(/^Retirer /)[0];
    const label = firstRemove.getAttribute("aria-label")!; // « Retirer NOM de l'allocation »
    fireEvent.click(firstRemove);

    // Bandeau de retrait + suggestion de remplacement similaire.
    expect(screen.getByText(/retiré de l'allocation/)).toBeTruthy();
    expect(screen.getByText(/Fonds écartés/)).toBeTruthy();

    // Après le recalcul automatique (débouncé), le fonds a quitté le tableau.
    await waitFor(() => {
      expect(screen.queryByLabelText(label)).toBeNull();
    }, { timeout: 2000 });
  });

  it("le retrait est annulable : le fonds réintègre l'univers", async () => {
    render(<AllocationStudio />);
    fireEvent.click(screen.getByText("Générer l'allocation"));

    const firstRemove = screen.getAllByLabelText(/^Retirer /)[0];
    const label = firstRemove.getAttribute("aria-label")!;
    fireEvent.click(firstRemove);
    fireEvent.click(screen.getByText("Annuler le retrait"));

    await waitFor(() => {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }, { timeout: 2000 });
    expect(screen.queryByText(/Fonds écartés/)).toBeNull();
  });

  it("baisser le plafond SRI relance le calcul (filtre trop strict → note d'assouplissement)", async () => {
    render(<AllocationStudio />);
    fireEvent.click(screen.getByText("Générer l'allocation"));

    fireEvent.change(screen.getByLabelText("Plafond SRI par fonds"), { target: { value: "2" } });

    await waitFor(() => {
      expect(screen.getByText(/trop restrictifs sur l'univers d'exemple/)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it("impose un fonds choisi dans l'univers d'exemple (mode démo)", async () => {
    render(<AllocationStudio />);
    fireEvent.click(screen.getByText("Générer l'allocation"));

    const select = screen.getByLabelText("Imposer un fonds (univers d'exemple)") as HTMLSelectElement;
    const isin = (select.querySelectorAll("option")[1] as HTMLOptionElement).value;
    expect(isin).toBeTruthy();
    fireEvent.change(select, { target: { value: isin } });

    // Le fonds imposé finit dans le tableau après recalcul (ligne avec son ISIN).
    await waitFor(() => {
      expect(screen.getByText(isin)).toBeTruthy();
    }, { timeout: 2000 });
  });
});
