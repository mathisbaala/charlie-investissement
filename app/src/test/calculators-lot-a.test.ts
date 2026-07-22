// Tests du lot A (8 calculateurs de transmission). Tous les attendus sont
// calculés À LA MAIN depuis le barème ligne directe art. 777 : pour une base
// taxable t entre 15 932 € et 552 324 €, droits = 1 380,75 + (t − 15 932) × 20 %.
// Les defs ne sont pas encore enregistrées dans registry.ts (non modifié) :
// on les importe directement.

import { describe, it, expect } from "vitest";
import { eur } from "../lib/calculators/types";
import donationNette from "../lib/calculators/defs/donation-nette";
import dptReinco from "../lib/calculators/defs/dpt-reinco";
import graduelleResiduelle from "../lib/calculators/defs/graduelle-residuelle";
import donationPartageSoulte from "../lib/calculators/defs/donation-partage-soulte";
import donationGfa from "../lib/calculators/defs/donation-gfa";
import exoPartage from "../lib/calculators/defs/exo-partage";
import territorialiteDmtg from "../lib/calculators/defs/territorialite-dmtg";
import dernierVivant from "../lib/calculators/defs/dernier-vivant";

describe("donation-nette", () => {
  it("net voulu 200 000 € à un enfant → droits 18 194 €, coût total 218 194 €", () => {
    // Taxable = 200 000 − 100 000 = 100 000 → 1 380,75 + 84 068 × 20 % = 18 194,35.
    const r = donationNette.compute({ lien: "enfant", mode: "net_voulu", montant: 200_000, abattement_consomme: 0 });
    expect(r.kpis[0].value).toBe(eur(200_000)); // net au donataire
    expect(r.kpis[1].value).toBe(eur(18_194.35)); // droits pris en charge
    expect(r.kpis[2].value).toBe(eur(218_194.35)); // coût total donateur
  });
  it("budget total 250 000 € (enfant) → net 226 505 €, droits 23 495 €", () => {
    // Inverse : net + 1 380,75 + (net − 115 932) × 0,2 = 250 000
    // → 1,2 × net = 271 805,65 → net = 226 504,7083…, droits = 23 495,29.
    const r = donationNette.compute({ lien: "enfant", mode: "budget_total", montant: 250_000, abattement_consomme: 0 });
    expect(r.kpis[0].value).toBe(eur(226_504.71));
    expect(r.kpis[1].value).toBe(eur(23_495.29));
    expect(r.kpis[2].value).toBe(eur(250_000)); // coût = budget
  });
  it("budget 100 000 € (enfant) : tout passe sous l'abattement → net = budget, droits 0", () => {
    const r = donationNette.compute({ lien: "enfant", mode: "budget_total", montant: 100_000, abattement_consomme: 0 });
    expect(r.kpis[0].value).toBe(eur(100_000));
    expect(r.kpis[1].value).toBe(eur(0));
  });
});

describe("dpt-reinco", () => {
  it("donation initiale > 15 ans, 500 000 € → seul le droit de partage de 12 500 €", () => {
    // DP = 500 000 × 2,5 % = 12 500 ; DMTG = 0.
    // Référence donation simple : taxable 500 000 − 31 865 = 468 135
    // → 1 380,75 + 452 203 × 20 % = 91 821,35.
    const r = dptReinco.compute({ valeur_reincorporee: 500_000, donation_initiale_plus_15_ans: true, abattement_consomme: 0 });
    expect(r.kpis[0].value).toBe(eur(12_500)); // total dû
    expect(r.kpis[1].value).toBe(eur(0)); // dont DMTG
    expect(r.kpis[2].value).toBe(eur(12_500)); // dont droit de partage
    expect(r.kpis[3].value).toBe(eur(91_821.35)); // donation simple de référence
  });
  it("donation initiale < 15 ans, 100 000 €, 5 000 € payés initialement → 9 321 €", () => {
    // DMTG : taxable 100 000 − 31 865 = 68 135 → 1 380,75 + 52 203 × 20 % = 11 821,35
    // − imputation 5 000 = 6 821,35 ; DP = 2 500 ; total = 9 321,35.
    const r = dptReinco.compute({
      valeur_reincorporee: 100_000,
      donation_initiale_plus_15_ans: false,
      droits_payes_initialement: 5_000,
      abattement_consomme: 0,
    });
    expect(r.kpis[0].value).toBe(eur(9_321.35));
    expect(r.kpis[1].value).toBe(eur(6_821.35));
    expect(r.kpis[2].value).toBe(eur(2_500));
  });
});

describe("graduelle-residuelle", () => {
  it("succession 400 000 € à un enfant, 20 000 € déjà payés → nets 38 194 €", () => {
    // Bruts : taxable 300 000 → 1 380,75 + 284 068 × 20 % = 58 194,35
    // − 20 000 = 38 194,35 ; net transmis = 361 805,65.
    const r = graduelleResiduelle.compute({
      valeur_seconde_transmission: 400_000,
      lien: "enfant",
      droits_premiere_mutation: 20_000,
      abattement_consomme: 0,
      mode: "succession",
    });
    expect(r.kpis[0].value).toBe(eur(58_194.35)); // bruts
    expect(r.kpis[1].value).toBe(eur(20_000)); // imputation
    expect(r.kpis[2].value).toBe(eur(38_194.35)); // nets
    expect(r.kpis[3].value).toBe(eur(361_805.65)); // net transmis
  });
  it("imputation plafonnée aux droits bruts (plancher 0, pas de restitution)", () => {
    // Bruts : taxable 50 000 → 1 380,75 + 34 068 × 20 % = 8 194,35 < 100 000 payés.
    const r = graduelleResiduelle.compute({
      valeur_seconde_transmission: 150_000,
      lien: "enfant",
      droits_premiere_mutation: 100_000,
      abattement_consomme: 0,
      mode: "succession",
    });
    expect(r.kpis[1].value).toBe(eur(8_194.35)); // imputation bornée aux bruts
    expect(r.kpis[2].value).toBe(eur(0)); // nets
  });
});

describe("donation-partage-soulte", () => {
  it("600 000 € / 2 enfants avec soulte : chacun taxé sur 300 000 € → 76 389 € au total", () => {
    // Part théorique 300 000 → taxable 200 000 → 38 194,35 par enfant → × 2 = 76 388,70.
    const r = donationPartageSoulte.compute({
      valeur_totale: 600_000,
      nb_enfants: 2,
      soulte: 100_000,
      abattement_consomme_par_enfant: 0,
    });
    expect(r.kpis[0].value).toBe(eur(76_388.7)); // droits totaux
    expect(r.kpis[1].value).toBe(eur(38_194.35)); // par enfant
    expect(r.kpis[2].value).toBe(eur(600_000 - 76_388.7)); // net transmis
  });
  it("100 000 € / 1 enfant : sous l'abattement → aucun droit", () => {
    const r = donationPartageSoulte.compute({
      valeur_totale: 100_000,
      nb_enfants: 1,
      soulte: 0,
      abattement_consomme_par_enfant: 0,
    });
    expect(r.kpis[0].value).toBe(eur(0));
  });
});

describe("donation-gfa", () => {
  it("500 000 € (seuil 300 000) à un enfant → assiette 175 000 €, droits 13 194 €", () => {
    // Assiette = 300 000 × 25 % + 200 000 × 50 % = 175 000 ; taxable 75 000
    // → 1 380,75 + 59 068 × 20 % = 13 194,35. Sans régime : taxable 400 000
    // → 78 194,35 → économie 65 000.
    const r = donationGfa.compute({ valeur_parts: 500_000, lien: "enfant", seuil_75: 300_000, abattement_consomme: 0 });
    expect(r.kpis[0].value).toBe(eur(13_194.35));
    expect(r.kpis[1].value).toBe(eur(175_000));
    expect(r.kpis[2].value).toBe(eur(65_000));
  });
  it("200 000 € sous le seuil → assiette 50 000 € couverte par l'abattement, droits 0", () => {
    // Assiette = 200 000 × 25 % = 50 000 < 100 000 d'abattement → 0.
    // Sans régime : taxable 100 000 → 18 194,35 d'économie.
    const r = donationGfa.compute({ valeur_parts: 200_000, lien: "enfant", seuil_75: 300_000, abattement_consomme: 0 });
    expect(r.kpis[0].value).toBe(eur(0));
    expect(r.kpis[1].value).toBe(eur(50_000));
    expect(r.kpis[2].value).toBe(eur(18_194.35));
  });
});

describe("exo-partage", () => {
  it("indivision successorale, attributaire membre → exonéré, impôt évité 14 480 €", () => {
    // 40 000 × 36,2 % = 14 480.
    const r = exoPartage.compute({
      origine_indivision: "successorale_conjugale",
      cessionnaire_membre: true,
      soulte: 100_000,
      plus_value_latente_quote_part: 40_000,
      taux_imposition: 36.2,
    });
    expect(r.kpis[0].value).toBe("Exonéré");
    expect(r.kpis[1].value).toBe(eur(14_480));
  });
  it("indivision ordinaire → taxable, impôt dû 14 480 €", () => {
    const r = exoPartage.compute({
      origine_indivision: "autre",
      cessionnaire_membre: true,
      soulte: 100_000,
      plus_value_latente_quote_part: 40_000,
      taux_imposition: 36.2,
    });
    expect(r.kpis[0].value).toBe("Taxable");
    expect(r.kpis[1].value).toBe(eur(14_480));
  });
});

describe("territorialite-dmtg", () => {
  it("donateur domicilié en France → assiette mondiale 300 000 €, droits 38 194 €", () => {
    // Taxable 300 000 − 100 000 = 200 000 → 38 194,35.
    const r = territorialiteDmtg.compute({
      domicile_donateur_france: true,
      domicile_beneficiaire_france: false,
      biens_france: 100_000,
      biens_etranger: 200_000,
      lien: "enfant",
      mode: "donation",
      abattement_consomme: 0,
    });
    expect(r.kpis[0].value).toBe(eur(300_000));
    expect(r.kpis[1].value).toBe(eur(38_194.35));
  });
  it("tous deux hors de France → seuls les biens français (150 000 €) sont taxés", () => {
    // Taxable 150 000 − 100 000 = 50 000 → 1 380,75 + 34 068 × 20 % = 8 194,35.
    const r = territorialiteDmtg.compute({
      domicile_donateur_france: false,
      domicile_beneficiaire_france: false,
      biens_france: 150_000,
      biens_etranger: 500_000,
      lien: "enfant",
      mode: "donation",
      abattement_consomme: 0,
    });
    expect(r.kpis[0].value).toBe(eur(150_000));
    expect(r.kpis[1].value).toBe(eur(8_194.35));
  });
  it("bénéficiaire en France depuis 6 des 10 dernières années → assiette mondiale", () => {
    const r = territorialiteDmtg.compute({
      domicile_donateur_france: false,
      domicile_beneficiaire_france: true,
      beneficiaire_6_des_10: true,
      biens_france: 150_000,
      biens_etranger: 500_000,
      lien: "enfant",
      mode: "donation",
      abattement_consomme: 0,
    });
    expect(r.kpis[0].value).toBe(eur(650_000));
  });
});

describe("dernier-vivant", () => {
  it("800 000 €, 2 enfants, conjoint de 75 ans → meilleure option : 1/4 PP + 3/4 US (380 000 €)", () => {
    // Usufruit 75 ans = 30 % (art. 669). (a) 800 000 × 30 % = 240 000 ;
    // (b) 200 000 + 600 000 × 30 % = 380 000 ; (c) QD 1/3 → 266 666,67.
    const r = dernierVivant.compute({ actif_successoral: 800_000, nb_enfants: 2, age_conjoint: 75 });
    expect(r.kpis[0].value).toBe(eur(380_000)); // meilleure option
    expect(r.kpis[1].value).toBe(eur(240_000)); // option a
    expect(r.kpis[2].value).toBe(eur(380_000)); // option b
    expect(r.kpis[3].value).toBe(eur(266_666.67)); // option c
  });
  it("600 000 €, 1 enfant, conjoint de 85 ans → la quotité disponible 1/2 l'emporte (300 000 €)", () => {
    // Usufruit 85 ans = 20 %. (a) 120 000 ; (b) 150 000 + 450 000 × 20 % = 240 000 ;
    // (c) QD 1/2 → 300 000.
    const r = dernierVivant.compute({ actif_successoral: 600_000, nb_enfants: 1, age_conjoint: 85 });
    expect(r.kpis[0].value).toBe(eur(300_000));
    expect(r.kpis[0].hint).toContain("Quotité disponible");
    expect(r.kpis[2].value).toBe(eur(240_000));
  });
});

describe("cohérence du lot", () => {
  const defs = [
    donationNette,
    dptReinco,
    graduelleResiduelle,
    donationPartageSoulte,
    donationGfa,
    exoPartage,
    territorialiteDmtg,
    dernierVivant,
  ];
  it("ids attendus, uniques, compute et refs définis partout", () => {
    expect(defs.map((d) => d.id)).toEqual([
      "donation-nette",
      "dpt-reinco",
      "graduelle-residuelle",
      "donation-partage-soulte",
      "donation-gfa",
      "exo-partage",
      "territorialite-dmtg",
      "dernier-vivant",
    ]);
    expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length);
    for (const d of defs) {
      expect(typeof d.compute).toBe("function");
      expect(d.fields.length).toBeGreaterThan(0);
      expect(d.category).toBe("transmission");
    }
  });
});
