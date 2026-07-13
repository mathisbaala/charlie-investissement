import { describe, it, expect } from "vitest";
import { projectToSimplex, efficientFrontier } from "@/lib/frontier";
import { covarianceMatrix } from "@/lib/correlation";
import { maximizeSharpe, portfolioStats } from "@/lib/optimizer";

// Univers jouet à 2 actifs non corrélés : le portefeuille de variance minimale
// a une solution analytique w₁ = σ₂² / (σ₁² + σ₂²).
const MU2 = [0.03, 0.08];
const VOLS2 = [0.05, 0.2];
const COV2 = covarianceMatrix(VOLS2, [
  [1, 0],
  [0, 1],
], 0);

describe("projectToSimplex", () => {
  it("renvoie un point du simplexe (positif, somme 1)", () => {
    const w = projectToSimplex([0.9, -0.4, 0.8]);
    expect(w.every((x) => x >= 0)).toBe(true);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
  });

  it("laisse inchangé un point déjà sur le simplexe", () => {
    const w = projectToSimplex([0.25, 0.5, 0.25]);
    expect(w[0]).toBeCloseTo(0.25, 9);
    expect(w[1]).toBeCloseTo(0.5, 9);
    expect(w[2]).toBeCloseTo(0.25, 9);
  });

  it("projette un vecteur dégénéré (tous négatifs) sans NaN", () => {
    const w = projectToSimplex([-1, -2]);
    expect(w.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
  });

  it("gère le vecteur vide", () => {
    expect(projectToSimplex([])).toEqual([]);
  });
});

describe("efficientFrontier", () => {
  it("est vide sans actif et réduite à un point pour 1 actif", () => {
    expect(efficientFrontier([], [])).toEqual([]);
    const single = efficientFrontier([0.05], [[0.04]]);
    expect(single).toHaveLength(1);
    expect(single[0].ret).toBeCloseTo(0.05, 9);
    expect(single[0].vol).toBeCloseTo(0.2, 9);
  });

  it("est déterministe (mêmes entrées → même sortie)", () => {
    const a = efficientFrontier(MU2, COV2);
    const b = efficientFrontier(MU2, COV2);
    expect(a).toEqual(b);
  });

  it("retrouve le portefeuille de variance minimale analytique (2 actifs)", () => {
    const front = efficientFrontier(MU2, COV2);
    // w₁* = σ₂²/(σ₁²+σ₂²) = 0.04/0.0425 ; vol* = √(w₁²σ₁² + w₂²σ₂²)
    const w1 = (0.2 * 0.2) / (0.05 * 0.05 + 0.2 * 0.2);
    const volMin = Math.sqrt(w1 * w1 * 0.05 * 0.05 + (1 - w1) * (1 - w1) * 0.2 * 0.2);
    expect(front[0].vol).toBeCloseTo(volMin, 3);
  });

  it("est croissante en rendement ET en volatilité (branche efficiente)", () => {
    const front = efficientFrontier(MU2, COV2);
    expect(front.length).toBeGreaterThan(3);
    for (let i = 1; i < front.length; i++) {
      expect(front[i].ret).toBeGreaterThan(front[i - 1].ret);
      expect(front[i].vol).toBeGreaterThan(front[i - 1].vol);
    }
  });

  it("se termine au coin 100 % actif de meilleur rendement", () => {
    const front = efficientFrontier(MU2, COV2);
    const last = front[front.length - 1];
    expect(last.ret).toBeCloseTo(0.08, 6);
    expect(last.vol).toBeCloseTo(0.2, 6);
  });

  it("domine (à tolérance près) le portefeuille max-Sharpe du moteur", () => {
    // Univers 4 actifs corrélés : le point max-Sharpe doit être sur/près de la
    // frontière — aucun point de la frontière à volatilité ≤ ne doit le battre
    // largement, et il ne doit pas la dépasser.
    const mu = [0.02, 0.045, 0.07, 0.1];
    const vols = [0.02, 0.07, 0.13, 0.22];
    const corr = [
      [1, 0.2, 0.1, 0.0],
      [0.2, 1, 0.5, 0.3],
      [0.1, 0.5, 1, 0.6],
      [0.0, 0.3, 0.6, 1],
    ];
    const cov = covarianceMatrix(vols, corr, 0);
    const front = efficientFrontier(mu, cov);

    const groups = [[0, 1, 2, 3]];
    const w = maximizeSharpe(mu, cov, groups, [1], 1, 0.02);
    const p = portfolioStats(w, mu, cov, 0.02);

    // Le portefeuille ne passe pas AU-DESSUS de la frontière : tout point de
    // frontière de volatilité ≥ la sienne doit offrir un rendement ≥ (− ε).
    for (const f of front) {
      if (f.vol >= p.vol - 1e-9) {
        expect(f.ret).toBeGreaterThanOrEqual(p.ret - 5e-4);
      }
    }
    // Et la frontière le contient presque : le meilleur Sharpe de la frontière
    // (au même taux sans risque) n'est pas loin du sien.
    const bestFrontSharpe = Math.max(
      ...front.map((f) => (f.vol > 1e-9 ? (f.ret - 0.02) / f.vol : 0)),
    );
    expect(bestFrontSharpe).toBeGreaterThanOrEqual(p.sharpe - 5e-3);
  });
});
