// Transmission d'un contrat de capitalisation (donation ou succession) : le
// contrat ne se dénoue PAS — il est transmis avec son antériorité fiscale,
// DMTG sur la valeur vénale, et depuis 2019 les produits latents sont PURGÉS
// (BOI-RPPM-RCM-20-10-20-50 § 225 : prix d'acquisition = valeur au jour de la
// transmission pour les rachats ultérieurs).

import type { CalculatorDef } from "../types";
import { eur, pct, num, str } from "../types";
import { LIEN_OPTIONS, type LienParente } from "../bareme";
import { droitsDmtg, type ModeTransmission } from "./_lotC";

const def: CalculatorDef = {
  id: "transmission-capitalisation",
  title: "Transmission d'un contrat de capitalisation",
  description:
    "DMTG sur la transmission (donation ou succession) d'un contrat de capitalisation, avec purge des produits latents et conservation de l'antériorité fiscale.",
  category: "transmission",
  aliases: ["donation contrat de capitalisation", "succession capi", "purge produits latents", "antériorité fiscale"],
  fields: [
    { key: "valeur_contrat", label: "Valeur vénale du contrat au jour de la transmission", type: "eur", min: 0 },
    {
      key: "produits_latents",
      label: "Produits latents",
      type: "eur",
      min: 0,
      help: "Plus-values et intérêts non rachetés — purgés par la transmission.",
    },
    {
      key: "mode",
      label: "Mode de transmission",
      type: "enum",
      options: [
        { value: "donation", label: "Donation" },
        { value: "succession", label: "Succession" },
      ],
      default: "donation",
    },
    { key: "lien", label: "Lien de parenté", type: "enum", options: LIEN_OPTIONS, default: "enfant" },
    {
      key: "abattement_consomme",
      label: "Abattement déjà consommé",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations de moins de 15 ans au même bénéficiaire (art. 784 CGI).",
    },
    {
      key: "taux_produits",
      label: "Taux d'imposition des produits",
      type: "pct",
      default: 30,
      min: 0,
      max: 60,
      help: "PFU 30 % — taux évité sur les produits purgés ; ajuster si taux réduit 8 ans ou option barème.",
    },
  ],
  compute(v) {
    const valeur = num(v, "valeur_contrat");
    const produits = num(v, "produits_latents");
    const mode = (str(v, "mode") || "donation") as ModeTransmission;
    const lien = (str(v, "lien") || "enfant") as LienParente;
    const taux = num(v, "taux_produits") / 100;

    // DMTG sur la valeur vénale du contrat (abattement selon le mode + barème).
    const dmtg = droitsDmtg(valeur, lien, mode, num(v, "abattement_consomme"));

    // Purge : les produits latents ne seront jamais imposés chez le bénéficiaire
    // (prix d'acquisition rehaussé à la valeur de transmission) → impôt évité.
    const economiePurge = produits * taux;
    const net = valeur - dmtg.droits;

    return {
      kpis: [
        { label: "Droits de mutation dus", value: eur(dmtg.droits), tone: dmtg.droits > 0 ? "bad" : "ok" },
        { label: "Produits latents purgés", value: eur(produits) },
        {
          label: "Impôt évité par la purge",
          value: eur(economiePurge),
          hint: `Au taux de ${pct(taux * 100)}`,
          tone: "ok",
        },
        { label: "Net transmis", value: eur(net), tone: "ok" },
      ],
      tables: [
        {
          title: "Détail du calcul",
          columns: ["Élément", "Montant"],
          rows: [
            ["Valeur vénale transmise", eur(valeur)],
            [
              "Abattement disponible",
              dmtg.exonere ? "Exonération totale (époux/PACS)" : eur(dmtg.abattement),
            ],
            ["Base taxable aux DMTG", eur(dmtg.taxable)],
            ["Droits de mutation", eur(dmtg.droits)],
            ["Impôt évité sur les produits purgés", eur(economiePurge)],
          ],
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Valeur transmise",
          items: [
            { label: "Net transmis", value: net },
            { label: "Droits de mutation", value: dmtg.droits },
          ],
        },
      ],
      notes: [
        "Le contrat de capitalisation ne se dénoue pas : le bénéficiaire le conserve avec son ANTÉRIORITÉ FISCALE (durée de détention acquise pour le régime des rachats).",
        "Depuis 2019 (BOI-RPPM-RCM-20-10-20-50 § 225), le prix d'acquisition retenu pour les rachats ultérieurs est la valeur au jour de la transmission : les produits latents sont définitivement purgés.",
        "Droits calculés pour un seul bénéficiaire recevant l'intégralité du contrat ; répartir la valeur en cas de pluralité.",
      ],
      refs: ["Art. 777 CGI", "Art. 779 CGI", "BOI-RPPM-RCM-20-10-20-50"],
    };
  },
};

export default def;
