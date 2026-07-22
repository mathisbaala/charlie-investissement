// Paiement différé des droits de succession (art. 1722 bis ann. III CGI) —
// réservé aux successions comportant une dévolution de NUE-PROPRIÉTÉ : les
// droits ne sont exigibles que 6 mois après la réunion de l'usufruit à la
// nue-propriété (décès de l'usufruitier) ou la cession du bien. Deux options :
// différé AVEC intérêts (droits assis sur la nue-propriété), ou SANS intérêts
// si l'héritier accepte que les droits soient liquidés sur la valeur en PLEINE
// propriété (assiette plus large en échange de la gratuité du crédit).

import type { CalculatorDef } from "../types";
import { eur, num, str } from "../types";

const def: CalculatorDef = {
  id: "differe-paiement",
  title: "Paiement différé des droits de succession",
  description:
    "Coût du différé de paiement des droits (nue-propriété héritée) : intérêts annuels ou renonciation à la décote d'usufruit.",
  category: "transmission",
  aliases: ["différé de paiement", "crédit de paiement", "1722 bis", "paiement différé nue-propriété"],
  fields: [
    { key: "droits_dus", label: "Droits de succession dus", type: "eur", min: 0 },
    {
      key: "option",
      label: "Option de différé",
      type: "enum",
      options: [
        { value: "interets", label: "Différé avec intérêts (assiette nue-propriété)" },
        { value: "sans_interets", label: "Sans intérêts (droits liquidés sur la pleine propriété)" },
      ],
      default: "interets",
    },
    {
      key: "duree_estimee_annees",
      label: "Durée estimée du différé (années)",
      type: "int",
      default: 10,
      min: 0,
      help: "Jusqu'au décès prévisible de l'usufruitier (ou la cession du bien).",
    },
    {
      key: "taux_annuel",
      label: "Taux d'intérêt annuel",
      type: "pct",
      default: 2.9,
      min: 0,
      help: "Taux 2026 des crédits de paiement fractionné/différé — à vérifier pour l'année en cours.",
    },
    {
      key: "droits_sur_pp",
      label: "Droits recalculés sur la pleine propriété",
      type: "eur",
      min: 0,
      help: "Droits recalculés sur la valeur en pleine propriété (option sans intérêts).",
      showIf: (v) => v.option === "sans_interets",
    },
  ],
  compute(v) {
    const droits = num(v, "droits_dus");
    const duree = num(v, "duree_estimee_annees");
    const taux = num(v, "taux_annuel") / 100;
    const option = str(v, "option") || "interets";
    const droitsPP = num(v, "droits_sur_pp");

    // Intérêts SIMPLES annuels : le taux du crédit de paiement s'applique
    // chaque année au montant différé, sans capitalisation.
    const interets = droits * taux * duree;
    const coutAvecInterets = droits + interets;

    const sansInterets = option === "sans_interets";
    const cout = sansInterets ? droitsPP : coutAvecInterets;
    const dontInterets = sansInterets ? 0 : interets;

    const notes = [
      "Différé réservé aux successions comportant une dévolution de nue-propriété ; garanties exigées par le comptable public.",
      "Intérêts simples annuels au taux du crédit de paiement — la durée réelle dépend du décès de l'usufruitier ou de la cession.",
      "Option sans intérêts : les droits sont liquidés sur la valeur en pleine propriété (renonciation à la décote d'usufruit de l'art. 669 CGI).",
    ];

    // Comparaison des deux options quand les deux chiffrages sont disponibles :
    // c'est l'arbitrage réel du client (payer des intérêts vs élargir l'assiette).
    const tables =
      droits > 0 && droitsPP > 0
        ? [
            {
              title: "Comparaison des deux options",
              columns: ["Option", "Droits", "Intérêts", "Coût total"],
              rows: [
                ["Différé avec intérêts (nue-propriété)", eur(droits), eur(interets), eur(coutAvecInterets)],
                ["Sans intérêts (pleine propriété)", eur(droitsPP), eur(0), eur(droitsPP)],
              ],
            },
          ]
        : undefined;

    return {
      kpis: [
        { label: "Coût total du différé", value: eur(cout), tone: cout > 0 ? "bad" : "ok" },
        { label: "Dont intérêts", value: eur(dontInterets) },
        {
          label: "Échéance estimée",
          value: `${duree} ans`,
          hint: "Droits exigibles 6 mois après la réunion de l'usufruit ou la cession du bien.",
        },
      ],
      tables,
      notes,
      refs: ["Art. 1722 bis ann. III CGI", "BOI-ENR-DG-50-20-50"],
    };
  },
};

export default def;
