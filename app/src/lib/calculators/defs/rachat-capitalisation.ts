// Fiscalité d'un rachat (total ou partiel) de contrat de capitalisation —
// art. 125-0 A CGI : même régime que l'assurance-vie. Seule la part de PRODUITS
// contenue dans le rachat est imposée (PS 17,2 % + IR selon l'ancienneté).

import type { CalculatorDef } from "../types";
import { eur, num, str, bool } from "../types";

// Taux du régime des rachats (art. 125-0 A et 200 A CGI) — stables depuis 2018.
const TAUX_PS = 0.172; // prélèvements sociaux
const TAUX_PFU = 0.128; // IR au PFU (< 8 ans, ou fraction des primes > 150 000 €)
const TAUX_REDUIT_8ANS = 0.075; // IR après 8 ans (primes ≤ 150 000 €)
const ABATTEMENT_8ANS_SEUL = 4_600;
const ABATTEMENT_8ANS_COUPLE = 9_200;

const def: CalculatorDef = {
  id: "rachat-capitalisation",
  title: "Fiscalité d'un rachat de contrat de capitalisation",
  description:
    "Impôt sur un rachat de contrat de capitalisation (art. 125-0 A CGI — même régime que l'assurance-vie) : part de produits, PS 17,2 %, IR selon l'ancienneté.",
  category: "transmission",
  aliases: ["rachat capi", "125-0 A", "rachat partiel capitalisation", "PFU rachat"],
  fields: [
    { key: "valeur_contrat", label: "Valeur actuelle du contrat", type: "eur", min: 0 },
    { key: "versements", label: "Total des versements (primes)", type: "eur", min: 0 },
    { key: "montant_rachat", label: "Montant du rachat", type: "eur", min: 0 },
    {
      key: "anciennete",
      label: "Ancienneté du contrat",
      type: "enum",
      options: [
        { value: "moins_8", label: "Moins de 8 ans" },
        { value: "plus_8", label: "8 ans et plus" },
      ],
      default: "plus_8",
    },
    {
      key: "couple",
      label: "Imposition commune (couple)",
      type: "bool",
      default: false,
      help: "Abattement annuel de 9 200 € au lieu de 4 600 € sur les produits.",
      showIf: (v) => str(v, "anciennete") === "plus_8",
    },
    {
      key: "primes_sup_150k",
      label: "Encours de primes supérieur à 150 000 €",
      type: "bool",
      default: false,
      help: "Au-delà de 150 000 € de primes (tous contrats), la fraction correspondante des produits est au PFU 12,8 % au lieu de 7,5 %.",
      showIf: (v) => str(v, "anciennete") === "plus_8",
    },
  ],
  compute(v) {
    const valeur = num(v, "valeur_contrat");
    const versements = num(v, "versements");
    const rachat = num(v, "montant_rachat");
    const apres8 = str(v, "anciennete") === "plus_8";

    // Part de produits dans le rachat : rachat × (valeur − versements) / valeur.
    const produits = valeur > 0 ? rachat * (Math.max(0, valeur - versements) / valeur) : 0;

    // PS 17,2 % dans tous les cas, sur les produits.
    const ps = produits * TAUX_PS;

    // IR : PFU 12,8 % avant 8 ans ; après 8 ans, abattement annuel puis 7,5 %
    // (primes ≤ 150 000 €) ou 12,8 % au-delà.
    let ir = 0;
    let abattement = 0;
    if (apres8) {
      abattement = bool(v, "couple") ? ABATTEMENT_8ANS_COUPLE : ABATTEMENT_8ANS_SEUL;
      const taxable = Math.max(0, produits - abattement);
      ir = taxable * (bool(v, "primes_sup_150k") ? TAUX_PFU : TAUX_REDUIT_8ANS);
    } else {
      ir = produits * TAUX_PFU;
    }

    const total = ir + ps;
    const net = rachat - total;

    const notes = [
      `Part de produits dans le rachat : ${eur(produits)} (proratisation art. 125-0 A). Le reste du rachat est un remboursement de versements, non imposé.`,
      "Les prélèvements sociaux (17,2 %) s'appliquent quelle que soit l'ancienneté. Sur les fonds en euros, ils sont en pratique déjà prélevés au fil de l'eau — ne pas les compter deux fois.",
    ];
    if (apres8) {
      notes.push(
        `Abattement annuel de ${eur(abattement)} appliqué sur les produits (tous rachats de l'année confondus, contrats d'assurance-vie inclus).`,
      );
      if (bool(v, "primes_sup_150k")) {
        notes.push(
          "Simplification : la totalité des produits est retenue au PFU 12,8 %. En réalité, seule la fraction des produits issue des primes au-delà de 150 000 € est à 12,8 %, le reste à 7,5 %.",
        );
      }
    }

    return {
      kpis: [
        { label: "Impôt total sur le rachat", value: eur(total), tone: total > 0 ? "bad" : "ok" },
        { label: "Dont impôt sur le revenu", value: eur(ir) },
        { label: "Dont prélèvements sociaux", value: eur(ps) },
        { label: "Net perçu", value: eur(net), tone: "ok" },
      ],
      charts: [
        {
          type: "donut",
          title: "Répartition du rachat",
          items: [
            { label: "Net perçu", value: net },
            { label: "Impôts", value: total },
          ],
        },
      ],
      notes,
      refs: ["Art. 125-0 A CGI", "Art. 200 A CGI"],
    };
  },
};

export default def;
