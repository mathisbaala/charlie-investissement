// Droits d'enregistrement de cession : SAS vs SARL (art. 726 CGI). Actions
// (SAS) : 0,1 % du prix. Parts sociales (SARL) : 3 % après abattement de
// 23 000 € proratisé au pourcentage de parts cédées.

import type { CalculatorDef } from "../types";
import { eur, num } from "../types";

// Taux de l'art. 726 CGI (I 1° et 1° bis) — stables depuis 2012.
const TAUX_ACTIONS = 0.001; // 0,1 %
const TAUX_PARTS = 0.03; // 3 %
const ABATTEMENT_PARTS = 23_000; // proratisé aux parts cédées

const def: CalculatorDef = {
  id: "comparaison-sas-sarl",
  title: "Droits de cession : SAS vs SARL",
  description:
    "Compare les droits d'enregistrement d'une cession d'actions (SAS, 0,1 %) et de parts sociales (SARL, 3 % après abattement de 23 000 €) — art. 726 CGI.",
  category: "transmission",
  aliases: ["transformation SARL en SAS", "726 CGI", "cession de parts vs actions", "droits d'enregistrement cession"],
  fields: [
    { key: "prix_cession", label: "Prix de cession", type: "eur", min: 0 },
    {
      key: "pct_cede",
      label: "Pourcentage du capital cédé",
      type: "pct",
      default: 100,
      min: 0,
      max: 100,
      help: "L'abattement de 23 000 € est proratisé : 23 000 € × (parts cédées / total des parts).",
    },
  ],
  compute(v) {
    const prix = num(v, "prix_cession");
    const pctCede = num(v, "pct_cede") / 100;

    // SAS — cession d'actions : 0,1 % du prix, sans abattement.
    const droitsSas = prix * TAUX_ACTIONS;

    // SARL — cession de parts sociales : 3 % après abattement proratisé.
    const abattement = ABATTEMENT_PARTS * pctCede;
    const droitsSarl = Math.max(0, prix - abattement) * TAUX_PARTS;

    const economie = droitsSarl - droitsSas;

    return {
      kpis: [
        { label: "Droits SAS (actions, 0,1 %)", value: eur(droitsSas) },
        { label: "Droits SARL (parts, 3 %)", value: eur(droitsSarl), tone: droitsSarl > droitsSas ? "bad" : undefined },
        {
          label: "Économie via transformation en SAS",
          value: eur(economie),
          hint: "Avant frais de transformation",
          tone: "ok",
        },
      ],
      tables: [
        {
          title: "Détail des deux régimes",
          columns: ["Forme", "Assiette après abattement", "Taux", "Droits"],
          rows: [
            ["SAS — actions", eur(prix), "0,1 %", eur(droitsSas)],
            ["SARL — parts sociales", eur(Math.max(0, prix - abattement)), "3 %", eur(droitsSarl)],
          ],
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Droits d'enregistrement",
          items: [
            { label: "SAS (actions)", value: droitsSas },
            { label: "SARL (parts)", value: droitsSarl },
          ],
        },
      ],
      notes: [
        "Les droits d'enregistrement sont dus par l'ACQUÉREUR (art. 1712 CGI) — l'économie profite à l'acheteur, mais pèse en pratique sur la négociation du prix.",
        "La transformation SARL → SAS doit être ANTÉRIEURE à la cession et a un coût propre (formalités, éventuel commissaire à la transformation) à mettre en regard de l'économie.",
        "Sociétés à prépondérance immobilière : 5 % dans les deux cas (art. 726 I 2°) — hors périmètre de ce comparateur.",
      ],
      refs: ["Art. 726 CGI"],
    };
  },
};

export default def;
