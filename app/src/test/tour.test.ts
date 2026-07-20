import { describe, it, expect, beforeEach } from "vitest";
import { TOUR_STEPS, isTourDone, markTourDone } from "@/lib/tour";

describe("tour content", () => {
  it("couvre les 4 piliers + cabinet + guide, dans l'ordre du rail", () => {
    expect(TOUR_STEPS.map((s) => s.key)).toEqual([
      "accueil",
      "assureurs",
      "portefeuille",
      "simulateur",
      "cabinet",
      "guide",
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
    localStorage.removeItem("charlie_tour_v7_done");
  });

  it("n'est pas terminé par défaut", () => {
    expect(isTourDone()).toBe(false);
  });

  it("devient terminé après markTourDone", () => {
    markTourDone();
    expect(isTourDone()).toBe(true);
  });
});
