// Clause de préciput (art. 1515 à 1519 C.civ.) : le conjoint survivant
// prélève un bien de la communauté AVANT tout partage. Ce n'est ni une
// donation ni un legs (avantage matrimonial) → aucun DMTG (le conjoint est de
// toute façon exonéré), et la Cour de cassation a jugé (1re civ., 17 janv.
// 2024, n° 21-20.520) que le prélèvement préciputaire N'EST PAS une opération
// de partage → pas de droit de partage non plus, contrairement à ce que
// soutenait l'administration. Une « position prudente » consiste néanmoins à
// provisionner les 2,5 % en cas de contestation ou de revirement.

import type { CalculatorDef } from "../types";
import { eur, pct, num, bool } from "../types";
import { DROIT_PARTAGE_GENERAL } from "../bareme";

const def: CalculatorDef = {
  id: "preciput",
  title: "Clause de préciput",
  description:
    "Coût fiscal (nul depuis Cass. 2024) et avantage civil du prélèvement préciputaire du conjoint survivant.",
  category: "transmission",
  aliases: ["préciput", "avantage matrimonial", "prélèvement avant partage", "1515 code civil"],
  fields: [
    {
      key: "valeur_bien",
      label: "Valeur du bien prélevé",
      type: "eur",
      min: 0,
      help: "Bien commun prélevé par le conjoint survivant avant partage (résidence, assurance-vie…).",
    },
    {
      key: "position_prudente",
      label: "Position prudente",
      type: "bool",
      default: false,
      help: "Provisionner le droit de partage de 2,5 % en cas de contestation.",
    },
  ],
  compute(v) {
    const valeur = num(v, "valeur_bien");
    const prudent = bool(v, "position_prudente");
    // Position de principe post-Cass. 2024 : coût fiscal NUL. La provision
    // n'est pas un impôt dû, seulement une réserve de précaution.
    const provision = prudent ? valeur * DROIT_PARTAGE_GENERAL : 0;

    return {
      kpis: [
        { label: "Coût fiscal", value: eur(0), tone: "ok", hint: "Ni DMTG ni droit de partage (Cass. 1re civ., 17 janv. 2024)" },
        {
          label: "Provision éventuelle",
          value: eur(provision),
          hint: prudent ? `Droit de partage de ${pct(DROIT_PARTAGE_GENERAL * 100)} provisionné par prudence` : "Aucune provision",
        },
        { label: "Valeur soustraite au partage", value: eur(valeur), tone: "ok" },
      ],
      notes: [
        "Le préciput est un avantage matrimonial : ni donation ni legs — les enfants ne peuvent pas réclamer le bien au partage.",
        "Cass. 1re civ., 17 janv. 2024 : le prélèvement préciputaire n'est pas une opération de partage — pas de droit de partage (l'administration soutenait l'inverse).",
        "Limites civiles : récompenses éventuelles dues à la communauté, et action en retranchement en présence d'enfants non communs (art. 1527 C.civ.).",
      ],
      refs: ["Art. 1515 à 1519 C.civ.", "Cass. 1re civ., 17 janv. 2024, n° 21-20.520", "Art. 746 CGI"],
    };
  },
};

export default def;
