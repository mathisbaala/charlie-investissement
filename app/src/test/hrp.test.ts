import { describe, it, expect } from "vitest";
import { hrpWeights, seriation } from "../lib/hrp";
import { covarianceMatrix } from "../lib/correlation";

describe("seriation", () => {
  it("gère les cas dégénérés", () => {
    expect(seriation([])).toEqual([]);
    expect(seriation([[0]])).toEqual([0]);
  });

  it("rend adjacents les actifs fortement corrélés", () => {
    // 0 et 2 quasi identiques (distance faible), 1 indépendant.
    const d = (rho: number) => Math.sqrt((1 - rho) / 2);
    const dist = [
      [0, d(0), d(0.95)],
      [d(0), 0, d(0)],
      [d(0.95), d(0), 0],
    ];
    const order = seriation(dist);
    const i0 = order.indexOf(0);
    const i2 = order.indexOf(2);
    expect(Math.abs(i0 - i2)).toBe(1);
  });
});

describe("hrpWeights", () => {
  it("gère les cas dégénérés", () => {
    expect(hrpWeights([], [])).toEqual([]);
    expect(hrpWeights([[0.04]], [[1]])).toEqual([1]);
  });

  it("pondère deux actifs indépendants en inverse de leur variance", () => {
    const corr = [
      [1, 0],
      [0, 1],
    ];
    const cov = covarianceMatrix([0.1, 0.2], corr, 0);
    const w = hrpWeights(cov, corr);
    // vol 10 % vs 20 % → variances 0.01 vs 0.04 → poids 80/20.
    expect(w[0]).toBeCloseTo(0.8, 9);
    expect(w[1]).toBeCloseTo(0.2, 9);
  });

  it("donne un partage égal à deux actifs identiques", () => {
    const corr = [
      [1, 0],
      [0, 1],
    ];
    const cov = covarianceMatrix([0.15, 0.15], corr, 0);
    const w = hrpWeights(cov, corr);
    expect(w[0]).toBeCloseTo(0.5, 9);
    expect(w[1]).toBeCloseTo(0.5, 9);
  });

  it("pénalise la famille de fonds redondants au profit des diversifiants", () => {
    // A et B quasi identiques (ρ = 0,95), C et D indépendants de tout.
    // Même volatilité partout : seul l'effet de structure joue.
    const corr = [
      [1, 0.95, 0, 0],
      [0.95, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const cov = covarianceMatrix([0.15, 0.15, 0.15, 0.15], corr, 0);
    const w = hrpWeights(cov, corr);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    // La paire redondante (A, B) partage UN budget de risque → chacun reçoit
    // moins que les fonds réellement diversifiants.
    expect(w[2]).toBeGreaterThan(w[0]);
    expect(w[3]).toBeGreaterThan(w[1]);
  });

  it("est déterministe et somme à 1", () => {
    const corr = [
      [1, 0.3, 0.6],
      [0.3, 1, 0.1],
      [0.6, 0.1, 1],
    ];
    const cov = covarianceMatrix([0.12, 0.05, 0.2], corr, 0);
    const a = hrpWeights(cov, corr);
    const b = hrpWeights(cov, corr);
    expect(a).toEqual(b);
    expect(a.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    for (const x of a) expect(x).toBeGreaterThan(0);
  });
});
