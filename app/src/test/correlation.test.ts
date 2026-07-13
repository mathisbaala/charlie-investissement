import { describe, it, expect } from "vitest";
import {
  pearson,
  navToReturns,
  correlationMatrix,
  covarianceMatrix,
  averagePairwiseCorrelation,
  classCorrelation,
  missingPairCount,
} from "../lib/correlation";

describe("pearson", () => {
  it("renvoie 1 pour deux séries parfaitement corrélées (positivement)", () => {
    const r = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(1, 10);
  });

  it("renvoie -1 pour deux séries parfaitement anti-corrélées", () => {
    const r = pearson([1, 2, 3, 4], [4, 3, 2, 1]);
    expect(r!).toBeCloseTo(-1, 10);
  });

  it("renvoie ~0 pour des séries orthogonales", () => {
    const r = pearson([1, -1, 1, -1], [1, 1, -1, -1]);
    expect(r!).toBeCloseTo(0, 10);
  });

  it("renvoie null si les longueurs diffèrent", () => {
    expect(pearson([1, 2, 3], [1, 2])).toBeNull();
  });

  it("renvoie null avec moins de 2 points", () => {
    expect(pearson([1], [2])).toBeNull();
    expect(pearson([], [])).toBeNull();
  });

  it("renvoie null si une série est constante (variance nulle)", () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });

  it("borne le résultat dans [-1, 1] malgré les arrondis flottants", () => {
    const a = [0.01, 0.02, 0.03, 0.04, 0.05];
    const b = a.map((x) => x * 3);
    const r = pearson(a, b)!;
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(-1);
  });
});

describe("navToReturns", () => {
  it("convertit N VL en N-1 rendements simples", () => {
    const r = navToReturns([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });

  it("ignore les pas où la VL précédente est nulle (pas de division par 0)", () => {
    const r = navToReturns([0, 100, 110]);
    // 0→100 ignoré, 100→110 gardé
    expect(r).toHaveLength(1);
    expect(r[0]).toBeCloseTo(0.1, 10);
  });

  it("renvoie une liste vide pour moins de 2 VL", () => {
    expect(navToReturns([100])).toEqual([]);
    expect(navToReturns([])).toEqual([]);
  });
});

describe("correlationMatrix", () => {
  it("produit une matrice symétrique à diagonale 1", () => {
    const m = correlationMatrix([
      [1, 2, 3, 4],
      [2, 4, 6, 8],
      [4, 3, 2, 1],
    ]);
    expect(m[0][0]).toBe(1);
    expect(m[1][1]).toBe(1);
    expect(m[0][1]).toBeCloseTo(1, 10); // séries colinéaires
    expect(m[0][2]).toBeCloseTo(-1, 10); // anti-corrélées
    // symétrie
    expect(m[0][1]).toBe(m[1][0]);
    expect(m[0][2]).toBe(m[2][0]);
  });

  it("met null quand une paire n'est pas calculable", () => {
    const m = correlationMatrix([
      [1, 1, 1, 1], // constante
      [1, 2, 3, 4],
    ]);
    expect(m[0][1]).toBeNull();
    expect(m[1][0]).toBeNull();
    expect(m[0][0]).toBe(1);
  });
});

describe("covarianceMatrix", () => {
  it("reconstruit Σ_ij = σ_i·σ_j·ρ_ij avec diagonale = σ²", () => {
    const vols = [0.1, 0.2];
    const corr = [
      [1, 0.5],
      [0.5, 1],
    ];
    const cov = covarianceMatrix(vols, corr);
    expect(cov[0][0]).toBeCloseTo(0.01, 12);
    expect(cov[1][1]).toBeCloseTo(0.04, 12);
    expect(cov[0][1]).toBeCloseTo(0.1 * 0.2 * 0.5, 12);
    expect(cov[0][1]).toBe(cov[1][0]);
  });

  it("utilise fallbackCorr quand ρ est null hors diagonale", () => {
    const cov = covarianceMatrix(
      [0.1, 0.2],
      [
        [1, null],
        [null, 1],
      ],
      0,
    );
    expect(cov[0][1]).toBe(0); // indépendance supposée
  });

  it("lève une erreur si vols et corr sont incohérents", () => {
    expect(() => covarianceMatrix([0.1, 0.2], [[1]])).toThrow();
  });

  it("accepte un fallback par paire (fonction) pour les ρ null", () => {
    const cov = covarianceMatrix(
      [0.1, 0.2, 0.3],
      [
        [1, null, 0.5],
        [null, 1, null],
        [0.5, null, 1],
      ],
      (i, j) => (i === 0 && j === 1 ? 0.75 : 0.2),
    );
    expect(cov[0][1]).toBeCloseTo(0.1 * 0.2 * 0.75, 12); // fallback (0,1)
    expect(cov[1][2]).toBeCloseTo(0.2 * 0.3 * 0.2, 12); // fallback (1,2)
    expect(cov[0][2]).toBeCloseTo(0.1 * 0.3 * 0.5, 12); // ρ observé, pas de fallback
  });
});

describe("classCorrelation", () => {
  it("est symétrique", () => {
    expect(classCorrelation("actions", "obligations")).toBe(
      classCorrelation("obligations", "actions"),
    );
    expect(classCorrelation("crypto", "immobilier")).toBe(
      classCorrelation("immobilier", "crypto"),
    );
  });

  it("reste dans [0, 1] et ordonne raisonnablement les priors", () => {
    const classes = [
      "actions",
      "obligations",
      "monetaire",
      "diversifie",
      "immobilier",
      "alternatif",
      "crypto",
      "fonds_euros",
    ];
    for (const a of classes) {
      for (const b of classes) {
        const c = classCorrelation(a, b);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    // Deux fonds actions se ressemblent bien plus qu'un fonds actions et un
    // fonds euros — sinon le prior pousserait à de fausses diversifications.
    expect(classCorrelation("actions", "actions")).toBeGreaterThan(
      classCorrelation("actions", "fonds_euros"),
    );
    expect(classCorrelation("actions", "actions")).toBeGreaterThan(
      classCorrelation("actions", "obligations"),
    );
  });

  it("applique un prior neutre pour une classe inconnue", () => {
    expect(classCorrelation("actions", "martienne")).toBeCloseTo(0.3, 12);
  });
});

describe("missingPairCount", () => {
  it("compte les paires distinctes null (hors diagonale)", () => {
    expect(
      missingPairCount([
        [1, null, 0.5],
        [null, 1, null],
        [0.5, null, 1],
      ]),
    ).toBe(2);
  });

  it("renvoie 0 quand la matrice est complète", () => {
    expect(
      missingPairCount([
        [1, 0.2],
        [0.2, 1],
      ]),
    ).toBe(0);
  });
});

describe("averagePairwiseCorrelation", () => {
  it("moyenne les paires distinctes calculées", () => {
    const avg = averagePairwiseCorrelation([
      [1, 0.2, 0.4],
      [0.2, 1, 0.6],
      [0.4, 0.6, 1],
    ]);
    expect(avg!).toBeCloseTo((0.2 + 0.4 + 0.6) / 3, 12);
  });

  it("ignore les paires null et renvoie null si aucune paire exploitable", () => {
    expect(
      averagePairwiseCorrelation([
        [1, null],
        [null, 1],
      ]),
    ).toBeNull();
  });
});
