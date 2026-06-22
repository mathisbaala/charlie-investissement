import { describe, it, expect } from "vitest";
import { scoreFit, rankByFit, FIT_WEIGHTS, SOFT_TOLERANCE, type FitContext } from "../lib/fitScore";
import type { Fund } from "../lib/types";

// Fonds neutre : toutes métriques nulles sauf complétude. Permet d'isoler l'effet
// de chaque composante du score.
function fund(overrides: Partial<Fund>): Fund {
  return {
    isin: "FR0000000000", name: "Test", product_type: "opcvm",
    asset_class_broad: null, asset_class: null, allocation_profile: null,
    category_normalized: null, region_normalized: null, sector: null,
    management_style: null, gestionnaire: null,
    ter: null, ongoing_charges: null,
    performance_1y: null, performance_3y: null, performance_5y: null,
    volatility_1y: null, volatility_3y: null, sharpe_1y: null, sharpe_3y: null,
    max_drawdown_1y: null, max_drawdown_3y: null, risk_score: null, sfdr_article: null,
    aum_eur: null, morningstar_rating: null, currency: null,
    inception_date: null, track_record_years: null,
    entry_fee_max: null, exit_fee_max: null, performance_fee: null, retrocession_cgp: null,
    benchmark_index: null, benchmark_variant: null, benchmark_is_category: null,
    alpha_1y: null, alpha_3y: null, alpha_5y: null,
    pea_eligible: null, per_eligible: null, av_lux_eligible: null, av_fr_eligible: null,
    pea_pme_eligible: null, cto_eligible: null, ucits_compliant: null,
    is_institutional: null, accessible_retail: null, hedged: null,
    insurers: null, tickers: null, labels: null, kid_url: null, kid_parsed_at: null,
    share_class_group_id: null, data_completeness: 60, data_source: null,
    field_sources: null, updated_at: null,
    ...overrides,
  };
}

describe("scoreFit", () => {
  it("rend [0,1] et croît avec la complétude (terme dominant)", () => {
    const low = scoreFit(fund({ data_completeness: 50 }), {});
    const high = scoreFit(fund({ data_completeness: 100 }), {});
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(high).toBeGreaterThan(low);
    // L'écart de complétude pèse ~ FIT_WEIGHTS.complete sur l'échelle 0..1.
    expect(high - low).toBeCloseTo(FIT_WEIGHTS.complete * 0.5, 5);
  });

  it("la complétude domine : un fonds très complet bat un fonds très incomplet même excellent", () => {
    const complete = scoreFit(fund({ data_completeness: 95 }), {});
    const incompleteButGreat = scoreFit(
      fund({ data_completeness: 55, morningstar_rating: 5, alpha_3y: 8, sharpe_3y: 2, track_record_years: 15, aum_eur: 5_000_000_000 }),
      {},
    );
    expect(complete).toBeGreaterThan(incompleteButGreat);
  });

  it("récompense la qualité intrinsèque à complétude égale", () => {
    const base = fund({ data_completeness: 80 });
    const great = fund({ data_completeness: 80, morningstar_rating: 5, alpha_3y: 6, sharpe_3y: 1.8, track_record_years: 12, aum_eur: 2_000_000_000 });
    expect(scoreFit(great, {})).toBeGreaterThan(scoreFit(base, {}));
  });

  it("pénalise le dépassement DOUX d'un seuil de frais (quasi-match classé derrière)", () => {
    const ctx: FitContext = { terMax: 0.5 };
    const exact = fund({ data_completeness: 80, ter: 0.45 });
    const nearMiss = fund({ data_completeness: 80, ter: 0.5 * (1 + SOFT_TOLERANCE.terRel) }); // tout au bord de la bande
    expect(scoreFit(exact, ctx)).toBeGreaterThan(scoreFit(nearMiss, ctx));
  });

  it("récompense les labels durabilité EN SURPLUS du minimum demandé", () => {
    const ctx: FitContext = { labels: ["isr", "greenfin"] };
    const oneLabel = fund({ data_completeness: 80, labels: ["isr"] });
    const twoLabels = fund({ data_completeness: 80, labels: ["isr", "greenfin"] });
    expect(scoreFit(twoLabels, ctx)).toBeGreaterThan(scoreFit(oneLabel, ctx));
  });

  it("récompense la marge d'alpha quand « bat son indice » est demandé", () => {
    const ctx: FitContext = { beatsBenchmark: true };
    const small = fund({ data_completeness: 80, alpha_3y: 0.2 });
    const large = fund({ data_completeness: 80, alpha_3y: 4 });
    expect(scoreFit(large, ctx)).toBeGreaterThan(scoreFit(small, ctx));
  });

  it("préférence revenus : favorise une classe génératrice de revenus", () => {
    const ctx: FitContext = { preferIncome: true };
    const equity = fund({ data_completeness: 80, asset_class_broad: "action" });
    const realEstate = fund({ data_completeness: 80, asset_class_broad: "immobilier" });
    expect(scoreFit(realEstate, ctx)).toBeGreaterThan(scoreFit(equity, ctx));
  });

  it("préférence novice : pénalise les produits complexes (alternatif)", () => {
    const ctx: FitContext = { novice: true };
    const simple = fund({ data_completeness: 80, asset_class_broad: "action" });
    const complex = fund({ data_completeness: 80, asset_class_broad: "alternatif" });
    expect(scoreFit(simple, ctx)).toBeGreaterThan(scoreFit(complex, ctx));
  });

  it("préférence enveloppe (TMI) : favorise un fonds éligible PER/PEA", () => {
    const ctx: FitContext = { preferEnvelopes: ["PER", "PEA"] };
    const eligible = fund({ data_completeness: 80, per_eligible: true });
    const notEligible = fund({ data_completeness: 80, per_eligible: false });
    expect(scoreFit(eligible, ctx)).toBeGreaterThan(scoreFit(notEligible, ctx));
  });

  it("petit montant : favorise l'accessible retail", () => {
    const ctx: FitContext = { smallTicket: true };
    const retail = fund({ data_completeness: 80, accessible_retail: true });
    const inst = fund({ data_completeness: 80, accessible_retail: false });
    expect(scoreFit(retail, ctx)).toBeGreaterThan(scoreFit(inst, ctx));
  });
});

describe("rankByFit", () => {
  it("classe par adéquation décroissante", () => {
    const a = fund({ isin: "A", data_completeness: 95 });
    const b = fund({ isin: "B", data_completeness: 60 });
    const c = fund({ isin: "C", data_completeness: 80 });
    const ranked = rankByFit([b, a, c], {});
    expect(ranked.map((f) => f.isin)).toEqual(["A", "C", "B"]);
  });

  it("départage de façon déterministe à score égal (completeness puis ISIN)", () => {
    const x = fund({ isin: "ZZZ", data_completeness: 70 });
    const y = fund({ isin: "AAA", data_completeness: 70 });
    const ranked = rankByFit([x, y], {});
    expect(ranked.map((f) => f.isin)).toEqual(["AAA", "ZZZ"]);
  });

  it("ne mute pas l'entrée", () => {
    const input = [fund({ isin: "A", data_completeness: 60 }), fund({ isin: "B", data_completeness: 90 })];
    const snapshot = input.map((f) => f.isin);
    rankByFit(input, {});
    expect(input.map((f) => f.isin)).toEqual(snapshot);
  });
});
