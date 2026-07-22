// Coefficient IFI des placements indirects : l'assiette IFI d'un placement
// « pierre-papier » = montant × fraction représentative d'actifs immobiliers
// (« ratio IFI » publié chaque année par la société de gestion). SIIC : exonérées
// si le redevable détient moins de 5 % (art. 972 ter CGI).

import type { CalculatorDef } from "../types";
import { eur, pct, num, bool } from "../types";

const def: CalculatorDef = {
  id: "ifi-placements-coefficient",
  title: "Coefficient IFI des placements indirects",
  description:
    "Assiette IFI des placements pierre-papier (SCPI, OPCI, UC immobilières en assurance-vie, SIIC) : montant × fraction immobilière, exonération SIIC sous 5 %.",
  category: "transmission",
  aliases: ["ratio IFI", "SCPI IFI", "OPCI IFI", "SIIC IFI", "UC immobilières", "965 CGI"],
  fields: [
    { key: "scpi", label: "SCPI (en direct)", type: "eur", default: 0, min: 0, required: false },
    {
      key: "coef_scpi",
      label: "Coefficient immobilier SCPI",
      type: "pct",
      default: 100,
      min: 0,
      max: 100,
      help: "Une SCPI est quasi intégralement immobilière — ajuster avec le ratio IFI publié.",
    },
    { key: "opci", label: "OPCI (en direct)", type: "eur", default: 0, min: 0, required: false },
    {
      key: "coef_opci",
      label: "Coefficient immobilier OPCI",
      type: "pct",
      default: 90,
      min: 0,
      max: 100,
      help: "Fraction immobilière réelle publiée par la société de gestion — ajuster.",
    },
    {
      key: "av_uc_immo",
      label: "UC immobilières en assurance-vie",
      type: "eur",
      default: 0,
      min: 0,
      required: false,
      help: "UC immobilières logées en assurance-vie (taxables à hauteur de la fraction immo).",
    },
    {
      key: "coef_av",
      label: "Coefficient immobilier des UC",
      type: "pct",
      default: 100,
      min: 0,
      max: 100,
    },
    { key: "siic", label: "Actions de SIIC", type: "eur", default: 0, min: 0, required: false },
    {
      key: "siic_moins_5pct",
      label: "Participation inférieure à 5 % de la SIIC",
      type: "bool",
      default: true,
      help: "Sous 5 % du capital, les actions de SIIC sont exonérées d'IFI (art. 972 ter CGI).",
    },
  ],
  compute(v) {
    const poches = [
      { label: "SCPI", montant: num(v, "scpi"), coef: num(v, "coef_scpi") / 100 },
      { label: "OPCI", montant: num(v, "opci"), coef: num(v, "coef_opci") / 100 },
      { label: "UC immobilières (AV)", montant: num(v, "av_uc_immo"), coef: num(v, "coef_av") / 100 },
      // SIIC : exonérées sous 5 % de détention, sinon taxables en totalité.
      { label: "SIIC", montant: num(v, "siic"), coef: bool(v, "siic_moins_5pct") ? 0 : 1 },
    ].map((p) => ({ ...p, assiette: p.montant * p.coef }));

    const totalInvesti = poches.reduce((s, p) => s + p.montant, 0);
    const assiette = poches.reduce((s, p) => s + p.assiette, 0);
    const horsAssiette = totalInvesti - assiette;

    return {
      kpis: [
        { label: "Assiette IFI totale", value: eur(assiette), tone: assiette > 0 ? "bad" : "ok" },
        { label: "Montant investi", value: eur(totalInvesti) },
        {
          label: "Hors assiette IFI",
          value: eur(horsAssiette),
          hint: "Fractions non immobilières et SIIC exonérées",
          tone: "ok",
        },
      ],
      tables: [
        {
          title: "Détail par poche",
          columns: ["Placement", "Montant", "Coefficient retenu", "Assiette IFI"],
          rows: poches.map((p) => [p.label, eur(p.montant), pct(p.coef * 100), eur(p.assiette)]),
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Assiette IFI par type de placement",
          items: poches.filter((p) => p.assiette > 0).map((p) => ({ label: p.label, value: p.assiette })),
        },
      ],
      notes: [
        "Les coefficients réels (« ratio IFI ») sont publiés chaque année par les sociétés de gestion — les défauts proposés sont indicatifs.",
        "SIIC : exonération si le redevable détient (seul ou avec son foyer) moins de 5 % du capital (art. 972 ter CGI) ; au-delà, taxation sur la fraction immobilière (100 % retenu ici).",
        "Parts de fonds détenant moins de 10 % d'actifs immobiliers lorsque le redevable détient moins de 10 % des parts : exclues de l'assiette (art. 965 2° CGI) — à retirer des montants saisis.",
      ],
      refs: ["Art. 965 CGI", "Art. 972 CGI", "Art. 972 ter CGI"],
    };
  },
};

export default def;
