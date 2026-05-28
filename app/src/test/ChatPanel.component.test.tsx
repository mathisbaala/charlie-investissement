import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatPanel } from "@/components/chrome/ChatPanel";

// Regression: ISSUE-003 — blank placeholder left visible on stream error
describe("ChatPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("affiche le message de bienvenue quand vide", () => {
    render(<ChatPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("Bonjour.")).toBeTruthy();
  });

  it("affiche une seule erreur (pas de placeholder vide) quand l'API renvoie 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, body: null }),
    );

    render(<ChatPanel open={true} onClose={() => {}} />);

    const input = screen.getByPlaceholderText("Écrire à Charlie…");
    fireEvent.change(input, { target: { value: "Bonjour" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(
        screen.getByText("Une erreur s'est produite. Réessayez."),
      ).toBeTruthy(),
    );

    // Un seul message d'erreur, pas de doublon
    expect(
      screen.getAllByText("Une erreur s'est produite. Réessayez."),
    ).toHaveLength(1);
  });

  it("n'affiche rien si le panneau est fermé", () => {
    const { container } = render(<ChatPanel open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
