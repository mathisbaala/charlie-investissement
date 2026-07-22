// Réversion d'usufruit (usufruit successif) : le donateur se réserve
// l'usufruit et stipule qu'à son décès, l'usufruit se poursuivra sur la tête
// d'un bénéficiaire désigné. Fiscalité (art. 796-0 quater CGI) : au profit du
// CONJOINT survivant (ou partenaire PACS), la réversion est EXONÉRÉE ; au
// profit d'un autre bénéficiaire, elle est taxée aux DMTG AU DÉCÈS DU
// STIPULANT, selon le lien bénéficiaire-stipulant, sur la valeur de l'usufruit
// (art. 669 CGI — âge du bénéficiaire apprécié AU JOUR du décès du stipulant).

import type { CalculatorDef } from "../types";
import { eur, pct, num, str } from "../types";
import {
  LIEN_OPTIONS,
  baremeForLien,
  abattementSuccession,
  applyBareme,
  usufruitViager,
  type LienParente,
} from "../bareme";

const def: CalculatorDef = {
  id: "reversion-usufruit",
  title: "Réversion d'usufruit",
  description:
    "Fiscalité de l'usufruit successif : exonéré au profit du conjoint, taxé aux DMTG au décès du stipulant sinon.",
  category: "transmission",
  aliases: ["usufruit successif", "usufruit réversible", "796-0 quater", "réserve d'usufruit au second"],
  fields: [
    {
      key: "valeur_pleine_propriete",
      label: "Valeur du bien en pleine propriété",
      type: "eur",
      min: 0,
      help: "Valeur au jour du décès du stipulant (fait générateur de la taxation).",
    },
    {
      key: "beneficiaire",
      label: "Bénéficiaire de la réversion",
      type: "enum",
      options: [
        { value: "conjoint", label: "Conjoint / partenaire PACS" },
        { value: "autre", label: "Autre bénéficiaire" },
      ],
      default: "conjoint",
    },
    {
      key: "lien",
      label: "Lien de parenté avec le stipulant",
      type: "enum",
      options: LIEN_OPTIONS,
      showIf: (v) => v.beneficiaire === "autre",
    },
    {
      key: "age_beneficiaire",
      label: "Âge du bénéficiaire au décès du stipulant",
      type: "int",
      min: 0,
      max: 120,
      help: "L'usufruit réversé est évalué selon l'âge du bénéficiaire AU JOUR du décès du stipulant (art. 669 CGI).",
      showIf: (v) => v.beneficiaire === "autre",
    },
    {
      key: "abattement_consomme",
      label: "Abattement déjà consommé (15 dernières années)",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations antérieures rappelées fiscalement (art. 784 CGI).",
      showIf: (v) => v.beneficiaire === "autre",
    },
  ],
  compute(v) {
    const valeurPP = num(v, "valeur_pleine_propriete");

    // Conjoint / PACS : exonération totale de la réversion (796-0 quater,
    // renvoi au régime TEPA du conjoint survivant).
    if ((str(v, "beneficiaire") || "conjoint") === "conjoint") {
      return {
        kpis: [
          { label: "Droits sur la réversion", value: eur(0), tone: "ok" },
          { label: "Valeur reçue par le conjoint", value: eur(valeurPP), tone: "ok", hint: "Usufruit successif exonéré" },
        ],
        notes: [
          "La réversion d'usufruit au profit du conjoint survivant ou du partenaire PACS est exonérée de droits de mutation par décès.",
        ],
        refs: ["Art. 796-0 quater CGI", "Art. 796-0 bis CGI"],
      };
    }

    const lien = (str(v, "lien") || "enfant") as LienParente;
    const age = num(v, "age_beneficiaire");
    const consomme = num(v, "abattement_consomme");

    // Assiette : valeur fiscale de l'usufruit réversé selon l'âge du
    // BÉNÉFICIAIRE au décès du stipulant (c'est lui le nouvel usufruitier).
    const tauxUsufruit = usufruitViager(age);
    const assiette = valeurPP * tauxUsufruit;

    // Taxation aux DMTG par DÉCÈS : abattement et barème du lien
    // bénéficiaire-stipulant (epoux → Infinity, le max(0, …) neutralise).
    const abattement = Math.max(0, abattementSuccession(lien) - consomme);
    const taxable = Math.max(0, assiette - abattement);
    const { droits, detail } = applyBareme(baremeForLien(lien), taxable);

    return {
      kpis: [
        { label: "Droits sur la réversion", value: eur(droits), tone: droits > 0 ? "bad" : "ok" },
        { label: "Valeur fiscale de l'usufruit réversé", value: eur(assiette) },
        { label: "Taux art. 669 appliqué", value: pct(tauxUsufruit * 100), hint: `Bénéficiaire de ${age} ans au décès du stipulant` },
      ],
      tables: [
        {
          title: "Détail du barème",
          columns: ["Tranche", "Taux", "Assiette", "Droits"],
          rows: detail.map((d) => [d.tranche, pct(d.taux * 100), eur(d.assiette), eur(d.droits)]),
        },
      ],
      notes: [
        "La réversion est taxée AU DÉCÈS DU STIPULANT (fait générateur), pas au jour de la stipulation.",
        "Régime des mutations par décès : abattement de succession du lien bénéficiaire-stipulant, barème art. 777.",
      ],
      refs: ["Art. 796-0 quater CGI", "Art. 669 CGI", "Art. 777 CGI"],
    };
  },
};

export default def;
