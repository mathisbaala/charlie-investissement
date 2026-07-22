// Tests du lot C (capitalisation, entreprise, IFI). Tous les montants attendus
// sont recalculés à la main depuis la mécanique fiscale (voir commentaires),
// jamais recopiés depuis la sortie du calculateur.

import { describe, it, expect } from "vitest";
import { eur } from "../lib/calculators/types";
import avVsCapitalisation from "../lib/calculators/defs/av-vs-capitalisation";
import rachatCapitalisation from "../lib/calculators/defs/rachat-capitalisation";
import transmissionCapitalisation from "../lib/calculators/defs/transmission-capitalisation";
import comparaisonSasSarl from "../lib/calculators/defs/comparaison-sas-sarl";
import droitsCession from "../lib/calculators/defs/droits-cession";
import mecenat from "../lib/calculators/defs/mecenat";
import ifi from "../lib/calculators/defs/ifi";
import ifiPlacements from "../lib/calculators/defs/ifi-placements-coefficient";

describe("av-vs-capitalisation", () => {
  it("1 M€ à un enfant : AV 186 094 € vs DMTG 212 962 €, écart 26 868 €", () => {
    // 990 I : (1 000 000 − 152 500) = 847 500 → 700 000×20 % + 147 500×31,25 % = 186 093,75.
    // DMTG (succession = donation pour un enfant) : base 900 000 après abattement 100 000
    // → 403,6 + 403,7 + 573,45 + 536 392×20 % + 347 676×30 % = 212 961,95.
    const r = avVsCapitalisation.compute({
      capital: 1_000_000, nb_beneficiaires: 1, lien: "enfant", abattement_consomme: 0,
    });
    expect(r.kpis[0].value).toBe("Assurance-vie (990 I)");
    expect(r.kpis[1].value).toBe(eur(26_868)); // 212 961,95 − 186 093,75
    expect(r.tables?.[0].rows[0][1]).toBe(eur(186_094));
    expect(r.tables?.[0].rows[1][1]).toBe(eur(212_962));
    expect(r.tables?.[0].rows[2][1]).toBe(eur(212_962));
  });
  it("400 000 € à un neveu : AV 49 500 € vs DMTG 215 618 € (55 % flat)", () => {
    // 990 I : (400 000 − 152 500) × 20 % = 49 500.
    // DMTG : (400 000 − 7 967) × 55 % = 215 618,15.
    const r = avVsCapitalisation.compute({
      capital: 400_000, nb_beneficiaires: 1, lien: "neveu_niece", abattement_consomme: 0,
    });
    expect(r.tables?.[0].rows[0][1]).toBe(eur(49_500));
    expect(r.tables?.[0].rows[1][1]).toBe(eur(215_618));
    expect(r.kpis[1].value).toBe(eur(166_118)); // 215 618,15 − 49 500
  });
  it("époux : AV et succession exonérées, seule la donation est taxée", () => {
    // Donation époux : (500 000 − 80 724) = 419 276 → 403,6 + 786 + 2 389,95
    // + 387 411×20 % = 81 061,75.
    const r = avVsCapitalisation.compute({
      capital: 500_000, nb_beneficiaires: 1, lien: "epoux", abattement_consomme: 0,
    });
    expect(r.tables?.[0].rows[0][1]).toBe(eur(0));
    expect(r.tables?.[0].rows[1][1]).toBe(eur(0));
    expect(r.tables?.[0].rows[2][1]).toBe(eur(81_062));
  });
});

describe("rachat-capitalisation", () => {
  it("moins de 8 ans : rachat 30 000 € (produits 10 000 €) → PFU 1 280 € + PS 1 720 €", () => {
    // Produits = 30 000 × (150 000 − 100 000)/150 000 = 10 000.
    // IR = 10 000 × 12,8 % = 1 280 ; PS = 10 000 × 17,2 % = 1 720 ; total 3 000.
    const r = rachatCapitalisation.compute({
      valeur_contrat: 150_000, versements: 100_000, montant_rachat: 30_000, anciennete: "moins_8",
    });
    expect(r.kpis[0].value).toBe(eur(3_000));
    expect(r.kpis[1].value).toBe(eur(1_280));
    expect(r.kpis[2].value).toBe(eur(1_720));
    expect(r.kpis[3].value).toBe(eur(27_000));
  });
  it("8 ans et plus (seul) : produits 20 000 €, abattement 4 600 € puis 7,5 %", () => {
    // Produits = 50 000 × 80 000/200 000 = 20 000. IR = (20 000 − 4 600) × 7,5 % = 1 155.
    // PS = 20 000 × 17,2 % = 3 440. Total 4 595 ; net 45 405.
    const r = rachatCapitalisation.compute({
      valeur_contrat: 200_000, versements: 120_000, montant_rachat: 50_000,
      anciennete: "plus_8", couple: false, primes_sup_150k: false,
    });
    expect(r.kpis[0].value).toBe(eur(4_595));
    expect(r.kpis[3].value).toBe(eur(45_405));
  });
  it("8 ans et plus, couple + primes > 150 k€ : abattement 9 200 € puis 12,8 %", () => {
    // IR = (20 000 − 9 200) × 12,8 % = 1 382,4 ; total = 3 440 + 1 382,4 = 4 822,4.
    const r = rachatCapitalisation.compute({
      valeur_contrat: 200_000, versements: 120_000, montant_rachat: 50_000,
      anciennete: "plus_8", couple: true, primes_sup_150k: true,
    });
    expect(r.kpis[1].value).toBe(eur(1_382));
    expect(r.kpis[0].value).toBe(eur(4_822));
  });
});

describe("transmission-capitalisation", () => {
  it("donation à un enfant : 300 000 € → 38 194 € de droits, purge 24 000 €", () => {
    // Base 200 000 après abattement 100 000 → 403,6 + 403,7 + 573,45
    // + 184 068×20 % = 38 194,35. Purge = 80 000 × 30 % = 24 000.
    const r = transmissionCapitalisation.compute({
      valeur_contrat: 300_000, produits_latents: 80_000, mode: "donation",
      lien: "enfant", abattement_consomme: 0, taux_produits: 30,
    });
    expect(r.kpis[0].value).toBe(eur(38_194));
    expect(r.kpis[2].value).toBe(eur(24_000));
    expect(r.kpis[3].value).toBe(eur(261_806)); // 300 000 − 38 194,35
  });
  it("succession au conjoint : exonérée, purge conservée", () => {
    const r = transmissionCapitalisation.compute({
      valeur_contrat: 500_000, produits_latents: 100_000, mode: "succession",
      lien: "epoux", abattement_consomme: 0, taux_produits: 30,
    });
    expect(r.kpis[0].value).toBe(eur(0));
    expect(r.kpis[2].value).toBe(eur(30_000));
    expect(r.kpis[3].value).toBe(eur(500_000));
  });
  it("l'abattement consommé augmente la base taxable", () => {
    // Abattement épuisé → base 150 000 : 403,6 + 403,7 + 573,45 + 134 068×20 % = 28 194,35.
    const r = transmissionCapitalisation.compute({
      valeur_contrat: 150_000, produits_latents: 0, mode: "donation",
      lien: "enfant", abattement_consomme: 100_000, taux_produits: 30,
    });
    expect(r.kpis[0].value).toBe(eur(28_194));
  });
});

describe("comparaison-sas-sarl", () => {
  it("1 M€ cédé à 100 % : SAS 1 000 € vs SARL 29 310 €", () => {
    // SAS = 1 000 000 × 0,1 % = 1 000. SARL = (1 000 000 − 23 000) × 3 % = 29 310.
    const r = comparaisonSasSarl.compute({ prix_cession: 1_000_000, pct_cede: 100 });
    expect(r.kpis[0].value).toBe(eur(1_000));
    expect(r.kpis[1].value).toBe(eur(29_310));
    expect(r.kpis[2].value).toBe(eur(28_310));
  });
  it("500 000 € pour 50 % du capital : abattement proratisé à 11 500 €", () => {
    // SARL = (500 000 − 23 000×50 %) × 3 % = 488 500 × 3 % = 14 655. SAS = 500.
    const r = comparaisonSasSarl.compute({ prix_cession: 500_000, pct_cede: 50 });
    expect(r.kpis[0].value).toBe(eur(500));
    expect(r.kpis[1].value).toBe(eur(14_655));
    expect(r.kpis[2].value).toBe(eur(14_155));
  });
});

describe("droits-cession", () => {
  it("fonds de commerce 500 000 € → 20 310 € (barème 719)", () => {
    // 0 % jusqu'à 23 000 ; (200 000 − 23 000)×3 % = 5 310 ; (500 000 − 200 000)×5 % = 15 000.
    const r = droitsCession.compute({ prix: 500_000, nature: "fonds" });
    expect(r.kpis[0].value).toBe(eur(20_310));
    expect(r.kpis[3].value).toBe(eur(520_310)); // coût acquéreur = prix + droits
    expect(r.tables?.[0].rows.length).toBe(3); // les 3 tranches du barème
  });
  it("actions 1 M€ → 1 000 € (0,1 %)", () => {
    const r = droitsCession.compute({ prix: 1_000_000, nature: "actions" });
    expect(r.kpis[0].value).toBe(eur(1_000));
  });
  it("parts sociales 300 000 € → 8 310 € (3 % après abattement 23 000 €)", () => {
    const r = droitsCession.compute({ prix: 300_000, nature: "parts", pct_cede: 100 });
    expect(r.kpis[0].value).toBe(eur(8_310));
  });
  it("prépondérance immobilière 400 000 € → 20 000 € (5 %)", () => {
    const r = droitsCession.compute({ prix: 400_000, nature: "ppi" });
    expect(r.kpis[0].value).toBe(eur(20_000));
  });
});

describe("mecenat", () => {
  it("100 000 € de dons, CA 50 M€ : réduction 60 000 €, coût net 40 000 €", () => {
    // Plafond = max(20 000, 250 000) = 250 000 → tout est retenu, 60 %.
    const r = mecenat.compute({ dons: 100_000, ca: 50_000_000, repas_difficulte: false });
    expect(r.kpis[0].value).toBe(eur(60_000));
    expect(r.kpis[1].value).toBe(eur(40_000));
    expect(r.kpis[2].value).toBe(eur(0));
  });
  it("plafond atteint : CA 2 M€ → 20 000 € retenus, 80 000 € reportés", () => {
    // Plafond = max(20 000, 10 000) = 20 000 ; réduction = 12 000 ; coût net = 88 000.
    const r = mecenat.compute({ dons: 100_000, ca: 2_000_000, repas_difficulte: false });
    expect(r.kpis[0].value).toBe(eur(12_000));
    expect(r.kpis[1].value).toBe(eur(88_000));
    expect(r.kpis[2].value).toBe(eur(80_000));
  });
  it("3 M€ de dons : 40 % au-delà de 2 M€, sauf aide aux personnes en difficulté", () => {
    // Plafond = 0,5 % × 1 Md€ = 5 M€. Réduction = 2 M×60 % + 1 M×40 % = 1,6 M€ ;
    // avec « amendement Coluche » : 3 M × 60 % = 1,8 M€.
    const std = mecenat.compute({ dons: 3_000_000, ca: 1_000_000_000, repas_difficulte: false });
    expect(std.kpis[0].value).toBe(eur(1_600_000));
    const coluche = mecenat.compute({ dons: 3_000_000, ca: 1_000_000_000, repas_difficulte: true });
    expect(coluche.kpis[0].value).toBe(eur(1_800_000));
  });
});

describe("ifi", () => {
  it("2 M€ taxables → 7 400 € (barème 977)", () => {
    // (1,3 M − 800 k)×0,5 % = 2 500 ; (2 M − 1,3 M)×0,7 % = 4 900.
    const r = ifi.compute({ patrimoine_immo_net: 2_000_000, residence_principale: 0, revenus: 0, autres_impots: 0 });
    expect(r.kpis[0].value).toBe(eur(7_400));
    expect(r.kpis[2].value).toBe(eur(0)); // pas de décote au-delà de 1,4 M€
  });
  it("1,35 M€ : décote de 625 € → IFI 2 225 €", () => {
    // Brut = 2 500 + 50 000×0,7 % = 2 850 ; décote = 17 500 − 1,25 %×1 350 000 = 625.
    const r = ifi.compute({ patrimoine_immo_net: 1_350_000, residence_principale: 0, revenus: 0, autres_impots: 0 });
    expect(r.kpis[0].value).toBe(eur(2_225));
    expect(r.kpis[2].value).toBe(eur(625));
  });
  it("1,2 M€ : sous le seuil de 1,3 M€ → pas d'IFI", () => {
    const r = ifi.compute({ patrimoine_immo_net: 1_200_000, residence_principale: 0, revenus: 0, autres_impots: 0 });
    expect(r.kpis[0].value).toBe(eur(0));
  });
  it("résidence principale : abattement de 30 % sur sa valeur", () => {
    // Assiette = 1 M + 1 M×70 % = 1,7 M → 2 500 + 400 000×0,7 % = 5 300.
    const r = ifi.compute({ patrimoine_immo_net: 1_000_000, residence_principale: 1_000_000, revenus: 0, autres_impots: 0 });
    expect(r.kpis[0].value).toBe(eur(5_300));
  });
  it("plafonnement à 75 % des revenus : 5 M€ de patrimoine, 20 000 € de revenus", () => {
    // Brut = 2 500 + 1 270 000×0,7 % + 2 430 000×1 % = 35 690.
    // Plafond = 75 %×20 000 = 15 000 ; déjà 10 000 d'IR/PS → IFI ramené à 5 000.
    const r = ifi.compute({ patrimoine_immo_net: 5_000_000, residence_principale: 0, revenus: 20_000, autres_impots: 10_000 });
    expect(r.kpis[0].value).toBe(eur(5_000));
    expect(r.kpis[3].value).toBe(eur(30_690)); // 35 690 − 5 000
  });
});

describe("ifi-placements-coefficient", () => {
  it("portefeuille mixte : SCPI 100 %, OPCI 90 %, UC 100 %, SIIC < 5 % exonérées", () => {
    // 100 000×100 % + 50 000×90 % + 30 000×100 % + 40 000×0 = 175 000.
    const r = ifiPlacements.compute({
      scpi: 100_000, coef_scpi: 100, opci: 50_000, coef_opci: 90,
      av_uc_immo: 30_000, coef_av: 100, siic: 40_000, siic_moins_5pct: true,
    });
    expect(r.kpis[0].value).toBe(eur(175_000));
    expect(r.kpis[1].value).toBe(eur(220_000));
    expect(r.kpis[2].value).toBe(eur(45_000));
  });
  it("SIIC ≥ 5 % : taxables en totalité", () => {
    const r = ifiPlacements.compute({ siic: 200_000, siic_moins_5pct: false });
    expect(r.kpis[0].value).toBe(eur(200_000));
    const exo = ifiPlacements.compute({ siic: 200_000, siic_moins_5pct: true });
    expect(exo.kpis[0].value).toBe(eur(0));
  });
});
