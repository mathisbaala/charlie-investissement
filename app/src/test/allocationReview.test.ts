import { describe, it, expect } from "vitest";
import {
  buildReviewPayload,
  sanitizeReview,
  reviewCostUsd,
  type ReviewClientContext,
} from "@/lib/allocationReview";
import type { AllocationResult } from "@/lib/optimizer";

// Fonctions PURES du module de vérification IA (le call LLM n'est pas testé ici).

const ALLOCATION: AllocationResult = {
  lines: [
    { isin: "LU1", name: "Fonds Actions Monde", assetClass: "actions", category: "Actions Monde", weight: 50, sri: 4, sfdr: 8, expectedReturn: 0.07, volatility: 0.15, region: "world" },
    { isin: "FR2", name: "Fonds Oblig Euro", assetClass: "obligations", category: "Obligations Euro", weight: 30, sri: 2, sfdr: 8, expectedReturn: 0.03, volatility: 0.05, region: "eurozone" },
    { isin: "FR3", name: "Fonds Monétaire", assetClass: "monetaire", category: "Monétaire", weight: 20, sri: 1, sfdr: 6, expectedReturn: 0.02, volatility: 0.01, region: null },
  ],
  method: "sharpe",
  expectedReturn: 0.048,
  volatility: 0.085,
  sharpe: 0.33,
  weightedSri: 3.0,
  classWeights: { actions: 50, obligations: 30, monetaire: 20 },
  diversification: { effectiveHoldings: 2.6, averageCorrelation: 0.3, assetClasses: 3 },
  notes: [],
};

const CLIENT: ReviewClientContext = {
  age: 30,
  horizonYears: 20,
  objectif: "retraite",
  riskProfile: "dynamique",
  perteMax: "20",
  incomeNeed: null,
  esg: "art8",
  geographies: ["monde"],
  exclusions: ["armes", "fossiles"],
};

const ISINS = ALLOCATION.lines.map((l) => l.isin);

describe("reviewCostUsd", () => {
  it("applique les tarifs Z.AI GLM 5.2 : $1,40/M entrée et $4,40/M sortie", () => {
    expect(reviewCostUsd({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(1.4, 10);
    expect(reviewCostUsd({ input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(4.4, 10);
    expect(reviewCostUsd({ input_tokens: 4000, output_tokens: 800 })).toBeCloseTo(0.00912, 6);
  });
});

describe("buildReviewPayload", () => {
  it("produit un JSON valide avec le contexte client et les lignes", () => {
    const payload = buildReviewPayload(ALLOCATION, CLIENT, { actions: 60, obligations: 40 }, ["LU1"]);
    const parsed = JSON.parse(payload);
    expect(parsed.client.age).toBe(30);
    expect(parsed.client.horizon_annees).toBe(20);
    expect(parsed.cibles_du_moteur_pct).toEqual({ actions: 60, obligations: 40 });
    expect(parsed.fonds_imposes_par_le_conseiller).toEqual(["LU1"]);
    expect(parsed.portefeuille.lignes).toHaveLength(3);
    expect(parsed.portefeuille.lignes[0]).toMatchObject({ isin: "LU1", poids_pct: 50, classe: "actions" });
    expect(parsed.portefeuille.sri_moyen_pondere).toBe(3.0);
  });

  it("convertit rendement et volatilité en pourcentages lisibles", () => {
    const parsed = JSON.parse(buildReviewPayload(ALLOCATION, CLIENT, undefined, []));
    expect(parsed.portefeuille.rendement_attendu_pct).toBe(4.8);
    expect(parsed.portefeuille.volatilite_pct).toBe(8.5);
    expect(parsed.cibles_du_moteur_pct).toBeNull();
  });
});

describe("sanitizeReview", () => {
  it("retombe sur « conforme sans action » pour une sortie invalide", () => {
    for (const raw of [null, undefined, "texte", 42, []]) {
      const r = sanitizeReview(raw, ISINS, []);
      expect(r.verdict).toBe("conforme");
      expect(r.issues).toEqual([]);
      expect(r.actions).toEqual({ exclude: [], classTargets: null });
    }
  });

  it("garde les constats valides et normalise les sévérités inconnues en info", () => {
    const r = sanitizeReview(
      {
        issues: [
          { rule: "3a", severity: "critique", message: "Trop concentré." },
          { rule: "2b", severity: "haute", message: "Sévérité inconnue." },
          { rule: "1a", severity: "attention" }, // sans message → écarté
        ],
      },
      ISINS,
      [],
    );
    expect(r.issues).toHaveLength(2);
    expect(r.issues[0].severity).toBe("critique");
    expect(r.issues[1].severity).toBe("info");
  });

  it("n'accepte que des exclusions d'ISIN présents et non imposés", () => {
    const r = sanitizeReview(
      { actions: { exclude: ["FR2", "HALLUCINE1", "LU1", "FR2"] } },
      ISINS,
      ["LU1"], // imposé par le conseiller → intouchable
    );
    expect(r.actions.exclude).toEqual(["FR2"]);
    expect(r.verdict).toBe("a_corriger");
  });

  it("ne vide jamais le portefeuille (exclusions plafonnées à la moitié des lignes)", () => {
    const r = sanitizeReview({ actions: { exclude: ["LU1", "FR2", "FR3"] } }, ISINS, []);
    expect(r.actions.exclude.length).toBeLessThanOrEqual(1); // floor(3/2) = 1
  });

  it("valide les cibles de classes : classes connues, somme ~100", () => {
    const ok = sanitizeReview(
      { actions: { class_targets: { actions: 70, obligations: 20, monetaire: 10, martienne: 50 } } },
      ISINS,
      [],
    );
    expect(ok.actions.classTargets).toEqual({ actions: 70, obligations: 20, monetaire: 10 });
    expect(ok.verdict).toBe("a_corriger");

    const badSum = sanitizeReview({ actions: { class_targets: { actions: 30 } } }, ISINS, []);
    expect(badSum.actions.classTargets).toBeNull();
    expect(badSum.verdict).toBe("conforme");
  });

  it("le verdict découle des actions retenues, pas du texte du modèle", () => {
    // Le modèle dit « a_corriger » mais toutes ses actions sont invalides.
    const r = sanitizeReview(
      { verdict: "a_corriger", actions: { exclude: ["INCONNU"], class_targets: { actions: 10 } } },
      ISINS,
      [],
    );
    expect(r.verdict).toBe("conforme");
  });
});
