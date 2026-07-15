import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CabinetForm } from "@/components/cabinet/CabinetForm";

// Référencement minimal renvoyé par /api/screener/contracts.
const CONTRACTS = [
  { company: "Cardif Lux Vie", key: "Cardif Lux Vie::Cardif Elite Lux", contract: "Cardif Elite Lux", funds: 338 },
  { company: "Cardif Lux Vie", key: "Cardif Lux Vie::Cardif Essentiel", contract: "Cardif Essentiel", funds: 210 },
];

describe("CabinetForm — ajout des contrats à la recherche", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ data: CONTRACTS }) }),
    ));
  });
  afterEach(() => vi.unstubAllGlobals());

  async function addCardif() {
    render(<CabinetForm />);
    const search = screen.getByLabelText("Rechercher un assureur partenaire");
    fireEvent.change(search, { target: { value: "cardif" } });
    fireEvent.click(await screen.findByText("Cardif Lux Vie"));
  }

  /** Ouvre la recherche de contrats de l'assureur et ajoute `name`. */
  async function addContract(name: string) {
    const search = await screen.findByLabelText("Rechercher un contrat Cardif Lux Vie");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: name } });
    fireEvent.click(await screen.findByText(name));
  }

  it("sélectionner un assureur ouvre une recherche de contrats, sans rattacher tout le catalogue", async () => {
    await addCardif();
    expect(await screen.findByLabelText("Rechercher un contrat Cardif Lux Vie")).toBeTruthy();
    // Aucun champ de frais tant qu'aucun contrat n'est ajouté.
    expect(screen.queryByLabelText("Rétrocession UC : Cardif Elite Lux")).toBeNull();
    // Le résumé annonce le catalogue disponible.
    expect(await screen.findByText(/2 contrats référencés/)).toBeTruthy();
  });

  it("rechercher puis cliquer un contrat l'ajoute avec ses champs de frais", async () => {
    await addCardif();
    await addContract("Cardif Elite Lux");
    expect(screen.getByLabelText("Rétrocession UC : Cardif Elite Lux")).toBeTruthy();
    expect(screen.getByLabelText("Frais d'entrée reversés : Cardif Elite Lux")).toBeTruthy();
    // L'autre contrat n'est pas rattaché pour autant.
    expect(screen.queryByLabelText("Rétrocession UC : Cardif Essentiel")).toBeNull();
    expect(screen.getByText(/1 contrat ajouté/)).toBeTruthy();
  });

  it("un contrat ajouté disparaît des suggestions ; la croix le retire", async () => {
    await addCardif();
    await addContract("Cardif Elite Lux");
    // Le menu reste ouvert pour enchaîner : seul l'autre contrat est encore proposé.
    const search = screen.getByLabelText("Rechercher un contrat Cardif Lux Vie");
    fireEvent.focus(search);
    expect(screen.getByText("Cardif Essentiel")).toBeTruthy();
    expect(screen.getAllByText("Cardif Elite Lux")).toHaveLength(1); // uniquement le bloc de frais

    fireEvent.click(screen.getByLabelText("Retirer le contrat Cardif Elite Lux"));
    expect(screen.queryByLabelText("Rétrocession UC : Cardif Elite Lux")).toBeNull();
  });

  it("le chevron replie l'assureur à son seul nom, puis le rouvre", async () => {
    await addCardif();
    await addContract("Cardif Elite Lux");

    fireEvent.click(screen.getByLabelText("Replier Cardif Lux Vie"));
    expect(screen.queryByText("Cardif Elite Lux")).toBeNull();
    expect(screen.getByText(/1 contrat ajouté/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Déplier Cardif Lux Vie"));
    expect(screen.getByText("Cardif Elite Lux")).toBeTruthy();
  });

  it("un cabinet d'avant v2 ne garde que les conventions renseignées (purge des vierges auto-rattachées)", async () => {
    // Ancien format (sans version) : tout le catalogue rattaché d'office,
    // une seule convention réellement saisie.
    localStorage.setItem(
      "charlie_cabinet_settings",
      JSON.stringify({
        cabinetName: "",
        insurers: ["Cardif Lux Vie"],
        contracts: [
          { key: "Cardif Lux Vie::Cardif Elite Lux", contractFeeShare: null, ucRetroShare: 0.5, fundOverrides: [] },
          { key: "Cardif Lux Vie::Cardif Essentiel", contractFeeShare: null, ucRetroShare: null, fundOverrides: [] },
        ],
      }),
    );
    render(<CabinetForm />);
    // Replié par défaut au chargement → résumé : un seul contrat conservé.
    await waitFor(() => {
      expect(screen.getByText(/1 contrat ajouté · 1 convention renseignée/)).toBeTruthy();
    });
    // La convention saisie n'a pas été écrasée (dépliage → champ rempli).
    fireEvent.click(screen.getByLabelText("Déplier Cardif Lux Vie"));
    const uc = screen.getByLabelText("Rétrocession UC : Cardif Elite Lux") as HTMLInputElement;
    expect(uc.value).toBe("50");
    // Le contrat vierge auto-rattaché a été purgé.
    expect(screen.queryByLabelText("Rétrocession UC : Cardif Essentiel")).toBeNull();
  });
});
