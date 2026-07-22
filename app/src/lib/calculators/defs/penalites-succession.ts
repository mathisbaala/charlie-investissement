// Pénalités de retard sur la déclaration de succession : délai de dépôt de
// 6 mois en France métropolitaine (art. 641 CGI), puis intérêt de retard de
// 0,20 % PAR MOIS (art. 1727 CGI) décompté à partir du 1er jour du 7e mois,
// majoration de 10 % lorsque le retard excède 12 mois (art. 1728 CGI, à
// compter du 1er jour du 13e mois), portée à 40 % si une mise en demeure est
// restée sans effet 90 jours.

import type { CalculatorDef } from "../types";
import { eur, pct, num, bool } from "../types";

/** Intérêt de retard : 0,20 % par mois (art. 1727 III CGI, taux légal actuel). */
const INTERET_RETARD_MENSUEL = 0.002;

const def: CalculatorDef = {
  id: "penalites-succession",
  title: "Pénalités de retard (déclaration de succession)",
  description:
    "Intérêt de retard (0,20 %/mois) et majoration (10 % ou 40 %) pour dépôt tardif de la déclaration de succession.",
  category: "transmission",
  aliases: ["retard déclaration succession", "intérêt de retard", "majoration 10 %", "1728 CGI", "délai 6 mois"],
  fields: [
    { key: "droits_dus", label: "Droits de succession dus", type: "eur", min: 0 },
    {
      key: "mois_retard",
      label: "Mois de retard",
      type: "int",
      min: 0,
      help: "Mois entiers au-delà du délai de dépôt de 6 mois (France métropolitaine).",
    },
    {
      key: "mise_en_demeure_90j",
      label: "Mise en demeure restée sans effet 90 jours",
      type: "bool",
      default: false,
      help: "Porte la majoration à 40 % (art. 1728, 1, b CGI).",
    },
  ],
  compute(v) {
    const droits = num(v, "droits_dus");
    const mois = num(v, "mois_retard");
    const miseEnDemeure = bool(v, "mise_en_demeure_90j");

    // Intérêt de retard : linéaire, 0,20 % des droits par mois de retard.
    const interets = droits * INTERET_RETARD_MENSUEL * mois;

    // Majoration d'assiette : 40 % prime sur 10 % (la mise en demeure sans
    // effet aggrave le manquement, quel que soit le nombre de mois).
    const tauxMajoration = miseEnDemeure ? 0.4 : mois > 12 ? 0.1 : 0;
    const majoration = droits * tauxMajoration;

    const total = droits + interets + majoration;

    return {
      kpis: [
        { label: "Total dû", value: eur(total), tone: total > droits ? "bad" : "ok" },
        {
          label: "Intérêts de retard",
          value: eur(interets),
          hint: `${pct(INTERET_RETARD_MENSUEL * 100)} par mois × ${mois} mois`,
        },
        {
          label: "Majoration",
          value: eur(majoration),
          hint: tauxMajoration > 0 ? `${pct(tauxMajoration * 100)} des droits` : "Aucune (retard ≤ 12 mois)",
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Décomposition du total dû",
          items: [
            { label: "Droits", value: droits },
            { label: "Intérêts de retard", value: interets },
            { label: "Majoration", value: majoration },
          ],
        },
      ],
      notes: [
        "L'intérêt de retard court même de bonne foi : il répare le préjudice du Trésor, ce n'est pas une sanction.",
        "La majoration de 10 % s'applique à compter du 1er jour du 13e mois suivant l'expiration du délai de dépôt.",
        "Une remise gracieuse des pénalités (pas de l'intérêt en principe) peut être sollicitée auprès de l'administration.",
        "Délai de dépôt : 6 mois en France métropolitaine, 12 mois dans la plupart des autres cas (décès à l'étranger…).",
      ],
      refs: ["Art. 1727 CGI", "Art. 1728 CGI", "Art. 641 CGI"],
    };
  },
};

export default def;
