import { describe, it, expect } from "vitest";
import {
  parseTargets,
  paramsFromQuery,
  shortlist,
  lowCoverageIsins,
} from "../lib/allocationService";
import type { FundInput } from "../lib/optimizer";

describe("parseTargets", () => {
  it("parse une chaîne classe:poids valide", () => {
    expect(parseTargets("actions:60,obligations:30,crypto:10")).toEqual({
      actions: 60,
      obligations: 30,
      crypto: 10,
    });
  });
  it("ignore les classes inconnues et les valeurs non positives", () => {
    expect(parseTargets("actions:60,foo:20,obligations:0")).toEqual({ actions: 60 });
  });
  it("renvoie undefined si vide ou nul", () => {
    expect(parseTargets(null)).toBeUndefined();
    expect(parseTargets("")).toBeUndefined();
    expect(parseTargets("foo:10")).toBeUndefined();
  });
});

describe("paramsFromQuery", () => {
  it("exige un contrat au format Assureur::Contrat", () => {
    const bad = paramsFromQuery(new URLSearchParams("contract=SansSeparateur"));
    expect("error" in bad).toBe(true);
  });
  it("construit des paramètres complets et borne min/max", () => {
    const p = paramsFromQuery(
      new URLSearchParams(
        "contract=Cardif Lux Vie::Cardif Elite Lux&targets=actions:70,obligations:30&min=5&max=6&rf=3&years=5&must=FR0000000000&advisor=Kanopé",
      ),
    );
    expect("error" in p).toBe(false);
    if ("error" in p) return;
    expect(p.contract).toContain("::");
    expect(p.classTargets).toEqual({ actions: 70, obligations: 30 });
    expect(p.minAssets).toBe(5);
    expect(p.maxAssets).toBe(6);
    expect(p.riskFree).toBeCloseTo(0.03, 9);
    expect(p.years).toBe(5);
    expect(p.mustInclude).toEqual(["FR0000000000"]);
    expect(p.advisorName).toBe("Kanopé");
  });
  it("applique les valeurs par défaut (4/7, rf 2%, 3 ans)", () => {
    const p = paramsFromQuery(new URLSearchParams("contract=A::B"));
    if ("error" in p) throw new Error("inattendu");
    expect(p.minAssets).toBe(4);
    expect(p.maxAssets).toBe(7);
    expect(p.riskFree).toBeCloseTo(0.02, 9);
    expect(p.years).toBe(3);
  });
  it("garantit max >= min", () => {
    const p = paramsFromQuery(new URLSearchParams("contract=A::B&min=8&max=3"));
    if ("error" in p) throw new Error("inattendu");
    expect(p.maxAssets).toBeGreaterThanOrEqual(p.minAssets);
  });
  it("parse les zones géographiques en ignorant les zones inconnues", () => {
    const p = paramsFromQuery(new URLSearchParams("contract=A::B&geo=europe,amerique_nord,mars"));
    if ("error" in p) throw new Error("inattendu");
    expect(p.geographies).toEqual(["europe", "amerique_nord"]);
  });
  it("parse esg, terMax et sriMax (borné 1 à 7)", () => {
    const p = paramsFromQuery(new URLSearchParams("contract=A::B&esg=art8&terMax=1.5&sriMax=9"));
    if ("error" in p) throw new Error("inattendu");
    expect(p.esg).toBe("art8");
    expect(p.terMax).toBeCloseTo(1.5, 9);
    expect(p.sriMax).toBe(7);
  });
  it("rejette un esg inconnu et un terMax non positif", () => {
    const p = paramsFromQuery(new URLSearchParams("contract=A::B&esg=vert&terMax=-1"));
    if ("error" in p) throw new Error("inattendu");
    expect(p.esg).toBeNull();
    expect(p.terMax).toBeNull();
  });
  it("parse les exclusions comme les inclusions (ISIN valides, en majuscules)", () => {
    const p = paramsFromQuery(new URLSearchParams("contract=A::B&exclude=fr0000000000,???,LU1111111111"));
    if ("error" in p) throw new Error("inattendu");
    expect(p.exclude).toEqual(["FR0000000000", "LU1111111111"]);
  });
  it("parse la méthode de pondération (hrp), défaut sharpe", () => {
    const hrp = paramsFromQuery(new URLSearchParams("contract=A::B&method=HRP"));
    if ("error" in hrp) throw new Error("inattendu");
    expect(hrp.method).toBe("hrp");
    const def = paramsFromQuery(new URLSearchParams("contract=A::B"));
    if ("error" in def) throw new Error("inattendu");
    expect(def.method).toBe("sharpe");
    const junk = paramsFromQuery(new URLSearchParams("contract=A::B&method=foo"));
    if ("error" in junk) throw new Error("inattendu");
    expect(junk.method).toBe("sharpe");
  });
});

describe("shortlist", () => {
  function fund(isin: string, cls: FundInput["assetClass"], sharpe: number): FundInput {
    // expectedReturn/volatility choisis pour donner un score croissant avec `sharpe`
    return { isin, name: isin, assetClass: cls, expectedReturn: 0.02 + sharpe * 0.1, volatility: 0.1, sri: 4 };
  }
  it("ne réduit pas un univers déjà petit", () => {
    const funds = [fund("A", "actions", 1), fund("B", "obligations", 0.5)];
    expect(shortlist(funds, undefined, 0.02, 40)).toHaveLength(2);
  });
  it("borne au cap tout en couvrant chaque classe cible", () => {
    const funds: FundInput[] = [];
    for (let i = 0; i < 30; i++) funds.push(fund("EQ" + i, "actions", 30 - i));
    funds.push(fund("BOND1", "obligations", 0.1)); // faible score mais classe cible
    const sl = shortlist(funds, { actions: 70, obligations: 30 }, 0.02, 10);
    expect(sl.length).toBe(10);
    // la classe obligations doit être représentée malgré son score faible
    expect(sl.some((f) => f.assetClass === "obligations")).toBe(true);
  });
});

describe("lowCoverageIsins", () => {
  it("isole les fonds sous le seuil de points", () => {
    const weak = lowCoverageIsins(
      [
        { isin: "FR0000000001", n_points: 12 },
        { isin: "FR0000000002", n_points: 26 },
        { isin: "FR0000000003", n_points: 150 },
      ],
      26,
    );
    expect(weak.has("FR0000000001")).toBe(true);
    expect(weak.has("FR0000000002")).toBe(false); // au seuil = suffisant
    expect(weak.has("FR0000000003")).toBe(false);
  });

  it("tolère une couverture absente ou nulle", () => {
    expect(lowCoverageIsins(null, 26).size).toBe(0);
    expect(lowCoverageIsins(undefined, 26).size).toBe(0);
    expect(lowCoverageIsins([], 26).size).toBe(0);
  });
});
