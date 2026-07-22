// Droits d'enregistrement d'une cession d'entreprise (art. 726 et 719 CGI) :
// actions 0,1 %, parts sociales 3 % après abattement proratisé, sociétés à
// prépondérance immobilière 5 %, fonds de commerce au barème de l'art. 719.

import type { CalculatorDef } from "../types";
import { eur, pct, num, str } from "../types";
import { applyBareme, type Tranche } from "../bareme";

// Taux de l'art. 726 CGI — stables depuis 2012.
const TAUX_ACTIONS = 0.001;
const TAUX_PARTS = 0.03;
const ABATTEMENT_PARTS = 23_000;
const TAUX_PPI = 0.05;

/** Barème des cessions de fonds de commerce (art. 719 CGI, part État + taxes locales). */
const BAREME_FONDS: Tranche[] = [
  { jusqua: 23_000, taux: 0 },
  { jusqua: 200_000, taux: 0.03 },
  { jusqua: Infinity, taux: 0.05 },
];

const def: CalculatorDef = {
  id: "droits-cession",
  title: "Droits d'enregistrement de cession d'entreprise",
  description:
    "Droits d'enregistrement selon la nature de la cession : actions (0,1 %), parts sociales (3 %), société à prépondérance immobilière (5 %) ou fonds de commerce (barème art. 719 CGI).",
  category: "transmission",
  aliases: ["cession fonds de commerce", "719 CGI", "726 CGI", "droits acquéreur", "enregistrement cession titres"],
  fields: [
    { key: "prix", label: "Prix de cession", type: "eur", min: 0 },
    {
      key: "nature",
      label: "Nature de la cession",
      type: "enum",
      options: [
        { value: "actions", label: "Actions (SAS, SA…)" },
        { value: "parts", label: "Parts sociales (SARL, SNC…)" },
        { value: "ppi", label: "Société à prépondérance immobilière" },
        { value: "fonds", label: "Fonds de commerce" },
      ],
      default: "actions",
    },
    {
      key: "pct_cede",
      label: "Pourcentage du capital cédé",
      type: "pct",
      default: 100,
      min: 0,
      max: 100,
      help: "L'abattement de 23 000 € est proratisé aux parts cédées.",
      showIf: (v) => str(v, "nature") === "parts",
    },
  ],
  compute(v) {
    const prix = num(v, "prix");
    const nature = str(v, "nature") || "actions";

    let droits = 0;
    let regime = "";
    let tableFonds;
    switch (nature) {
      case "parts": {
        const abattement = ABATTEMENT_PARTS * (num(v, "pct_cede") / 100);
        droits = Math.max(0, prix - abattement) * TAUX_PARTS;
        regime = `Parts sociales : 3 % après abattement de ${eur(abattement)}`;
        break;
      }
      case "ppi":
        droits = prix * TAUX_PPI;
        regime = "Prépondérance immobilière : 5 % sans abattement";
        break;
      case "fonds": {
        const r = applyBareme(BAREME_FONDS, prix);
        droits = r.droits;
        regime = "Fonds de commerce : barème progressif de l'art. 719 CGI";
        tableFonds = {
          title: "Barème appliqué (art. 719 CGI)",
          columns: ["Tranche", "Taux", "Assiette", "Droits"],
          rows: r.detail.map((d) => [d.tranche, pct(d.taux * 100), eur(d.assiette), eur(d.droits)]),
        };
        break;
      }
      default:
        droits = prix * TAUX_ACTIONS;
        regime = "Actions : 0,1 % du prix";
    }

    const tauxMoyen = prix > 0 ? (droits / prix) * 100 : 0;

    return {
      kpis: [
        { label: "Droits d'enregistrement", value: eur(droits), hint: regime, tone: droits > 0 ? "bad" : "ok" },
        { label: "Taux moyen", value: pct(tauxMoyen) },
        {
          label: "Net vendeur",
          value: eur(prix),
          hint: "Les droits sont à la charge de l'acquéreur — le net vendeur n'est pas amputé.",
          tone: "ok",
        },
        { label: "Coût acquéreur total", value: eur(prix + droits) },
      ],
      tables: tableFonds ? [tableFonds] : undefined,
      notes: [
        "Les droits d'enregistrement sont dus par l'ACQUÉREUR (art. 1712 CGI) ; ils s'ajoutent au prix payé.",
        "Fonds de commerce : le barème s'applique au prix du fonds (clientèle, droit au bail, matériel) — les marchandises neuves cédées sont taxées à part (TVA).",
      ],
      refs: ["Art. 726 CGI", "Art. 719 CGI"],
    };
  },
};

export default def;
