// Exonération de plus-value lors d'un partage avec soulte (art. 150 U II CGI,
// BOI-RFPI-PVI-10-40-100) : les partages d'indivisions d'origine GRATUITE
// (succession, communauté conjugale, PACS) entre membres originaires (ou leur
// conjoint/descendant) sont DÉCLARATIFS et non translatifs — la soulte n'est
// alors pas un prix de cession, donc aucune plus-value imposable. À défaut
// (indivision ordinaire, attributaire tiers), la soulte est un vrai prix de
// cession : plus-value taxable à ~36,2 % (19 % IR + 17,2 % PS).

import type { CalculatorDef } from "../types";
import { eur, pct, num, str, bool } from "../types";

const def: CalculatorDef = {
  id: "exo-partage",
  title: "Exonération de plus-value lors d'un partage",
  description:
    "Partage d'indivision avec soulte : le partage est-il translatif (plus-value taxable sur la soulte) ou déclaratif (exonéré) ?",
  category: "transmission",
  aliases: ["partage avec soulte", "150 U II", "plus-value partage", "licitation", "indivision successorale"],
  fields: [
    {
      key: "origine_indivision",
      label: "Origine de l'indivision",
      type: "enum",
      options: [
        { value: "successorale_conjugale", label: "Succession, communauté conjugale, PACS" },
        { value: "autre", label: "Autre (indivision ordinaire)" },
      ],
    },
    {
      key: "cessionnaire_membre",
      label: "Attributaire membre originaire de l'indivision (ou son conjoint/descendant)",
      type: "bool",
      default: true,
      help: "L'exonération exige que le lot revienne à un indivisaire d'origine ou à ses proches (art. 150 U II 4° CGI).",
    },
    { key: "soulte", label: "Soulte versée", type: "eur", min: 0 },
    {
      key: "plus_value_latente_quote_part",
      label: "Plus-value latente sur la quote-part acquise",
      type: "eur",
      min: 0,
      help: "PV latente sur la quote-part acquise via la soulte.",
    },
    {
      key: "taux_imposition",
      label: "Taux d'imposition de la plus-value",
      type: "pct",
      default: 36.2,
      min: 0,
      max: 60,
      help: "19 % IR + 17,2 % de prélèvements sociaux par défaut ; ajuster si surtaxe ou abattements.",
    },
  ],
  compute(v) {
    const origine = str(v, "origine_indivision");
    const membre = bool(v, "cessionnaire_membre");
    const soulte = num(v, "soulte");
    const pv = num(v, "plus_value_latente_quote_part");
    const taux = num(v, "taux_imposition") / 100;

    // Le partage n'est déclaratif (donc exonéré) que si l'indivision est
    // d'origine gratuite ET que l'attributaire est un membre originaire.
    const exonere = origine === "successorale_conjugale" && membre;
    const impot = pv * taux;

    return {
      kpis: [
        {
          label: "Verdict",
          value: exonere ? "Exonéré" : "Taxable",
          hint: exonere ? "Partage déclaratif : la soulte n'est pas un prix de cession." : "Partage translatif : la soulte est un prix de cession.",
          tone: exonere ? "ok" : "bad",
        },
        {
          label: exonere ? "Impôt évité" : "Impôt dû sur la plus-value",
          value: eur(impot),
          hint: `${eur(pv)} × ${pct(taux * 100)}`,
          tone: exonere ? "ok" : "bad",
        },
        { label: "Soulte", value: eur(soulte) },
      ],
      notes: [
        exonere
          ? "Indivision d'origine successorale/conjugale/PACS et attributaire membre originaire : le partage n'est pas translatif, aucune plus-value n'est imposable sur la soulte (art. 150 U II CGI)."
          : "Hors indivisions d'origine gratuite entre membres originaires, la soulte constitue un prix de cession pour le cédant de la quote-part : plus-value imposable.",
        "Les abattements pour durée de détention (art. 150 VC CGI) ne sont pas pris en compte — le taux est ajustable dans le champ dédié.",
        "Le partage taxable reste par ailleurs soumis au droit de partage (art. 746 CGI), non calculé ici.",
      ],
      refs: ["Art. 150 U II CGI", "BOI-RFPI-PVI-10-40-100"],
    };
  },
};

export default def;
