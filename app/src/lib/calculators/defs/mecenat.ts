// Mécénat d'entreprise (art. 238 bis CGI) : réduction d'IS de 60 % des
// versements jusqu'à 2 M€ de dons annuels, 40 % au-delà (60 % maintenu pour les
// organismes d'aide aux personnes en difficulté), dans la limite annuelle de
// max(20 000 €, 0,5 % du CA) — l'excédent est reportable 5 ans.

import type { CalculatorDef } from "../types";
import { eur, num, bool } from "../types";

// Paramètres de l'art. 238 bis CGI (état 2026).
const TAUX_60 = 0.6;
const TAUX_40 = 0.4;
const SEUIL_2M = 2_000_000; // dons annuels au-delà desquels le taux passe à 40 %
const PLANCHER_PLAFOND = 20_000; // plafond alternatif au 0,5 % du CA
const PLAFOND_CA = 0.005;

const def: CalculatorDef = {
  id: "mecenat",
  title: "Mécénat d'entreprise",
  description:
    "Réduction d'IS au titre du mécénat (art. 238 bis CGI) : 60 % des versements (40 % au-delà de 2 M€), plafond annuel de 20 000 € ou 0,5 % du CA, excédent reportable 5 ans.",
  category: "transmission",
  aliases: ["238 bis", "réduction IS dons", "dons entreprise", "mécénat IS"],
  fields: [
    { key: "dons", label: "Dons versés dans l'année", type: "eur", min: 0 },
    { key: "ca", label: "Chiffre d'affaires HT", type: "eur", min: 0 },
    {
      key: "repas_difficulte",
      label: "Dons à des organismes d'aide aux personnes en difficulté",
      type: "bool",
      default: false,
      help: "Fourniture gratuite de repas, soins, logement (« amendement Coluche ») : le taux de 60 % est maintenu quel que soit le montant.",
    },
  ],
  compute(v) {
    const dons = num(v, "dons");
    const ca = num(v, "ca");
    const coluche = bool(v, "repas_difficulte");

    // Plafond annuel des versements retenus : max(20 000 €, 0,5 % du CA).
    const plafond = Math.max(PLANCHER_PLAFOND, ca * PLAFOND_CA);
    const retenus = Math.min(dons, plafond);

    // Réduction d'IS : 60 % jusqu'à 2 M€ de dons, 40 % au-delà — sauf organismes
    // d'aide aux personnes en difficulté (60 % sans limite de montant).
    const reduction = coluche
      ? retenus * TAUX_60
      : Math.min(retenus, SEUIL_2M) * TAUX_60 + Math.max(0, retenus - SEUIL_2M) * TAUX_40;

    const excedent = dons - retenus;
    const coutNet = dons - reduction;

    return {
      kpis: [
        { label: "Réduction d'IS", value: eur(reduction), tone: "ok" },
        { label: "Coût net du don", value: eur(coutNet), hint: `Pour ${eur(dons)} versés` },
        {
          label: "Excédent reportable (5 ans)",
          value: eur(excedent),
          hint: excedent > 0 ? `Plafond annuel : ${eur(plafond)}` : undefined,
        },
      ],
      tables: [
        {
          title: "Détail du calcul",
          columns: ["Élément", "Montant"],
          rows: [
            ["Dons versés", eur(dons)],
            ["Plafond annuel (max de 20 000 € et 0,5 % du CA)", eur(plafond)],
            ["Versements retenus", eur(retenus)],
            ["Réduction d'IS", eur(reduction)],
            ["Excédent reporté", eur(excedent)],
          ],
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Répartition du don",
          items: [
            { label: "Coût net pour l'entreprise", value: coutNet },
            { label: "Réduction d'IS", value: reduction },
          ],
        },
      ],
      notes: [
        "L'excédent au-delà du plafond annuel est reportable sur les 5 exercices suivants, dans la même limite annuelle.",
        "La réduction s'impute sur l'IS dû ; elle n'est pas restituable mais l'excédent de réduction est lui aussi reportable 5 ans.",
        "Les dons en nature (produits, mécénat de compétences) sont valorisés au coût de revient ; certaines contreparties limitées (25 %) sont tolérées.",
      ],
      refs: ["Art. 238 bis CGI"],
    };
  },
};

export default def;
