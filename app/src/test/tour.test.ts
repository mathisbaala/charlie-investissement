import { describe, it, expect, beforeEach } from "vitest";
import { TOUR_STEPS, isTourDone, markTourDone, resetTour } from "@/lib/tour";

describe("tour content", () => {
  it("couvre les 5 onglets + le chat, dans l'ordre", () => {
    expect(TOUR_STEPS.map((s) => s.key)).toEqual([
      "accueil",
      "recherche",
      "portefeuille",
      "assureurs",
      "documents",
      "chat",
    ]);
  });

  it("chaque étape a un titre et un corps non vides", () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("le texte reste sobre : pas de tiret cadratin ni demi-cadratin", () => {
    for (const s of TOUR_STEPS) {
      expect(s.title).not.toMatch(/[—–]/);
      expect(s.body).not.toMatch(/[—–]/);
    }
  });
});

describe("tour storage", () => {
  beforeEach(() => {
    resetTour();
  });

  it("n'est pas terminé par défaut", () => {
    expect(isTourDone()).toBe(false);
  });

  it("devient terminé après markTourDone", () => {
    markTourDone();
    expect(isTourDone()).toBe(true);
  });

  it("redevient affichable après resetTour", () => {
    markTourDone();
    resetTour();
    expect(isTourDone()).toBe(false);
  });
});
