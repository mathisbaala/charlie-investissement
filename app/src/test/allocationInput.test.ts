import { describe, it, expect } from "vitest";
import {
  canonicalAssetClass,
  expectedAnnualReturnPct,
  toFundInput,
  toFundInputs,
  type FundRow,
} from "../lib/allocationInput";

function row(over: Partial<FundRow> & { isin: string }): FundRow {
  return { name: over.isin, ...over };
}

describe("canonicalAssetClass", () => {
  it("mappe asset_class_broad en priorité", () => {
    expect(canonicalAssetClass(row({ isin: "A", asset_class_broad: "action" }))).toBe("actions");
    expect(canonicalAssetClass(row({ isin: "A", asset_class_broad: "obligation" }))).toBe("obligations");
    expect(canonicalAssetClass(row({ isin: "A", asset_class_broad: "diversifie" }))).toBe("diversifie");
  });
  it("retombe sur product_type (SCPI → immobilier, livret → fonds euros)", () => {
    expect(canonicalAssetClass(row({ isin: "A", product_type: "scpi" }))).toBe("immobilier");
    expect(canonicalAssetClass(row({ isin: "A", product_type: "livret" }))).toBe("fonds_euros");
  });
  it("renvoie null si non classable", () => {
    expect(canonicalAssetClass(row({ isin: "A", product_type: "opcvm" }))).toBeNull();
    expect(canonicalAssetClass(row({ isin: "A" }))).toBeNull();
  });
  it("est insensible à la casse et aux accents connus", () => {
    expect(canonicalAssetClass(row({ isin: "A", asset_class_broad: "Monétaire" }))).toBe("monetaire");
  });
});

describe("expectedAnnualReturnPct", () => {
  it("annualise le cumulé 3 ans en priorité", () => {
    // +33.1% cumulé sur 3 ans ≈ +10%/an
    const r = expectedAnnualReturnPct(row({ isin: "A", performance_3y: 33.1, performance_1y: 5 }));
    expect(r!).toBeCloseTo(10, 1);
  });
  it("retombe sur le 5 ans annualisé puis le 1 an", () => {
    const r5 = expectedAnnualReturnPct(row({ isin: "A", performance_5y: 61.05 }));
    expect(r5!).toBeCloseTo(10, 1);
    const r1 = expectedAnnualReturnPct(row({ isin: "A", performance_1y: 7 }));
    expect(r1).toBe(7);
  });
  it("renvoie null si aucune performance", () => {
    expect(expectedAnnualReturnPct(row({ isin: "A" }))).toBeNull();
  });
});

describe("toFundInput", () => {
  it("convertit une ligne complète en fractions", () => {
    const fi = toFundInput(
      row({
        isin: "EQ1",
        name: "ETF Monde",
        asset_class_broad: "action",
        category_normalized: "Actions Monde",
        performance_3y: 33.1,
        volatility_3y: 15,
        ongoing_charges: 0.002,
        risk_score: 5,
        sfdr_article: 6,
      }),
    )!;
    expect(fi).not.toBeNull();
    expect(fi.assetClass).toBe("actions");
    expect(fi.expectedReturn).toBeCloseTo(0.1, 3); // 10%/an → 0.10
    expect(fi.volatility).toBeCloseTo(0.15, 6);
    expect(fi.ter).toBeCloseTo(0.002, 9);
    expect(fi.sri).toBe(5);
  });
  it("préfère ongoing_charges au ter, retombe sur volatility_1y", () => {
    const fi = toFundInput(
      row({ isin: "A", asset_class_broad: "obligation", performance_1y: 4, volatility_1y: 6, ter: 0.01 }),
    )!;
    expect(fi.volatility).toBeCloseTo(0.06, 6);
    expect(fi.ter).toBeCloseTo(0.01, 9);
  });
  it("écarte un fonds sans classe exploitable", () => {
    expect(toFundInput(row({ isin: "A", product_type: "opcvm", performance_1y: 5, volatility_1y: 8 }))).toBeNull();
  });
  it("écarte un fonds sans rendement ou sans volatilité", () => {
    expect(toFundInput(row({ isin: "A", asset_class_broad: "action", volatility_1y: 8 }))).toBeNull();
    expect(toFundInput(row({ isin: "A", asset_class_broad: "action", performance_1y: 5 }))).toBeNull();
  });
  it("écarte une volatilité nulle ou négative (division impossible)", () => {
    expect(toFundInput(row({ isin: "A", asset_class_broad: "action", performance_1y: 5, volatility_1y: 0 }))).toBeNull();
  });
});

describe("toFundInput — notation", () => {
  it("mappe morningstar_rating → rating (et null si absent)", () => {
    const rated = toFundInput(row({ isin: "A", asset_class_broad: "action", performance_1y: 8, volatility_1y: 14, morningstar_rating: 4 }));
    expect(rated!.rating).toBe(4);
    const unrated = toFundInput(row({ isin: "B", asset_class_broad: "action", performance_1y: 8, volatility_1y: 14 }));
    expect(unrated!.rating).toBeNull();
  });
});

describe("toFundInputs", () => {
  it("filtre les non-optimisables et compte les écarts", () => {
    const { inputs, dropped } = toFundInputs([
      row({ isin: "OK", asset_class_broad: "action", performance_1y: 8, volatility_1y: 14 }),
      row({ isin: "NO1", product_type: "opcvm", performance_1y: 8, volatility_1y: 14 }), // classe inconnue
      row({ isin: "NO2", asset_class_broad: "action" }), // pas de perf/vol
    ]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].isin).toBe("OK");
    expect(dropped).toBe(2);
  });
});
