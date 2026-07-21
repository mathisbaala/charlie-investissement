import { describe, it, expect } from "vitest";
import {
  estimateRetroFrac,
  retroFallbackFrac,
  isPassiveStyle,
  buildRemuneration,
  type RemuHolding,
} from "@/lib/remuneration";
import { emptyContract, type CabinetContract } from "@/lib/cabinet";

describe("estimateRetroFrac (règle de place)", () => {
  it("ne rétrocède rien sur l'indiciel / ETF", () => {
    expect(estimateRetroFrac(0.002, "etf", null)).toBe(0);
    expect(estimateRetroFrac(0.003, "opcvm", "Passive")).toBe(0);
    expect(estimateRetroFrac(0.003, "opcvm", "indiciel")).toBe(0);
  });
  it("estime ~50 % des frais courants en gestion active", () => {
    expect(estimateRetroFrac(0.018, "opcvm", "actif")).toBeCloseTo(0.009, 9);
  });
  it("null si frais inconnus (et non passif)", () => {
    expect(estimateRetroFrac(null, "opcvm", "actif")).toBeNull();
    expect(estimateRetroFrac(undefined, null, null)).toBeNull();
  });
});

describe("retroFallbackFrac (repli d'une position)", () => {
  it("préfère la valeur sourcée en base quand elle existe", () => {
    expect(retroFallbackFrac(0.006, 0.018, "opcvm", "actif")).toBe(0.006);
    expect(retroFallbackFrac(0, 0.018, "opcvm", "actif")).toBe(0); // 0 sourcé fait foi
  });
  it("retombe sur l'estimation de place sans valeur sourcée", () => {
    expect(retroFallbackFrac(null, 0.018, "opcvm", "actif")).toBeCloseTo(0.009, 9);
    expect(retroFallbackFrac(undefined, 0.002, "etf", null)).toBe(0);
    expect(retroFallbackFrac(null, null, "opcvm", "actif")).toBeNull();
  });
  // Régression QA 2026-07-21 : ~146 supports passifs portent en base une
  // retrocession_cgp polluée (souvent = leur TER). La règle de place doit primer
  // sur cette valeur, sinon le simulateur affiche une rému CGP fantôme sur des
  // ETF qui ne rétrocèdent rien. Report : Frais / rétro ETF.
  it("ignore une retrocession_cgp sourcée polluée sur un support passif/ETF", () => {
    expect(retroFallbackFrac(0.0007, 0.0007, "etf", "passif")).toBe(0); // ETF iShares S&P 500
    expect(retroFallbackFrac(0.003, 0.003, "opcvm", "indiciel")).toBe(0);
    expect(retroFallbackFrac(0.005, 0.006, "opcvm", "Passive")).toBe(0);
    // un fonds ACTIF garde sa valeur sourcée (pas de régression sur l'actif)
    expect(retroFallbackFrac(0.006, 0.018, "opcvm", "actif")).toBe(0.006);
  });
});

describe("isPassiveStyle", () => {
  it("détecte ETF, passif, indiciel (casse/accents ignorés)", () => {
    expect(isPassiveStyle("etf", null)).toBe(true);
    expect(isPassiveStyle("opcvm", "Passive")).toBe(true);
    expect(isPassiveStyle("opcvm", "indiciel")).toBe(true);
    expect(isPassiveStyle("opcvm", "actif")).toBe(false);
    expect(isPassiveStyle(null, null)).toBe(false);
  });
});

// Convention type : taux UC 50 %, part contrat 0,50 %/an, entrée reversée 1 %,
// exception sur FR1 à 60 %.
function convention(): CabinetContract {
  return {
    ...emptyContract("Assureur::Contrat"),
    ucRetroShare: 0.5,
    contractFeeShare: 0.005,
    entryFeeShare: 0.01,
    fundOverrides: [{ isin: "FR1", share: 0.6 }],
  };
}

describe("buildRemuneration (barème cabinet)", () => {
  const holdings: RemuHolding[] = [
    { isin: "FR1", name: "Fonds A", amount: 10000, terFrac: 0.02, retroFallbackFrac: 0.005 },
    { isin: "FR2", name: "Fonds B", amount: 10000, terFrac: 0.018, retroFallbackFrac: 0.009 },
  ];

  it("applique la cascade (exception fonds → taux UC → repli) et ventile la rému", () => {
    const r = buildRemuneration(holdings, convention(), { terMoyenPct: 1.9, contractTypes: null });
    // FR1 : exception 60 % × 2,0 % = 1,20 % → 120 €/an ; FR2 : 50 % × 1,8 % = 0,90 % → 90 €/an
    expect(r.ucAnnual).toBeCloseTo(210, 6);
    // Part contrat : 0,50 % × 20 000 = 100 €/an
    expect(r.contractAnnual).toBeCloseTo(100, 6);
    expect(r.recurringAnnual).toBeCloseTo(310, 6);
    // Frais d'entrée reversés : 1 % × 20 000 = 200 € (une fois)
    expect(r.entryOnce).toBeCloseTo(200, 6);
    // Taux de rétro : 310 / 20 000 = 1,55 %
    expect(r.retroRatePct).toBeCloseTo(1.55, 6);
    // Lignes sourcées par la convention (taux fixé + TER connu)
    expect(r.lines.every((l) => l.sourced)).toBe(true);
    expect(r.hasConvention).toBe(true);
    expect(r.unknownRetroLines).toBe(0);
  });

  it("calcule le coût client (CTD, contrat indicatif) et la part captée", () => {
    const r = buildRemuneration(holdings, convention(), { terMoyenPct: 1.9, contractTypes: null });
    // CTD = 1,9 % (fonds) + 0,8 % (contrat indicatif AV) = 2,7 %/an
    expect(r.clientCostPct).toBeCloseTo(2.7, 6);
    expect(r.supportsPct).toBeCloseTo(1.9, 6);
    expect(r.contractPct).toBeCloseTo(0.8, 6);
    expect(r.contractSourced).toBe(false);
    // Coût client annualisé : 2,7 % × 20 000 = 540 €/an ; part captée : 310 / 540
    expect(r.clientCostAnnual).toBeCloseTo(540, 6);
    expect(r.captureSharePct).toBeCloseTo(57.41, 2);
    // Pas de frais d'entrée contrat fourni → coût one-shot client absent.
    expect(r.clientEntryPct).toBeNull();
    expect(r.clientEntryOnce).toBeNull();
  });

  it("utilise le frais de gestion contrat SOURCÉ et le frais d'entrée contrat quand fournis", () => {
    const r = buildRemuneration(holdings, convention(), {
      terMoyenPct: 1.9, contractFeePct: 0.5, contractEntryPct: 2, contractTypes: ["av"],
    });
    // CTD sourcé = 1,9 % + 0,5 % = 2,4 %/an (contractSourced = true)
    expect(r.contractPct).toBeCloseTo(0.5, 6);
    expect(r.contractSourced).toBe(true);
    expect(r.clientCostPct).toBeCloseTo(2.4, 6);
    expect(r.clientCostAnnual).toBeCloseTo(480, 6);
    // Frais d'entrée contrat (coût client one-shot) : 2 % × 20 000 = 400 €
    expect(r.clientEntryPct).toBeCloseTo(2, 6);
    expect(r.clientEntryOnce).toBeCloseTo(400, 6);
  });

  it("consolide les honoraires de conseil (forfait + annuel) avec les rétrocessions", () => {
    const r = buildRemuneration(holdings, convention(), {
      terMoyenPct: 1.9, honoraireForfait: 1500, honoraireAnnuel: 0.005, // 0,50 %/an
    });
    // annuel : 0,50 % × 20 000 = 100 €/an ; forfait : 1 500 €
    expect(r.honoraireAnnuel).toBeCloseTo(100, 6);
    expect(r.honoraireForfait).toBe(1500);
    // revenu récurrent total = récurrent (310) + honoraire annuel (100) = 410 €/an
    expect(r.revenuRecurrentTotal).toBeCloseTo(410, 6);
    // revenu ponctuel total = entrée reversée (200) + forfait (1 500) = 1 700 €
    expect(r.revenuPonctuelTotal).toBeCloseTo(1700, 6);
  });

  it("honoraires absents → 0, revenus = rétrocessions seules", () => {
    const r = buildRemuneration(holdings, convention(), { terMoyenPct: 1.9 });
    expect(r.honoraireForfait).toBe(0);
    expect(r.honoraireAnnuel).toBe(0);
    expect(r.revenuRecurrentTotal).toBeCloseTo(r.recurringAnnual, 6);
    expect(r.revenuPonctuelTotal).toBeCloseTo(r.entryOnce, 6);
  });

  it("sans convention : estimation de place seule, part contrat et entrée nulles", () => {
    const r = buildRemuneration(holdings, null, { terMoyenPct: 1.9, contractTypes: null });
    // Repli : FR1 = 0,50 % → 50 €, FR2 = 0,90 % → 90 € = 140 €/an
    expect(r.ucAnnual).toBeCloseTo(140, 6);
    expect(r.contractAnnual).toBe(0);
    expect(r.entryOnce).toBe(0);
    expect(r.recurringAnnual).toBeCloseTo(140, 6);
    expect(r.lines.every((l) => l.sourced)).toBe(false);
    expect(r.hasConvention).toBe(false);
  });

  it("compte les lignes sans rétrocession exploitable et ignore le CTD si TER inconnu", () => {
    const r = buildRemuneration(
      [{ isin: "FR9", name: "Fonds C", amount: 5000, terFrac: null, retroFallbackFrac: null }],
      null,
      { terMoyenPct: null, contractTypes: null },
    );
    expect(r.unknownRetroLines).toBe(1);
    expect(r.recurringAnnual).toBe(0);
    expect(r.clientCostPct).toBeNull();
    expect(r.clientCostAnnual).toBeNull();
    expect(r.captureSharePct).toBeNull();
  });

  it("encours nul → taux de rétro null (pas de division par zéro)", () => {
    const r = buildRemuneration(
      [{ isin: "FR1", name: "A", amount: 0, terFrac: 0.02, retroFallbackFrac: 0.01 }],
      convention(),
      { terMoyenPct: 1.9, contractTypes: null },
    );
    expect(r.totalAmount).toBe(0);
    expect(r.retroRatePct).toBeNull();
  });
});
