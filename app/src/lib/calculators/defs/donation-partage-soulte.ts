// Donation-partage avec soulte (art. 778 bis CGI) : les DMTG sont liquidés
// comme si chaque enfant recevait SA PART THÉORIQUE dans la masse donnée. La
// soulte est fiscalement NEUTRE : l'enfant qui reçoit le bien à charge de
// soulte est taxé sur sa part nette théorique (pas sur la valeur du bien qu'il
// garde), et celui qui reçoit la soulte n'est pas taxé en mutation à titre
// onéreux. C'est ce qui rend la DP avec soulte si efficace pour attribuer un
// bien indivisible (entreprise, immeuble) à un seul enfant.

import type { CalculatorDef } from "../types";
import { eur, pct, num } from "../types";
import { BAREME_LIGNE_DIRECTE, abattementDonation, applyBareme } from "../bareme";

const def: CalculatorDef = {
  id: "donation-partage-soulte",
  title: "Donation-partage avec soulte",
  description:
    "Donation-partage aux enfants avec soulte : droits liquidés sur la part théorique de chacun, la soulte est fiscalement neutre (art. 778 bis CGI).",
  category: "transmission",
  aliases: ["778 bis", "soulte", "donation-partage inégale", "attribution avec soulte"],
  fields: [
    { key: "valeur_totale", label: "Valeur totale des biens donnés", type: "eur", min: 0 },
    { key: "nb_enfants", label: "Nombre d'enfants copartagés", type: "int", min: 1, default: 2 },
    {
      key: "soulte",
      label: "Soulte versée entre enfants",
      type: "eur",
      default: 0,
      min: 0,
      required: false,
      help: "Purement informative : la soulte ne modifie pas l'assiette des droits (art. 778 bis CGI).",
    },
    {
      key: "abattement_consomme_par_enfant",
      label: "Abattement déjà consommé par enfant",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations de moins de 15 ans du même donateur à chaque enfant (art. 784 CGI).",
    },
  ],
  compute(v) {
    const valeur = num(v, "valeur_totale");
    const nb = Math.max(1, Math.round(num(v, "nb_enfants")));
    const soulte = num(v, "soulte");

    // Part THÉORIQUE égalitaire : c'est elle qui fait l'assiette de chaque
    // enfant, quelle que soit l'attribution réelle des lots (778 bis).
    const part = valeur / nb;
    const abattement = Math.max(0, abattementDonation("enfant") - num(v, "abattement_consomme_par_enfant"));
    const { droits: droitsParEnfant, detail } = applyBareme(BAREME_LIGNE_DIRECTE, Math.max(0, part - abattement));
    const total = droitsParEnfant * nb;

    return {
      kpis: [
        { label: "Droits de donation totaux", value: eur(total), tone: total > 0 ? "bad" : "ok" },
        { label: "Droits par enfant", value: eur(droitsParEnfant), hint: `Part théorique : ${eur(part)}` },
        {
          label: "Net transmis aux enfants",
          value: eur(valeur - total),
          hint: valeur > 0 ? `Taux effectif : ${pct((total / valeur) * 100)}` : undefined,
          tone: "ok",
        },
      ],
      tables: [
        {
          title: "Détail du barème (par enfant, sur sa part théorique)",
          columns: ["Tranche", "Taux", "Assiette", "Droits"],
          rows: detail.map((d) => [d.tranche, pct(d.taux * 100), eur(d.assiette), eur(d.droits)]),
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Répartition de la masse donnée",
          items: [
            { label: "Net aux enfants", value: valeur - total },
            { label: "Droits", value: total },
          ],
        },
      ],
      notes: [
        soulte > 0
          ? `La soulte de ${eur(soulte)} ne modifie pas l'assiette : le débiteur de la soulte est taxé sur sa part nette théorique, pas sur ce qu'il conserve (art. 778 bis CGI).`
          : "La soulte éventuelle ne modifierait pas l'assiette : chaque enfant est taxé sur sa part théorique (art. 778 bis CGI).",
        "Le partage inclus dans la donation-partage n'est pas soumis au droit de partage de 2,5 % (art. 746 CGI ne s'applique pas aux partages faits par l'ascendant).",
        "Hypothèse : lots théoriques égalitaires entre enfants du même donateur.",
      ],
      refs: ["Art. 778 bis CGI", "Art. 777, 779 CGI"],
    };
  },
};

export default def;
