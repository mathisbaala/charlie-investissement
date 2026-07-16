import { describe, it, expect, vi, afterEach } from "vitest";
import {
  aggregateExposure,
  buildGoalRows,
  frMonthLabel,
  thinCurve,
  collectPresentationExtras,
} from "@/lib/presentationExtras";
import type { ClientGoal } from "@/lib/clientProfile";

const goal = (over: Partial<ClientGoal>): ClientGoal => ({
  id: "g1",
  label: "Retraite",
  target_eur: 100_000,
  horizon_years: 10,
  initial_eur: 50_000,
  monthly_eur: 200,
  priority: "important",
  ...over,
});

describe("aggregateExposure (brique commune écran / exports)", () => {
  const rows = {
    geo: [
      { isin: "AAA", key: "US", label: "États-Unis", weight: 0.6 },
      { isin: "AAA", key: "FR", label: "France", weight: 0.4 },
      { isin: "BBB", key: "FR", label: "France", weight: 1 },
    ],
    sectors: [{ isin: "AAA", label: "Technologie", weight: 1 }],
  };
  it("pondère par les poids du portefeuille et regroupe au-delà du top 5", () => {
    const out = aggregateExposure(rows, [{ isin: "AAA", weight: 50 }, { isin: "BBB", weight: 50 }]);
    expect(out.geo).toEqual([
      { label: "France", weight: 70 },
      { label: "États-Unis", weight: 30 },
    ]);
    expect(out.sectors).toEqual([{ label: "Technologie", weight: 100 }]);
  });
  it("poids nuls → ventilations vides", () => {
    const out = aggregateExposure(rows, [{ isin: "CCC", weight: 100 }]);
    expect(out.geo).toEqual([]);
    expect(out.sectors).toEqual([]);
  });
});

describe("buildGoalRows (projets du client)", () => {
  it("calcule rendement requis et probabilité, avec la poche dédiée si présente", () => {
    const rows = buildGoalRows(
      [goal({})],
      { g1: { mu: 0.06, sigma: 0.1 } },
      0.04,
      0.12,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Retraite");
    expect(rows[0].requiredReturn).not.toBeNull();
    expect(rows[0].successProb).toBeGreaterThan(0);
    expect(rows[0].successProb).toBeLessThanOrEqual(1);
  });
  it("retombe sur le portefeuille global sans poche, et ignore les projets incomplets", () => {
    const rows = buildGoalRows(
      [goal({}), goal({ id: "g2", target_eur: null as unknown as number })],
      {},
      0.05,
      0.1,
    );
    expect(rows).toHaveLength(1);
  });
  it("projet hors de portée → requiredReturn null et probabilité null", () => {
    const rows = buildGoalRows(
      [goal({ target_eur: 10_000_000, initial_eur: 1_000, monthly_eur: 0, horizon_years: 2 })],
      {},
      0.05,
      0.1,
    );
    expect(rows[0].requiredReturn).toBeNull();
    expect(rows[0].successProb).toBeNull();
  });
});

describe("frMonthLabel", () => {
  it("formate en « Mois Année » capitalisé", () => {
    expect(frMonthLabel("2021-04-19")).toBe("Avril 2021");
  });
  it("vide sur entrée invalide ou absente", () => {
    expect(frMonthLabel(null)).toBe("");
    expect(frMonthLabel("pas-une-date")).toBe("");
  });
});

describe("thinCurve", () => {
  it("rend la courbe telle quelle sous la limite", () => {
    const pts = [1, 2, 3];
    expect(thinCurve(pts, 120)).toBe(pts);
  });
  it("sous-échantillonne en gardant les extrémités", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i);
    const out = thinCurve(pts, 100);
    expect(out).toHaveLength(100);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(999);
  });
});

describe("collectPresentationExtras", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("collecte l'exposition et laisse le back-test de côté hors données réelles", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          geo: [{ isin: "AAA", key: "US", label: "États-Unis", weight: 1 }],
          sectors: [],
        }),
      }),
    ));
    const x = await collectPresentationExtras({
      lines: [{ isin: "AAA", weight: 100 }],
      goals: [],
      pockets: {},
      globalMu: 0.05,
      globalSigma: 0.1,
      correlation: { names: ["A", "B"], matrix: [[1, 0.2], [0.2, 1]] },
      amountEur: 10_000,
      horizonYears: 8,
      projectedEur: 14_000,
      effectiveHoldings: 4.2,
      avgTer: 0.012,
      includeBacktest: false,
    });
    expect(x.exposure?.geo).toEqual([{ label: "États-Unis", weight: 100 }]);
    expect(x.backtest).toBeNull();
    expect(x.correlation?.names).toEqual(["A", "B"]);
    expect(x.projection).toEqual({ amountEur: 10_000, horizonYears: 8, projectedEur: 14_000 });
    // Un seul appel réseau : l'exposition (pas de back-test demandé).
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("réseau en panne → extras vides mais collecte réussie (le document de base sort quand même)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau"))));
    const x = await collectPresentationExtras({
      lines: [{ isin: "AAA", weight: 100 }],
      goals: [],
      pockets: {},
      globalMu: 0.05,
      globalSigma: 0.1,
      correlation: null,
      amountEur: null,
      horizonYears: 8,
      projectedEur: null,
      effectiveHoldings: null,
      avgTer: null,
      includeBacktest: true,
    });
    expect(x.exposure).toBeNull();
    expect(x.backtest).toBeNull();
    expect(x.projection).toBeNull();
    expect(x.goals).toEqual([]);
  });

  it("une corrélation à moins de 2 supports est écartée", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("x"))));
    const x = await collectPresentationExtras({
      lines: [],
      goals: [],
      pockets: {},
      globalMu: 0,
      globalSigma: 0,
      correlation: { names: ["Seul"], matrix: [[1]] },
      amountEur: null,
      horizonYears: 1,
      projectedEur: null,
      effectiveHoldings: null,
      avgTer: null,
      includeBacktest: false,
    });
    expect(x.correlation).toBeNull();
  });
});
