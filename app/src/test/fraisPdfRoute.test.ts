import { describe, it, expect } from "vitest";
import { parseInput } from "@/app/api/frais/pdf/route";

// Régression : le PDF de frais (client DDA + cabinet) est généré côté serveur à
// partir de `parseInput(body.input)`. `eurosRetroShare` avait été OUBLIÉ de ce
// parsing → le document sortait avec une rétro fonds euros de 0, sous-estimant la
// rémunération du cabinet et divergeant de l'écran (qui, lui, l'envoie). Ce test
// verrouille que TOUS les paramètres de rémunération survivent au parsing.
describe("parseInput (route /api/frais/pdf)", () => {
  it("préserve eurosRetroShare (régression : le PDF ne doit pas l'ignorer)", () => {
    const parsed = parseInput({ eurosRetroShare: 0.1 });
    expect(parsed.eurosRetroShare).toBe(0.1);
  });

  it("préserve toute la brique de rémunération cabinet", () => {
    const parsed = parseInput({
      retroCgp: 0.9, commissionCabinet: 2, contractFeeShare: 0.3,
      eurosRetroShare: 0.15, honoraireForfait: 500, honoraireAnnuelPct: 0.2,
    });
    expect(parsed.retroCgp).toBe(0.9);
    expect(parsed.commissionCabinet).toBe(2);
    expect(parsed.contractFeeShare).toBe(0.3);
    expect(parsed.eurosRetroShare).toBe(0.15);
    expect(parsed.honoraireForfait).toBe(500);
    expect(parsed.honoraireAnnuelPct).toBe(0.2);
  });

  it("valeurs absentes/invalides → 0 (jamais NaN)", () => {
    const parsed = parseInput({});
    expect(parsed.eurosRetroShare).toBe(0);
    expect(Number.isNaN(parsed.eurosRetroShare)).toBe(false);
  });
});
