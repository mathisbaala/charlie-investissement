// Masse successorale selon le régime matrimonial : au premier décès, la
// liquidation du régime PRÉCÈDE la dévolution — ce que le conjoint reprend
// (moitié de communauté, propres, créance de participation) n'entre jamais
// dans la succession. La masse obtenue est l'assiette taxable des héritiers.
// Mécanique civile partagée avec `compare-regimes-matrimoniaux` (cf. _lotB).

import type { CalculatorDef } from "../types";
import { eur, num, str } from "../types";
import {
  REGIME_OPTIONS,
  isRegimeCommunautaire,
  masseSelonRegime,
  type RegimeMatrimonial,
} from "./_lotB";

const def: CalculatorDef = {
  id: "masse-successorale",
  title: "Masse successorale selon le régime matrimonial",
  description:
    "Ce qui entre dans la succession au premier décès selon le régime matrimonial (communauté, séparation, participation).",
  category: "transmission",
  aliases: [
    "liquidation du régime matrimonial",
    "communauté réduite aux acquêts",
    "attribution intégrale",
    "créance de participation",
    "actif successoral",
  ],
  fields: [
    {
      key: "regime",
      label: "Régime matrimonial",
      type: "enum",
      options: REGIME_OPTIONS,
      default: "communaute_legale",
    },
    {
      key: "biens_communs",
      label: "Biens communs",
      type: "eur",
      min: 0,
      help: "Valeur nette de la masse commune (acquêts du couple).",
      // Masqué pour séparation ET participation : dans ces régimes il n'existe
      // pas de masse commune, chacun est propriétaire de ce qui est à son nom.
      showIf: (v) => isRegimeCommunautaire(str(v, "regime") || "communaute_legale"),
    },
    { key: "propres_defunt", label: "Biens propres du défunt", type: "eur", min: 0 },
    { key: "propres_conjoint", label: "Biens propres du conjoint survivant", type: "eur", min: 0 },
    {
      key: "acquets_defunt",
      label: "Acquêts au nom du défunt",
      type: "eur",
      min: 0,
      help: "Enrichissement réalisé pendant le mariage au nom du défunt.",
      showIf: (v) => v.regime === "participation",
    },
    {
      key: "acquets_conjoint",
      label: "Acquêts au nom du conjoint survivant",
      type: "eur",
      min: 0,
      showIf: (v) => v.regime === "participation",
    },
  ],
  compute(v) {
    const regime = (str(v, "regime") || "communaute_legale") as RegimeMatrimonial;
    const r = masseSelonRegime(regime, {
      propresDefunt: num(v, "propres_defunt"),
      propresConjoint: num(v, "propres_conjoint"),
      biensCommuns: num(v, "biens_communs"),
      acquetsDefunt: num(v, "acquets_defunt"),
      acquetsConjoint: num(v, "acquets_conjoint"),
    });

    const notes: string[] = [
      "Mécanique civile hors avantages matrimoniaux particuliers, récompenses et donations entre époux — la masse obtenue est l'assiette des droits des héritiers.",
    ];
    if (regime === "communaute_universelle" || regime === "communaute_universelle_attribution") {
      notes.push("En communauté universelle, tous les biens sont communs (art. 1526 C.civ.) : les « propres » saisis sont fondus dans la masse commune.");
    }
    if (regime === "communaute_universelle_attribution") {
      notes.push("Attribution intégrale : les enfants n'héritent qu'au second décès — la masse taxable est reportée (et concentrée) sur cette seconde succession.");
    }
    if (regime === "participation" && r.creanceParticipation !== 0) {
      notes.push(
        r.creanceParticipation > 0
          ? "Le défunt s'est enrichi davantage : la créance de participation due au conjoint vient en déduction de la masse successorale."
          : "Le conjoint s'est enrichi davantage : la succession encaisse la créance de participation, qui augmente la masse.",
      );
    }

    const kpis = [
      { label: "Masse successorale", value: eur(r.masse) },
      { label: "Patrimoine du conjoint hors succession", value: eur(r.conjointHorsSuccession), tone: "ok" as const },
    ];
    if (regime === "participation") {
      kpis.push({
        label: "Créance de participation",
        value: eur(Math.abs(r.creanceParticipation)),
        hint: r.creanceParticipation >= 0 ? "Due par la succession au conjoint" : "Due par le conjoint à la succession",
      } as (typeof kpis)[number]);
    }

    return {
      kpis,
      tables: [
        {
          title: "Composition de la masse successorale",
          columns: ["Composante", "Montant"],
          rows: r.composantes.map((c) => [c.label, eur(c.montant)]),
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Répartition au premier décès",
          items: [
            { label: "Masse successorale", value: r.masse },
            { label: "Conjoint hors succession", value: r.conjointHorsSuccession },
          ],
        },
      ],
      notes,
      refs: ["Art. 1400 s. C.civ.", "Art. 1526 C.civ.", "Art. 1569 C.civ."],
    };
  },
};

export default def;
