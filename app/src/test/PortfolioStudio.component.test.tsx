import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// L'atelier utilise useRouter (ClientProfileForm, navigation vers la page dédiée,
// garde de redirection de la vue résultat) → on le neutralise.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { PortfolioStudioProvider } from "@/components/portfolio/PortfolioStudioContext";
import { StudioInputs } from "@/components/portfolio/StudioInputs";
import { StudioResults } from "@/components/portfolio/StudioResults";

// Les deux vues partagent le contexte du layout ; les monter ensemble reproduit
// le parcours complet (réglages → portefeuille dédié) sans navigation réelle :
// « Générer le portefeuille » remplit le contexte et la vue résultat s'affiche.
function renderStudio() {
  return render(
    <PortfolioStudioProvider>
      <StudioInputs />
      <StudioResults />
    </PortfolioStudioProvider>,
  );
}

describe("PortfolioStudio", () => {
  beforeEach(() => {
    // Profil vierge → l'outil retombe sur « équilibré » par défaut.
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("affiche l'étape profil puis l'étape portefeuille (réglages conseiller)", () => {
    renderStudio();
    // Étape 1 — profil client (n'existe plus que dans Portefeuille).
    expect(screen.getByText("Profil du client")).toBeTruthy();
    // Étape 2 — portefeuille : réglages du conseiller + génération.
    expect(screen.getByText("Portefeuille")).toBeTruthy();
    expect(screen.getByText("Générer le portefeuille")).toBeTruthy();
    // Pas de rapport tant qu'on n'a pas généré (la vue résultat reste vide).
    expect(screen.queryByText("Portefeuille détaillé")).toBeNull();
  });

  it("replie les réglages avancés (moteur/rétrocessions) par défaut, dévoilés au clic", () => {
    renderStudio();
    // Repliés au départ : ni le moteur ni le départage rétrocessions ne sont montés.
    expect(screen.queryByText("Max-Sharpe")).toBeNull();
    expect(screen.queryByText(/Départage rémunération cabinet/)).toBeNull();
    // Le bouton de repli est bien présent et fermé.
    const toggle = screen.getByText("Réglages avancés");
    expect(toggle).toBeTruthy();
    // Au clic, les réglages avancés apparaissent.
    fireEvent.click(toggle);
    expect(screen.getByText("Max-Sharpe")).toBeTruthy();
    expect(screen.getByText("HRP")).toBeTruthy();
    expect(screen.getByText(/Départage rémunération cabinet/)).toBeTruthy();
  });

  it("génère le portefeuille depuis le profil au clic", async () => {
    renderStudio();
    fireEvent.click(screen.getByText("Générer le portefeuille"));

    expect(await screen.findByText("Portefeuille détaillé")).toBeTruthy();
    expect(screen.getByText("Contexte et objectifs")).toBeTruthy();
    expect(screen.getByText("Analyse et justification par support")).toBeTruthy();
    // Résumé du profil utilisé + boutons d'export.
    expect(screen.getByText(/Profil utilisé/)).toBeTruthy();
    expect(screen.getByText(/Télécharger \(PowerPoint\)/)).toBeTruthy();
    expect(screen.getByText(/Télécharger \(PDF\)/)).toBeTruthy();
  });

  it("réutilise le profil enregistré (stockage local) pour le résumé", async () => {
    localStorage.setItem(
      "charlie_client_profile",
      JSON.stringify({ risk_profile: "dynamique", asset_classes: ["actions"], esg: "art8", max_ter: null, perte_max: null, envelopes: [], exclusions: [], geographies: [], insurers: [] }),
    );
    renderStudio();
    fireEvent.click(screen.getByText("Générer le portefeuille"));
    expect(await screen.findByText(/Profil utilisé : Profil Dynamique/)).toBeTruthy();
  });

  it("affiche la matrice de corrélation, la colonne Notation et les liens vers les fiches", async () => {
    renderStudio();
    fireEvent.click(screen.getByText("Générer le portefeuille"));

    expect(await screen.findByText("Corrélation des supports retenus")).toBeTruthy();
    expect(screen.getByText("Notation")).toBeTruthy();
    expect(screen.getByText("Frais")).toBeTruthy();
    // Chaque ligne du tableau pointe vers la fiche du fonds.
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/fonds/"));
    expect(links.length).toBeGreaterThanOrEqual(4);
  });

  it("retire un fonds du portefeuille, propose un similaire et recalcule sans lui", async () => {
    renderStudio();
    fireEvent.click(screen.getByText("Générer le portefeuille"));
    await screen.findByText("Portefeuille détaillé");

    const firstRemove = screen.getAllByLabelText(/^Retirer /)[0];
    const label = firstRemove.getAttribute("aria-label")!; // « Retirer NOM du portefeuille »
    fireEvent.click(firstRemove);

    // Bandeau de retrait + suggestion de remplacement similaire.
    expect(screen.getByText(/retiré du portefeuille/)).toBeTruthy();
    expect(screen.getByText(/Fonds écartés/)).toBeTruthy();

    // Après le recalcul automatique (débouncé), le fonds a quitté le tableau.
    await waitFor(() => {
      expect(screen.queryByLabelText(label)).toBeNull();
    }, { timeout: 2000 });
  });

  it("le retrait est annulable : le fonds réintègre l'univers", async () => {
    renderStudio();
    fireEvent.click(screen.getByText("Générer le portefeuille"));
    await screen.findByText("Portefeuille détaillé");

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
    renderStudio();
    fireEvent.click(screen.getByText("Générer le portefeuille"));
    await screen.findByText("Portefeuille détaillé");

    fireEvent.change(screen.getByLabelText("Plafond SRI par fonds"), { target: { value: "2" } });

    await waitFor(() => {
      expect(screen.getByText(/trop restrictifs sur l'univers d'exemple/)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it("impose un fonds choisi dans l'univers d'exemple (mode démo)", async () => {
    renderStudio();
    fireEvent.click(screen.getByText("Générer le portefeuille"));
    await screen.findByText("Portefeuille détaillé");

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
