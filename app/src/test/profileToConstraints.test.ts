import { describe, it, expect } from "vitest";
import {
  renormalize,
  targetsForProfile,
  profileToConstraints,
  filterFundsByProfile,
  filterUniverse,
  regionsForGeographies,
  ethicalExclusionViolation,
  satisfiesDeclaredExclusions,
  GEO_TO_REGIONS,
} from "../lib/profileToConstraints";
import type { FundInput } from "../lib/optimizer";

describe("renormalize", () => {
  it("ramène la somme à 100", () => {
    const t = renormalize({ actions: 3, obligations: 1 });
    expect((t.actions ?? 0) + (t.obligations ?? 0)).toBeCloseTo(100, 1);
    expect(t.actions).toBeCloseTo(75, 1);
  });
  it("ignore les valeurs nulles/négatives", () => {
    expect(renormalize({ actions: 0 })).toEqual({});
  });
});

describe("targetsForProfile", () => {
  it("prudent est majoritairement défensif (oblig + monétaire > 50%)", () => {
    const t = targetsForProfile("prudent");
    const defensive = (t.obligations ?? 0) + (t.monetaire ?? 0);
    expect(defensive).toBeGreaterThan(50);
    expect(t.actions ?? 0).toBeLessThan(20);
  });
  it("offensif est majoritairement actions", () => {
    const t = targetsForProfile("offensif");
    expect(t.actions ?? 0).toBeGreaterThan(60);
  });
  it("restreint aux classes choisies et renormalise à 100", () => {
    const t = targetsForProfile("equilibre", ["actions", "obligations"]);
    expect(Object.keys(t).sort()).toEqual(["actions", "obligations"]);
    expect((t.actions ?? 0) + (t.obligations ?? 0)).toBeCloseTo(100, 1);
  });
  it("mappe scpi/multi_actifs vers immobilier/diversifie", () => {
    const t = targetsForProfile("equilibre", ["scpi", "multi_actifs"]);
    expect(Object.keys(t).sort()).toEqual(["diversifie", "immobilier"]);
  });
  it("mappe private_equity vers la classe alternatif (régression : plus jamais écarté)", () => {
    const t = targetsForProfile("dynamique", ["private_equity"]);
    expect(t.alternatif ?? 0).toBeGreaterThan(0);
    // combiné à d'autres classes, l'alternatif garde une part plancher
    const mix = targetsForProfile("dynamique", ["actions", "private_equity"]);
    expect(mix.alternatif ?? 0).toBeGreaterThan(5);
    expect(mix.actions ?? 0).toBeGreaterThan(mix.alternatif ?? 0);
  });
});

describe("profileToConstraints", () => {
  it("produit cibles + plafond SRI selon le risque", () => {
    const c = profileToConstraints({ risk_profile: "prudent", asset_classes: [], max_ter: null });
    expect(c.maxWeightedSri).toBe(3);
    expect(c.classTargets).toBeDefined();
  });
  it("défaut equilibre si profil de risque absent", () => {
    const c = profileToConstraints({ risk_profile: null, asset_classes: [], max_ter: null });
    expect(c.maxWeightedSri).toBe(4);
  });
  it("honore les classes souhaitées", () => {
    const c = profileToConstraints({ risk_profile: "dynamique", asset_classes: ["actions"], max_ter: null });
    expect(Object.keys(c.classTargets ?? {})).toEqual(["actions"]);
  });
  it("durcit le plafond SRI selon la tolérance à la perte", () => {
    // dynamique = SRI 5, mais perte_max 10% → plafond 4 (le plus contraignant)
    const c = profileToConstraints({ risk_profile: "dynamique", asset_classes: [], perte_max: "10" });
    expect(c.maxWeightedSri).toBe(4);
  });
  it("ignore une tolérance illimitée", () => {
    const c = profileToConstraints({ risk_profile: "prudent", asset_classes: [], perte_max: "illimitee" });
    expect(c.maxWeightedSri).toBe(3); // reste le plafond du profil prudent
  });
});

describe("filterFundsByProfile", () => {
  function f(over: Partial<FundInput> & { isin: string }): FundInput {
    return { name: over.isin, assetClass: "actions", expectedReturn: 0.08, volatility: 0.12, ...over };
  }
  const universe: FundInput[] = [
    f({ isin: "CHEAP8", ter: 0.005, sfdr: 8 }),
    f({ isin: "PRICEY6", ter: 0.02, sfdr: 6 }),
    f({ isin: "ART9", ter: 0.015, sfdr: 9 }),
    f({ isin: "NOTER", ter: null, sfdr: 8 }),
  ];

  it("écarte les fonds au-dessus du plafond de frais (en %)", () => {
    const { funds, dropped } = filterFundsByProfile(universe, { max_ter: 1, esg: "indifferent" });
    // garde ceux à TER <= 1% : CHEAP8 (0,5%), NOTER (inconnu, gardé) ; écarte PRICEY6 (2%), ART9 (1,5%)
    expect(funds.map((x) => x.isin).sort()).toEqual(["CHEAP8", "NOTER"]);
    expect(dropped).toBe(2);
  });
  it("filtre ESG art8 (SFDR 8 ou 9)", () => {
    const { funds } = filterFundsByProfile(universe, { max_ter: null, esg: "art8" });
    expect(funds.map((x) => x.isin).sort()).toEqual(["ART9", "CHEAP8", "NOTER"]);
  });
  it("filtre ESG art9 (SFDR 9 uniquement)", () => {
    const { funds } = filterFundsByProfile(universe, { max_ter: null, esg: "art9" });
    expect(funds.map((x) => x.isin)).toEqual(["ART9"]);
  });
  it("ne filtre rien en mode indifferent sans plafond", () => {
    const { funds, dropped } = filterFundsByProfile(universe, { max_ter: null, esg: "indifferent" });
    expect(funds).toHaveLength(4);
    expect(dropped).toBe(0);
  });
  it("applique aussi les zones géographiques quand le profil en fournit", () => {
    const geoUniverse = [
      f({ isin: "US", region: "usa" }),
      f({ isin: "EU", region: "europe" }),
      f({ isin: "NULL", region: null }),
    ];
    const { funds } = filterFundsByProfile(geoUniverse, {
      max_ter: null, esg: "indifferent", geographies: ["amerique_nord"],
    });
    expect(funds.map((x) => x.isin).sort()).toEqual(["NULL", "US"]);
  });
});

describe("regionsForGeographies", () => {
  it("renvoie null sans zone (aucune contrainte)", () => {
    expect(regionsForGeographies([])).toBeNull();
    expect(regionsForGeographies(["zone_inconnue"])).toBeNull();
  });
  it("mappe une zone profil vers les régions fines de la base", () => {
    const r = regionsForGeographies(["europe"])!;
    expect(r.has("europe")).toBe(true);
    expect(r.has("eurozone")).toBe(true);
    expect(r.has("france")).toBe(true);
    expect(r.has("usa")).toBe(false);
  });
  it("fait l'union de plusieurs zones", () => {
    const r = regionsForGeographies(["amerique_nord", "asie"])!;
    expect(r.has("usa")).toBe(true);
    expect(r.has("japan")).toBe(true);
    expect(r.has("europe")).toBe(false);
  });
  it("couvre toutes les zones du vocabulaire profil", () => {
    for (const zone of Object.keys(GEO_TO_REGIONS)) {
      expect(regionsForGeographies([zone])!.size).toBeGreaterThan(0);
    }
  });
});

describe("filterUniverse", () => {
  function f(over: Partial<FundInput> & { isin: string }): FundInput {
    return { name: over.isin, assetClass: "actions", expectedReturn: 0.08, volatility: 0.12, ...over };
  }
  const universe: FundInput[] = [
    f({ isin: "USA5", region: "usa", sri: 5, ter: 0.002, sfdr: 6 }),
    f({ isin: "EUR3", region: "europe", sri: 3, ter: 0.015, sfdr: 8 }),
    f({ isin: "WLD4", region: "world", sri: 4, ter: 0.01, sfdr: 9 }),
    f({ isin: "NOGEO", region: null, sri: null, ter: null, sfdr: null }),
  ];

  it("filtre par zones géographiques en gardant les fonds sans donnée géo", () => {
    const { funds, dropped } = filterUniverse(universe, { geographies: ["europe"] });
    expect(funds.map((x) => x.isin).sort()).toEqual(["EUR3", "NOGEO"]);
    expect(dropped).toBe(2);
  });
  it("ne filtre par zones QUE la classe actions (régression : la SCPI et les obligations survivent)", () => {
    const mixed: FundInput[] = [
      f({ isin: "EQUSA", assetClass: "actions", region: "usa" }),
      f({ isin: "SCPIFR", assetClass: "immobilier", region: "france" }),
      f({ isin: "BONDEUR", assetClass: "obligations", region: "eurozone" }),
      f({ isin: "MONEUR", assetClass: "monetaire", region: "eurozone" }),
    ];
    // Le client demande « monde + asie » : seule l'action usa est écartée —
    // la SCPI française, l'obligation et le monétaire euro restent recommandables.
    const { funds } = filterUniverse(mixed, { geographies: ["monde", "asie"] });
    expect(funds.map((x) => x.isin).sort()).toEqual(["BONDEUR", "MONEUR", "SCPIFR"]);
  });
  it("filtre par plafond SRI par fonds en gardant les SRI inconnus", () => {
    const { funds } = filterUniverse(universe, { sriMax: 3 });
    expect(funds.map((x) => x.isin).sort()).toEqual(["EUR3", "NOGEO"]);
  });
  it("écarte les ISIN exclus, sans tenir compte de la casse", () => {
    const { funds, dropped } = filterUniverse(universe, { exclude: ["usa5", "WLD4"] });
    expect(funds.map((x) => x.isin).sort()).toEqual(["EUR3", "NOGEO"]);
    expect(dropped).toBe(2);
  });
  it("combine tous les filtres (frais, ESG, géo, SRI, exclusions)", () => {
    const { funds } = filterUniverse(universe, {
      maxTer: 1.6, esg: "art8", geographies: ["europe", "monde"], sriMax: 4, exclude: ["NOGEO"],
    });
    expect(funds.map((x) => x.isin).sort()).toEqual(["EUR3", "WLD4"]);
  });
  it("sans option, ne filtre rien", () => {
    const { funds, dropped } = filterUniverse(universe, {});
    expect(funds).toHaveLength(4);
    expect(dropped).toBe(0);
  });

  it("écarte les fonds au mandat contraire aux exclusions éthiques", () => {
    const ethical: FundInput[] = [
      f({ isin: "DEF", name: "Global Aerospace & Defence Fund" }),
      f({ isin: "OIL", name: "World Oil & Gas Leaders" }),
      f({ isin: "NRJ", name: "Fonds Energie Classique", sector: "Énergie" }),
      f({ isin: "TAB", name: "Consumer Brands", category: "Tobacco & Spirits" }),
      f({ isin: "CAS", name: "Casino Resorts Equity" }),
      f({ isin: "OKF", name: "Fonds Actions Monde" }),
      // Pièges : jeux vidéo ≠ jeux d'argent, renouvelable ≠ pétrole.
      f({ isin: "GAM", name: "Video Gaming & Esports" }),
      f({ isin: "REN", name: "Renewable Transition Equity", sector: "Environnement" }),
    ];
    const { funds } = filterUniverse(ethical, {
      exclusions: ["armes", "fossiles", "tabac", "jeux", "alcool"],
    });
    expect(funds.map((x) => x.isin).sort()).toEqual(["GAM", "OKF", "REN"]);
  });
});

describe("ethicalExclusionViolation", () => {
  const fund = (name: string, sector: string | null = null, category: string | null = null) =>
    ({ name, sector, category });

  it("détecte chaque thème via le nom, la catégorie ou le secteur", () => {
    expect(ethicalExclusionViolation(fund("Défense Europe"), ["armes"])).toBe("armes");
    expect(ethicalExclusionViolation(fund("Brent Oil Tracker"), ["fossiles"])).toBe("fossiles");
    expect(ethicalExclusionViolation(fund("Fonds sectoriel", "Énergie"), ["fossiles"])).toBe("fossiles");
    expect(ethicalExclusionViolation(fund("X", null, "Tobacco"), ["tabac"])).toBe("tabac");
    expect(ethicalExclusionViolation(fund("Gambling & Betting"), ["jeux"])).toBe("jeux");
    expect(ethicalExclusionViolation(fund("Wine & Spirits"), ["alcool"])).toBe("alcool");
  });

  it("ne signale rien sans exclusion demandée ou pour un fonds neutre", () => {
    expect(ethicalExclusionViolation(fund("Défense Europe"), [])).toBeNull();
    expect(ethicalExclusionViolation(fund("Actions Monde"), ["armes", "fossiles"])).toBeNull();
  });

  it("ne confond pas les faux amis (jeux vidéo, renouvelables, cybersécurité)", () => {
    expect(ethicalExclusionViolation(fund("Video Gaming & Esports"), ["jeux"])).toBeNull();
    expect(ethicalExclusionViolation(fund("Renewable Energy Transition", "Environnement"), ["fossiles"])).toBeNull();
    expect(ethicalExclusionViolation(fund("Cybersecurity Leaders"), ["armes"])).toBeNull();
  });

  it("ignore les valeurs d'exclusion inconnues sans sur-exclure", () => {
    expect(ethicalExclusionViolation(fund("Défense Europe"), ["nucleaire"])).toBeNull();
  });
});

describe("satisfiesDeclaredExclusions (mode strict)", () => {
  const f = (assetClass: FundInput["assetClass"], policies: string[] | null) =>
    ({ assetClass, exclusionPolicies: policies });

  it("exige la déclaration de CHAQUE exclusion demandée pour les classes exposées", () => {
    expect(satisfiesDeclaredExclusions(f("actions", ["excl-fossiles", "excl-armes"]), ["fossiles", "armes"])).toBe(true);
    expect(satisfiesDeclaredExclusions(f("actions", ["excl-fossiles"]), ["fossiles", "armes"])).toBe(false);
    expect(satisfiesDeclaredExclusions(f("obligations", []), ["tabac"])).toBe(false);
    expect(satisfiesDeclaredExclusions(f("actions", null), ["jeux"])).toBe(false);
  });

  it("exempte les classes structurellement non exposées (monétaire, fonds euros, immobilier, crypto)", () => {
    for (const cls of ["monetaire", "fonds_euros", "immobilier", "crypto"] as const) {
      expect(satisfiesDeclaredExclusions(f(cls, null), ["fossiles", "armes"])).toBe(true);
    }
  });

  it("sans exclusion demandée, tout passe", () => {
    expect(satisfiesDeclaredExclusions(f("actions", null), [])).toBe(true);
  });
});

describe("filterUniverse — mode strict des exclusions", () => {
  function f(over: Partial<FundInput> & { isin: string }): FundInput {
    return { name: over.isin, assetClass: "actions", expectedReturn: 0.08, volatility: 0.12, ...over };
  }
  const universe: FundInput[] = [
    f({ isin: "DECL", exclusionPolicies: ["excl-fossiles"] }),
    f({ isin: "NODECL" }),
    f({ isin: "MON", assetClass: "monetaire" }),
    f({ isin: "OIL", name: "World Oil Fund" }), // mandat contraire
  ];

  it("strict : garde les déclarants et les classes exemptées, écarte le reste", () => {
    const { funds } = filterUniverse(universe, {
      exclusions: ["fossiles"],
      declaredPolicyStrict: true,
    });
    expect(funds.map((x) => x.isin).sort()).toEqual(["DECL", "MON"]);
  });

  it("non strict : seul le mandat contraire est écarté (comportement de repli)", () => {
    const { funds } = filterUniverse(universe, { exclusions: ["fossiles"] });
    expect(funds.map((x) => x.isin).sort()).toEqual(["DECL", "MON", "NODECL"]);
  });
});

describe("filterUniverse — exclusions sectorielles ESG (donnée EET + proxy labels)", () => {
  function f(over: Partial<FundInput> & { isin: string }): FundInput {
    return { name: over.isin, assetClass: "actions", expectedReturn: 0.08, volatility: 0.12, ...over };
  }
  const universe: FundInput[] = [
    f({ isin: "DATA_OK", esgExclusions: { tobacco: true, fossil: true, gambling: true } }),
    // Donnée EET négative MAIS label ISR : la donnée réelle prime sur le proxy.
    f({ isin: "DATA_NON", esgExclusions: { tobacco: false }, labels: ["isr"] }),
    f({ isin: "LABEL_ISR", labels: ["isr"] }),
    f({ isin: "LABEL_GREENFIN", labels: ["greenfin"] }),
    f({ isin: "SANS_RIEN" }),
  ];

  it("tabac (défaut) : seul le documenté-négatif est écarté, la donnée EET prime sur le label", () => {
    const { funds, dropped } = filterUniverse(universe, { exclusions: ["tabac"] });
    expect(funds.map((x) => x.isin).sort()).toEqual([
      "DATA_OK", "LABEL_GREENFIN", "LABEL_ISR", "SANS_RIEN",
    ]);
    expect(dropped).toBe(1); // DATA_NON : tobacco documenté false malgré le label isr
  });
  it("tabac (strict) : preuve exigée — donnée EET positive ou label ISR garant", () => {
    const { funds } = filterUniverse(universe, {
      exclusions: ["tabac"],
      declaredPolicyStrict: true,
    });
    expect(funds.map((x) => x.isin).sort()).toEqual(["DATA_OK", "LABEL_ISR"]);
  });
  it("fossiles (strict) : seul Greenfin garantit (exclusion fossile ISR partielle, non retenue)", () => {
    const { funds } = filterUniverse(universe, {
      exclusions: ["fossiles"],
      declaredPolicyStrict: true,
    });
    expect(funds.map((x) => x.isin).sort()).toEqual(["DATA_OK", "LABEL_GREENFIN"]);
  });
  it("armes : l'exclusion armement totale (weapons) couvre les armes controversées", () => {
    const u = [
      f({ isin: "CTRV", esgExclusions: { controversial_weapons: true } }),
      f({ isin: "TOTAL", esgExclusions: { weapons: true } }),
      f({ isin: "REFUS", esgExclusions: { controversial_weapons: false } }),
    ];
    const { funds } = filterUniverse(u, { exclusions: ["armes"] });
    expect(funds.map((x) => x.isin).sort()).toEqual(["CTRV", "TOTAL"]);
  });
  it("jeux/alcool : best-effort — sans donnée on garde, documenté-négatif on écarte", () => {
    // Aucun label ne garantit jeux/alcool → l'absence de donnée ne disqualifie pas.
    const { funds } = filterUniverse(universe, { exclusions: ["jeux"] });
    expect(funds).toHaveLength(5);
    const neg = filterUniverse([f({ isin: "CASINO", esgExclusions: { gambling: false } })], {
      exclusions: ["jeux"],
    });
    expect(neg.funds).toHaveLength(0);
  });
  it("cumule plusieurs exclusions en strict (toutes doivent être prouvées)", () => {
    const { funds } = filterUniverse(universe, {
      exclusions: ["tabac", "fossiles"],
      declaredPolicyStrict: true,
    });
    expect(funds.map((x) => x.isin)).toEqual(["DATA_OK"]);
  });
  it("ignore les exclusions inconnues (liste libre → vocabulaire connu)", () => {
    const { funds } = filterUniverse(universe, { exclusions: ["crypto_mining", ""] });
    expect(funds).toHaveLength(5);
  });
  it("est appliqué par filterFundsByProfile quand le profil porte des exclusions", () => {
    const { funds } = filterFundsByProfile(universe, {
      max_ter: null,
      esg: "indifferent",
      exclusions: ["tabac"],
    });
    // Mode par défaut (pas de strict côté profil) : seul le documenté-négatif tombe.
    expect(funds.map((x) => x.isin).sort()).toEqual([
      "DATA_OK", "LABEL_GREENFIN", "LABEL_ISR", "SANS_RIEN",
    ]);
  });
});
