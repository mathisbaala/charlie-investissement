// Donation-partage transgénérationnelle avec réincorporation (art. 776 A CGI) :
// des biens donnés autrefois aux ENFANTS sont réincorporés dans une nouvelle
// donation-partage au profit des PETITS-ENFANTS. L'intérêt fiscal : si la
// donation initiale a plus de 15 ans, la réattribution n'est PAS un nouveau
// DMTG — seul le droit de partage de 2,5 % (art. 746) est dû. Sinon, DMTG au
// tarif petit-enfant sur la valeur réincorporée, avec imputation des droits
// acquittés lors de la donation initiale (art. 776 A al. 3) pour éviter la
// double taxation, plus le droit de partage.

import type { CalculatorDef, CalcValues } from "../types";
import { eur, num, bool } from "../types";
import { DROIT_PARTAGE_GENERAL } from "../bareme";
import { dmtgPourBase } from "./_lotA";

const def: CalculatorDef = {
  id: "dpt-reinco",
  title: "Donation-partage transgénérationnelle avec réincorporation",
  description:
    "Réincorporation de donations antérieures dans une donation-partage au profit des petits-enfants : DMTG ou simple droit de partage de 2,5 %.",
  category: "transmission",
  aliases: ["776 A", "réincorporation", "donation-partage transgénérationnelle", "saut de génération"],
  fields: [
    { key: "valeur_reincorporee", label: "Valeur des biens réincorporés (au jour de l'acte)", type: "eur", min: 0 },
    {
      key: "donation_initiale_plus_15_ans",
      label: "Donation initiale de plus de 15 ans",
      type: "bool",
      default: false,
      help: "Si oui, seul le droit de partage de 2,5 % est dû — aucun DMTG (art. 776 A CGI).",
    },
    {
      key: "droits_payes_initialement",
      label: "Droits payés lors de la donation initiale",
      type: "eur",
      default: 0,
      min: 0,
      help: "Imputés sur les DMTG dus par le petit-enfant (sans restitution possible).",
      showIf: (v: CalcValues) => v.donation_initiale_plus_15_ans !== true,
    },
    {
      key: "abattement_consomme",
      label: "Abattement petit-enfant déjà consommé",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations de moins de 15 ans du même grand-parent au même petit-enfant (art. 784 CGI).",
    },
  ],
  compute(v) {
    const valeur = num(v, "valeur_reincorporee");
    const plus15 = bool(v, "donation_initiale_plus_15_ans");
    const droitsInitiaux = num(v, "droits_payes_initialement");
    const consomme = num(v, "abattement_consomme");

    // Droit de partage : la réincorporation dans une DP vaut partage (2,5 %).
    const droitPartage = valeur * DROIT_PARTAGE_GENERAL;

    // DMTG au tarif petit-enfant (ligne directe, abattement 31 865 € restant),
    // dû seulement si la donation initiale a moins de 15 ans.
    let dmtg = 0;
    if (!plus15) {
      const bruts = dmtgPourBase("petit_enfant", "donation", valeur, consomme).droits;
      // Imputation des droits initiaux : plancher 0, jamais de restitution.
      dmtg = Math.max(0, bruts - droitsInitiaux);
    }
    const total = dmtg + droitPartage;

    // Référence : donation simple au petit-enfant (DMTG plein, sans le mécanisme 776 A).
    const donationSimple = dmtgPourBase("petit_enfant", "donation", valeur, consomme).droits;

    return {
      kpis: [
        { label: "Total dû", value: eur(total), tone: total > 0 ? "bad" : "ok" },
        { label: "dont DMTG petit-enfant", value: eur(dmtg) },
        { label: "dont droit de partage (2,5 %)", value: eur(droitPartage) },
        {
          label: "Donation simple au petit-enfant (référence)",
          value: eur(donationSimple),
          hint: donationSimple > total ? `Économie : ${eur(donationSimple - total)}` : undefined,
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Coût fiscal comparé",
          items: [
            { label: "Réincorporation en DP transgénérationnelle", value: total },
            { label: "Donation simple au petit-enfant", value: donationSimple },
          ],
        },
      ],
      notes: [
        plus15
          ? "Donation initiale de plus de 15 ans : la réattribution au petit-enfant échappe aux DMTG, seul le droit de partage est dû (art. 776 A CGI)."
          : "Donation initiale de moins de 15 ans : DMTG au tarif petit-enfant sur la valeur réincorporée, avec imputation des droits payés initialement (plancher 0).",
        "Suppose l'accord de l'enfant donataire initial (la réincorporation exige son consentement à l'acte).",
      ],
      refs: ["Art. 776 A CGI", "Art. 778 bis CGI", "Art. 746 CGI", "Art. 784 B CGI"],
    };
  },
};

export default def;
