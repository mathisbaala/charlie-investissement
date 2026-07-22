// Tests du lot B — paiement des droits (différé, fractionné, pénalités),
// régimes matrimoniaux (masse, comparaison, préciput), réversion d'usufruit et
// holding animatrice. Chaque cas chiffré est recalculé À LA MAIN depuis la
// mécanique (barèmes art. 777/669, intérêts simples…) — jamais recopié depuis
// la sortie du code. Le registre n'étant pas modifié par le lot B, les defs
// sont importées directement.

import { describe, it, expect } from "vitest";
import { eur, pct } from "../lib/calculators/types";
import { masseSelonRegime } from "../lib/calculators/defs/_lotB";
import differePaiement from "../lib/calculators/defs/differe-paiement";
import paiementFractionne from "../lib/calculators/defs/paiement-fractionne";
import penalitesSuccession from "../lib/calculators/defs/penalites-succession";
import masseSuccessorale from "../lib/calculators/defs/masse-successorale";
import compareRegimes from "../lib/calculators/defs/compare-regimes-matrimoniaux";
import preciput from "../lib/calculators/defs/preciput";
import reversionUsufruit from "../lib/calculators/defs/reversion-usufruit";
import holdingAnimatrice from "../lib/calculators/defs/holding-animatrice-evaluation";

describe("differe-paiement", () => {
  it("avec intérêts : 100 000 € à 2,9 % sur 10 ans → 29 000 € d'intérêts, 129 000 € au total", () => {
    // Intérêts simples : 100 000 × 2,9 % × 10 = 29 000.
    const r = differePaiement.compute({
      droits_dus: 100_000, option: "interets", duree_estimee_annees: 10, taux_annuel: 2.9,
    });
    expect(r.kpis[0].value).toBe(eur(129_000));
    expect(r.kpis[1].value).toBe(eur(29_000));
  });
  it("sans intérêts : coût = droits liquidés sur la pleine propriété, intérêts nuls", () => {
    const r = differePaiement.compute({
      droits_dus: 100_000, option: "sans_interets", duree_estimee_annees: 10, taux_annuel: 2.9,
      droits_sur_pp: 150_000,
    });
    expect(r.kpis[0].value).toBe(eur(150_000));
    expect(r.kpis[1].value).toBe(eur(0));
    // Les deux chiffrages sont présents → table comparative des deux options.
    expect(r.tables?.[0].rows).toHaveLength(2);
    expect(r.tables?.[0].rows[0][3]).toBe(eur(129_000));
  });
});

describe("paiement-fractionne", () => {
  it("cas général : 100 000 € à 2,9 % → 3 versements, 1 450 € d'intérêts", () => {
    // Versements de 33 333,33 € à 0/6/12 mois. Intérêts semestriels sur le
    // capital restant dû : 66 666,67 × 1,45 % + 33 333,33 × 1,45 %
    // = 966,67 + 483,33 = 1 450.
    const r = paiementFractionne.compute({ droits_dus: 100_000, actif_non_liquide_50: false, taux_annuel: 2.9 });
    expect(r.kpis[0].value).toBe(eur(101_450));
    expect(r.kpis[1].value).toBe(eur(1_450));
    expect(r.kpis[2].value).toBe("3 versements sur 12 mois");
    expect(r.tables?.[0].rows).toHaveLength(3);
  });
  it("actif non liquide ≥ 50 % : 140 000 € à 2,9 % → 7 versements, 6 090 € d'intérêts", () => {
    // Capital 20 000 €/versement ; intérêts = 20 000 × 1,45 % × (6+5+4+3+2+1)
    // = 290 × 21 = 6 090.
    const r = paiementFractionne.compute({ droits_dus: 140_000, actif_non_liquide_50: true, taux_annuel: 2.9 });
    expect(r.kpis[0].value).toBe(eur(146_090));
    expect(r.kpis[1].value).toBe(eur(6_090));
    expect(r.kpis[2].value).toBe("7 versements sur 36 mois");
    // 1er versement sans intérêt, dernier sur un seul capital restant.
    expect(r.tables?.[0].rows[0][2]).toBe(eur(0));
    expect(r.tables?.[0].rows[6][2]).toBe(eur(20_000 * 0.0145));
  });
});

describe("penalites-succession", () => {
  it("retard de 10 mois sur 100 000 € → 2 000 € d'intérêts, pas de majoration", () => {
    // 100 000 × 0,20 % × 10 = 2 000 ; retard ≤ 12 mois → pas de majoration.
    const r = penalitesSuccession.compute({ droits_dus: 100_000, mois_retard: 10, mise_en_demeure_90j: false });
    expect(r.kpis[0].value).toBe(eur(102_000));
    expect(r.kpis[1].value).toBe(eur(2_000));
    expect(r.kpis[2].value).toBe(eur(0));
  });
  it("retard de 15 mois sur 50 000 € → 1 500 € d'intérêts + 5 000 € de majoration (10 %)", () => {
    // 50 000 × 0,20 % × 15 = 1 500 ; > 12 mois → 10 % = 5 000.
    const r = penalitesSuccession.compute({ droits_dus: 50_000, mois_retard: 15, mise_en_demeure_90j: false });
    expect(r.kpis[0].value).toBe(eur(56_500));
    expect(r.kpis[1].value).toBe(eur(1_500));
    expect(r.kpis[2].value).toBe(eur(5_000));
  });
  it("mise en demeure sans effet 90 jours → majoration portée à 40 %", () => {
    // 50 000 × 40 % = 20 000 ; total = 50 000 + 1 500 + 20 000 = 71 500.
    const r = penalitesSuccession.compute({ droits_dus: 50_000, mois_retard: 15, mise_en_demeure_90j: true });
    expect(r.kpis[0].value).toBe(eur(71_500));
    expect(r.kpis[2].value).toBe(eur(20_000));
  });
});

describe("masse-successorale", () => {
  it("communauté légale : propres 100 000 + moitié de 400 000 → masse 300 000", () => {
    const r = masseSuccessorale.compute({
      regime: "communaute_legale", biens_communs: 400_000, propres_defunt: 100_000, propres_conjoint: 50_000,
    });
    expect(r.kpis[0].value).toBe(eur(300_000));
    // Conjoint hors succession : 50 000 propres + 200 000 de moitié de communauté.
    expect(r.kpis[1].value).toBe(eur(250_000));
  });
  it("communauté universelle : tout est commun → masse = (400 000 + 100 000 + 50 000)/2 = 275 000", () => {
    const r = masseSuccessorale.compute({
      regime: "communaute_universelle", biens_communs: 400_000, propres_defunt: 100_000, propres_conjoint: 50_000,
    });
    expect(r.kpis[0].value).toBe(eur(275_000));
    expect(r.kpis[1].value).toBe(eur(275_000));
  });
  it("attribution intégrale : masse nulle, tout au conjoint (550 000)", () => {
    const r = masseSuccessorale.compute({
      regime: "communaute_universelle_attribution", biens_communs: 400_000, propres_defunt: 100_000, propres_conjoint: 50_000,
    });
    expect(r.kpis[0].value).toBe(eur(0));
    expect(r.kpis[1].value).toBe(eur(550_000));
  });
  it("séparation de biens : masse = propres du défunt seulement", () => {
    const r = masseSuccessorale.compute({ regime: "separation", propres_defunt: 100_000, propres_conjoint: 50_000 });
    expect(r.kpis[0].value).toBe(eur(100_000));
    expect(r.kpis[1].value).toBe(eur(50_000));
  });
  it("participation aux acquêts : la créance due au conjoint vient en déduction de la masse", () => {
    // Créance = (300 000 − 100 000)/2 = 100 000 due au conjoint.
    // Masse = 200 000 + 300 000 − 100 000 = 400 000 ;
    // conjoint = 100 000 + 100 000 + 100 000 = 300 000.
    const r = masseSuccessorale.compute({
      regime: "participation", propres_defunt: 200_000, propres_conjoint: 100_000,
      acquets_defunt: 300_000, acquets_conjoint: 100_000,
    });
    expect(r.kpis[0].value).toBe(eur(400_000));
    expect(r.kpis[1].value).toBe(eur(300_000));
    expect(r.kpis[2].value).toBe(eur(100_000));
  });
  it("participation, conjoint enrichi davantage : la succession encaisse la créance", () => {
    // Créance = (100 000 − 300 000)/2 = −100 000 : due PAR le conjoint.
    // Masse = 200 000 + 100 000 + 100 000 = 400 000.
    const r = masseSelonRegime("participation", {
      propresDefunt: 200_000, propresConjoint: 100_000, biensCommuns: 0,
      acquetsDefunt: 100_000, acquetsConjoint: 300_000,
    });
    expect(r.masse).toBe(400_000);
    expect(r.creanceParticipation).toBe(-100_000);
  });
});

describe("compare-regimes-matrimoniaux", () => {
  const base = { biens_communs: 400_000, propres_defunt: 100_000, propres_conjoint: 50_000 };
  it("acquêts 50/50 : min 0 (attribution intégrale), max 300 000, écart 300 000", () => {
    const r = compareRegimes.compute({ ...base, part_acquets_defunt: 50 });
    expect(r.kpis[0].value).toBe(eur(0));
    expect(r.kpis[1].value).toBe(eur(300_000));
    expect(r.kpis[2].value).toBe(eur(300_000));
    // Ligne universelle : masse (400 000 + 100 000 + 50 000)/2 = 275 000.
    expect(r.tables?.[0].rows[1][2]).toBe(eur(275_000));
    expect(r.charts?.[0].items).toHaveLength(5);
  });
  it("acquêts 75 % au nom du défunt : séparation 400 000, participation ramenée à 300 000 par la créance", () => {
    // Séparation : 100 000 + 400 000 × 75 % = 400 000.
    // Participation : créance = (300 000 − 100 000)/2 = 100 000 →
    // masse = 100 000 + 300 000 − 100 000 = 300 000.
    const r = compareRegimes.compute({ ...base, part_acquets_defunt: 75 });
    expect(r.tables?.[0].rows[3][2]).toBe(eur(400_000));
    expect(r.tables?.[0].rows[4][2]).toBe(eur(300_000));
    // Conjoint hors succession en participation : 50 000 + 100 000 + 100 000.
    expect(r.tables?.[0].rows[4][1]).toBe(eur(250_000));
  });
});

describe("preciput", () => {
  it("position de principe : coût fiscal nul, bien de 800 000 € soustrait au partage", () => {
    const r = preciput.compute({ valeur_bien: 800_000, position_prudente: false });
    expect(r.kpis[0].value).toBe(eur(0));
    expect(r.kpis[1].value).toBe(eur(0));
    expect(r.kpis[2].value).toBe(eur(800_000));
  });
  it("position prudente : provision de 2,5 % → 20 000 € sur 800 000 €", () => {
    const r = preciput.compute({ valeur_bien: 800_000, position_prudente: true });
    expect(r.kpis[0].value).toBe(eur(0)); // le coût de principe reste nul
    expect(r.kpis[1].value).toBe(eur(20_000));
  });
});

describe("reversion-usufruit", () => {
  it("au profit du conjoint : exonération totale", () => {
    const r = reversionUsufruit.compute({ valeur_pleine_propriete: 1_000_000, beneficiaire: "conjoint" });
    expect(r.kpis[0].value).toBe(eur(0));
  });
  it("enfant de 65 ans, PP 1 M€ → usufruit 40 %, droits 58 194 €", () => {
    // Assiette = 1 000 000 × 40 % = 400 000 ; abattement 100 000 → 300 000
    // taxables. Barème ligne directe : 403,60 + 403,70 + 573,45 + 284 068 × 20 %
    // = 58 194,35 → 58 194 €.
    const r = reversionUsufruit.compute({
      valeur_pleine_propriete: 1_000_000, beneficiaire: "autre",
      lien: "enfant", age_beneficiaire: 65, abattement_consomme: 0,
    });
    expect(r.kpis[0].value).toBe(eur(58_194));
    expect(r.kpis[1].value).toBe(eur(400_000));
    expect(r.kpis[2].value).toBe(pct(40));
  });
  it("neveu de 75 ans, PP 500 000 € → usufruit 30 %, droits 78 118 €", () => {
    // Assiette = 500 000 × 30 % = 150 000 ; abattement 7 967 → 142 033
    // taxables à 55 % = 78 118,15 → 78 118 €.
    const r = reversionUsufruit.compute({
      valeur_pleine_propriete: 500_000, beneficiaire: "autre",
      lien: "neveu_niece", age_beneficiaire: 75, abattement_consomme: 0,
    });
    expect(r.kpis[0].value).toBe(eur(78_118));
    expect(r.kpis[2].value).toBe(pct(30));
  });
});

describe("holding-animatrice-evaluation", () => {
  it("ratio 60 % + contrôle + conduite → qualification probable", () => {
    // (6 M + 0)/10 M = 60 % > 50 %, tous les indices présents.
    const r = holdingAnimatrice.compute({
      actif_total: 10_000_000, participations_animees: 6_000_000, actifs_affectes_animation: 0,
      controle_effectif: true, conduite_politique_groupe: true, services_specifiques: true,
    });
    expect(r.kpis[0].value).toBe(pct(60));
    expect(r.kpis[1].value).toBe("Qualification probable");
    expect(r.kpis[1].tone).toBe("ok");
  });
  it("ratio exactement 50 % (non strictement supérieur) → qualification compromise", () => {
    // (4 M + 1 M)/10 M = 50 % : le seuil exige STRICTEMENT plus de 50 %.
    const r = holdingAnimatrice.compute({
      actif_total: 10_000_000, participations_animees: 4_000_000, actifs_affectes_animation: 1_000_000,
      controle_effectif: true, conduite_politique_groupe: true, services_specifiques: false,
    });
    expect(r.kpis[0].value).toBe(pct(50));
    expect(r.kpis[1].value).toBe("Qualification compromise");
    // Donut : 5 M animés / 5 M non animés.
    expect(r.charts?.[0].items[0].value).toBe(5_000_000);
    expect(r.charts?.[0].items[1].value).toBe(5_000_000);
  });
  it("ratio atteint mais indice qualitatif manquant → qualification fragile", () => {
    const r = holdingAnimatrice.compute({
      actif_total: 10_000_000, participations_animees: 6_000_000, actifs_affectes_animation: 0,
      controle_effectif: true, conduite_politique_groupe: false, services_specifiques: false,
    });
    expect(r.kpis[1].value).toBe("Qualification fragile");
    expect(r.kpis[1].tone).toBe("bad");
  });
});
