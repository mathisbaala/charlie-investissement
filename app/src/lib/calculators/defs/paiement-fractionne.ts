// Paiement fractionné des droits de succession (art. 1717 CGI, art. 404 A
// ann. III) : versements ÉGAUX espacés de 6 mois au plus — 3 versements sur
// 1 an dans le cas général, portés à 7 versements sur 3 ans lorsque l'actif
// héréditaire comprend au moins 50 % de biens non liquides (immeubles, parts
// sociales…). Intérêts au taux du crédit de paiement sur le capital restant dû.

import type { CalculatorDef, CalcTable } from "../types";
import { eur, num, bool } from "../types";

const def: CalculatorDef = {
  id: "paiement-fractionne",
  title: "Paiement fractionné des droits de succession",
  description:
    "Échéancier et coût du paiement fractionné des droits : 3 versements sur 1 an, ou 7 sur 3 ans si l'actif est peu liquide.",
  category: "transmission",
  aliases: ["fractionnement des droits", "crédit de paiement", "1717 CGI", "étalement droits de succession"],
  fields: [
    { key: "droits_dus", label: "Droits de succession dus", type: "eur", min: 0 },
    {
      key: "actif_non_liquide_50",
      label: "Actif héréditaire composé d'au moins 50 % de biens non liquides",
      type: "bool",
      default: false,
      help: "Immeubles, titres non cotés, entreprises… ouvre droit à 7 versements sur 3 ans (art. 404 A ann. III).",
    },
    {
      key: "taux_annuel",
      label: "Taux d'intérêt annuel",
      type: "pct",
      default: 2.9,
      min: 0,
      help: "Taux 2026 des crédits de paiement fractionné/différé — à vérifier pour l'année en cours.",
    },
  ],
  compute(v) {
    const droits = num(v, "droits_dus");
    const taux = num(v, "taux_annuel") / 100;
    // Cas général : 3 versements à 0, 6 et 12 mois. Actif non liquide ≥ 50 % :
    // 7 versements semestriels sur 3 ans (0 à 36 mois).
    const n = bool(v, "actif_non_liquide_50") ? 7 : 3;
    const dureeMois = 6 * (n - 1);
    const capitalParVersement = droits / n;

    // Échéancier : le 1er versement (mois 0) ne porte pas d'intérêt ; chaque
    // versement suivant paie un semestre d'intérêts (taux/2) sur le capital
    // restant dû AVANT ce versement.
    const echeancier: CalcTable["rows"] = [];
    let totalInterets = 0;
    for (let k = 0; k < n; k++) {
      const restantDu = droits - k * capitalParVersement;
      const interets = k === 0 ? 0 : restantDu * (taux / 2);
      totalInterets += interets;
      echeancier.push([
        `Mois ${6 * k}`,
        eur(capitalParVersement),
        eur(interets),
        eur(capitalParVersement + interets),
      ]);
    }
    const coutTotal = droits + totalInterets;

    return {
      kpis: [
        { label: "Coût total", value: eur(coutTotal), tone: coutTotal > 0 ? "bad" : "ok" },
        { label: "Dont intérêts", value: eur(totalInterets) },
        { label: "Versements", value: `${n} versements sur ${dureeMois} mois` },
      ],
      tables: [
        {
          title: "Échéancier",
          columns: ["Échéance", "Capital", "Intérêts", "Total"],
          rows: echeancier,
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Coût du fractionnement",
          items: [
            { label: "Droits", value: droits },
            { label: "Intérêts", value: totalInterets },
          ],
        },
      ],
      notes: [
        "Versements égaux espacés de 6 mois au plus ; demande à formuler dans la déclaration de succession, avec garanties.",
        "Le taux est celui en vigueur au jour de la demande, figé pour toute la durée du crédit.",
        "Intérêts calculés ici par semestre plein sur le capital restant dû (approximation de l'échéancier réel du comptable public).",
      ],
      refs: ["Art. 1717 CGI", "Art. 404 A ann. III CGI"],
    };
  },
};

export default def;
