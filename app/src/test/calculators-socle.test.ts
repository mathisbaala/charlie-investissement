import { describe, it, expect } from "vitest";
import {
  applyBareme,
  BAREME_LIGNE_DIRECTE,
  baremeForLien,
  abattementDonation,
  abattementSuccession,
  usufruitViager,
  usufruitTemporaire,
  prelevement990I,
} from "../lib/calculators/bareme";
import { eur, missingFields, withDefaults, activeFields } from "../lib/calculators/types";
import { CALCULATORS, CALCULATOR_BY_ID } from "../lib/calculators/registry";

describe("applyBareme — barème progressif art. 777", () => {
  it("cas canonique ligne directe : 200 000 € taxables → 38 194 €", () => {
    const { droits } = applyBareme(BAREME_LIGNE_DIRECTE, 200_000);
    expect(Math.round(droits)).toBe(38_194);
  });
  it("détaille les tranches et leur somme égale les droits", () => {
    const { droits, detail } = applyBareme(BAREME_LIGNE_DIRECTE, 1_000_000);
    expect(detail.length).toBe(6); // jusqu'à la tranche 40 %
    expect(detail.reduce((s, d) => s + d.droits, 0)).toBeCloseTo(droits, 6);
  });
  it("base nulle → aucun droit, aucun détail", () => {
    const r = applyBareme(BAREME_LIGNE_DIRECTE, 0);
    expect(r.droits).toBe(0);
    expect(r.detail).toHaveLength(0);
  });
  it("frères/sœurs : 35 % puis 45 %", () => {
    const { droits } = applyBareme(baremeForLien("frere_soeur"), 30_000);
    expect(Math.round(droits)).toBe(Math.round(24_430 * 0.35 + 5_570 * 0.45));
  });
  it("non-parent : 60 % flat", () => {
    expect(applyBareme(baremeForLien("autre"), 100_000).droits).toBeCloseTo(60_000, 6);
  });
});

describe("abattements", () => {
  it("donation : 100 000 enfant, 31 865 petit-enfant, 80 724 époux", () => {
    expect(abattementDonation("enfant")).toBe(100_000);
    expect(abattementDonation("petit_enfant")).toBe(31_865);
    expect(abattementDonation("epoux")).toBe(80_724);
  });
  it("succession : époux exonéré (Infinity), défaut 1 594", () => {
    expect(abattementSuccession("epoux")).toBe(Infinity);
    expect(abattementSuccession("autre")).toBe(1_594);
  });
});

describe("usufruit art. 669", () => {
  it("barème viager par décennie (65 ans → 40 %)", () => {
    expect(usufruitViager(65)).toBe(0.4);
    expect(usufruitViager(20)).toBe(0.9);
    expect(usufruitViager(95)).toBe(0.1);
  });
  it("temporaire : 23 % par tranche de 10 ans, plafonné au viager", () => {
    expect(usufruitTemporaire(10)).toBeCloseTo(0.23, 9);
    expect(usufruitTemporaire(15)).toBeCloseTo(0.46, 9); // 2 tranches entamées
    expect(usufruitTemporaire(15, 80)).toBeCloseTo(0.3, 9); // plafonné (80 ans → 30 %)
  });
});

describe("assurance-vie 990 I", () => {
  it("500 000 € par bénéficiaire → 69 500 €", () => {
    expect(prelevement990I(500_000)).toBeCloseTo(69_500, 6);
  });
  it("passe à 31,25 % au-delà de 700 000 € après abattement", () => {
    expect(prelevement990I(1_000_000)).toBeCloseTo(186_093.75, 2);
  });
  it("sous l'abattement → 0", () => {
    expect(prelevement990I(150_000)).toBe(0);
  });
});

describe("mécanique des champs (types.ts)", () => {
  const def = CALCULATOR_BY_ID["droits-donation-succession"];
  it("missingFields exige lien et montant, pas les champs à défaut", () => {
    const missing = missingFields(def, {});
    expect(missing.map((f) => f.key)).toEqual(["lien", "montant"]);
  });
  it("les champs conditionnels n'apparaissent que si leur condition est vraie", () => {
    const sans = activeFields(def, { dutreil: false }).map((f) => f.key);
    expect(sans).not.toContain("donateur_moins_70");
    const avec = activeFields(def, { dutreil: true, mode: "donation" }).map((f) => f.key);
    expect(avec).toContain("donateur_moins_70");
  });
  it("withDefaults comble les défauts sans écraser la saisie", () => {
    const v = withDefaults(def, { montant: 500_000 });
    expect(v.mode).toBe("donation");
    expect(v.montant).toBe(500_000);
  });
});

describe("droits-donation-succession", () => {
  const def = CALCULATOR_BY_ID["droits-donation-succession"];
  it("donation 300 000 € à un enfant → 38 194 € de droits", () => {
    const r = def.compute({ mode: "donation", lien: "enfant", montant: 300_000, abattement_consomme: 0 });
    expect(r.kpis[0].value).toBe(eur(38_194));
    expect(r.tables?.[0].rows.length).toBeGreaterThan(0);
  });
  it("succession au conjoint → exonérée", () => {
    const r = def.compute({ mode: "succession", lien: "epoux", montant: 1_000_000 });
    expect(r.kpis[0].value).toBe(eur(0));
  });
  it("Dutreil + réduction 790 : 4 M€ → 106 481 €", () => {
    const r = def.compute({
      mode: "donation", lien: "enfant", montant: 4_000_000,
      abattement_consomme: 0, dutreil: true, donateur_moins_70: true,
    });
    expect(r.kpis[0].value).toBe(eur(106_481));
  });
  it("l'abattement consommé réduit l'abattement disponible", () => {
    const plein = def.compute({ mode: "donation", lien: "enfant", montant: 200_000, abattement_consomme: 0 });
    const rogne = def.compute({ mode: "donation", lien: "enfant", montant: 200_000, abattement_consomme: 100_000 });
    expect(rogne.kpis[0].value).not.toBe(plein.kpis[0].value);
  });
});

describe("assurance-vie-succession", () => {
  const def = CALCULATOR_BY_ID["assurance-vie-succession"];
  it("1 M€ avant 70 ans, 2 bénéficiaires → 139 000 € de 990 I", () => {
    const r = def.compute({ capital_avant70: 1_000_000, nb_beneficiaires: 2, nb_exoneres: 0, primes_apres70: 0 });
    expect(r.kpis[0].value).toBe(eur(139_000));
    expect(r.kpis[1].value).toBe(eur(0)); // pas de 757 B
  });
  it("bénéficiaire conjoint exonéré → 0", () => {
    const r = def.compute({ capital_avant70: 1_000_000, nb_beneficiaires: 1, nb_exoneres: 1, primes_apres70: 0 });
    expect(r.kpis[2].value).toBe(eur(0));
  });
  it("757 B : primes 100 000 sans abattement perso → 12 094 € de DMTG", () => {
    const r = def.compute({
      capital_avant70: 0, nb_beneficiaires: 1, nb_exoneres: 0,
      primes_apres70: 100_000, lien: "enfant", abattement_dispo: false,
    });
    expect(r.kpis[1].value).toBe(eur(12_094));
  });
});

describe("donation-cession", () => {
  const def = CALCULATOR_BY_ID["donation-cession"];
  it("purge : 1 M€ / PR 200 k€ / enfant → gain 168 000 €", () => {
    const r = def.compute({
      valeur: 1_000_000, prix_revient: 200_000, lien: "enfant", taux_pv: 30, abattement_consomme: 0,
    });
    expect(r.kpis[2].value).toBe(eur(168_000));
  });
  it("sans plus-value latente, la purge n'apporte rien", () => {
    const r = def.compute({
      valeur: 500_000, prix_revient: 500_000, lien: "enfant", taux_pv: 30, abattement_consomme: 0,
    });
    expect(r.kpis[2].value).toBe(eur(0));
  });
});

describe("droits-partage", () => {
  const def = CALCULATOR_BY_ID["droits-partage"];
  it("500 000 € général → 12 500 € (2,5 %)", () => {
    expect(def.compute({ actif_net: 500_000, nature: "general" }).kpis[0].value).toBe(eur(12_500));
  });
  it("500 000 € successoral → 5 500 € (1,1 %)", () => {
    expect(def.compute({ actif_net: 500_000, nature: "succession" }).kpis[0].value).toBe(eur(5_500));
  });
});

describe("registre", () => {
  it("ids uniques et compute défini partout", () => {
    const ids = CALCULATORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CALCULATORS) {
      expect(typeof c.compute).toBe("function");
      expect(c.fields.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(10);
    }
  });
});
