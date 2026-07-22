// Donation de parts de GFA (groupement foncier agricole) dont les biens sont
// loués par bail rural à LONG TERME : exonération partielle de DMTG
// (art. 793 bis CGI) — 75 % de la valeur jusqu'à un seuil apprécié par part de
// bénéficiaire, 50 % au-delà. Le seuil est un CHAMP (600 000 € avec engagement
// de conservation de 10 ans depuis la LF 2025, 300 000 € sinon) car il bouge
// au gré des lois de finances. Contrepartie : conservation des parts 5 ans.

import type { CalculatorDef } from "../types";
import { eur, pct, num, str } from "../types";
import { LIEN_OPTIONS, type LienParente } from "../bareme";
import { dmtgPourBase } from "./_lotA";

const def: CalculatorDef = {
  id: "donation-gfa",
  title: "Donation de parts de GFA",
  description:
    "Donation de parts de groupement foncier agricole louées par bail à long terme : exonération de 75 % puis 50 % au-delà du seuil (art. 793 bis CGI).",
  category: "transmission",
  aliases: ["GFA", "793 bis", "bail à long terme", "foncier agricole", "groupement foncier"],
  fields: [
    { key: "valeur_parts", label: "Valeur des parts de GFA transmises", type: "eur", min: 0 },
    { key: "lien", label: "Lien de parenté avec le bénéficiaire", type: "enum", options: LIEN_OPTIONS, default: "enfant" },
    {
      key: "seuil_75",
      label: "Seuil d'exonération à 75 %",
      type: "eur",
      default: 300_000,
      min: 0,
      help: "600 000 € si engagement de conservation de 10 ans (LF 2025), sinon 300 000 €. Apprécié par part de bénéficiaire.",
    },
    {
      key: "abattement_consomme",
      label: "Abattement de donation déjà consommé",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations de moins de 15 ans au même bénéficiaire (art. 784 CGI).",
    },
  ],
  compute(v) {
    const valeur = num(v, "valeur_parts");
    const lien = (str(v, "lien") || "enfant") as LienParente;
    const seuil = num(v, "seuil_75");
    const consomme = num(v, "abattement_consomme");

    // Assiette après exonération 793 bis : 25 % de la valeur jusqu'au seuil
    // (exonération 75 %), 50 % au-delà (exonération 50 %).
    const assiette = Math.min(valeur, seuil) * 0.25 + Math.max(0, valeur - seuil) * 0.5;

    // Liquidation ordinaire sur l'assiette réduite : abattement du lien + barème.
    const avec = dmtgPourBase(lien, "donation", assiette, consomme);
    // Référence : même donation sans le régime 793 bis (assiette pleine).
    const sans = dmtgPourBase(lien, "donation", valeur, consomme);
    const economie = sans.droits - avec.droits;

    return {
      kpis: [
        { label: "Droits de donation", value: eur(avec.droits), tone: avec.droits > 0 ? "bad" : "ok" },
        {
          label: "Assiette après exonération 793 bis",
          value: eur(assiette),
          hint: valeur > 0 ? `soit ${pct((assiette / valeur) * 100)} de la valeur` : undefined,
        },
        { label: "Économie vs donation sans 793 bis", value: eur(economie), tone: "ok", hint: `Droits sans régime : ${eur(sans.droits)}` },
      ],
      tables: [
        {
          title: "Détail du barème (sur l'assiette exonérée)",
          columns: ["Tranche", "Taux", "Assiette", "Droits"],
          rows: avec.detail.map((d) => [d.tranche, pct(d.taux * 100), eur(d.assiette), eur(d.droits)]),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Droits avec et sans le régime 793 bis",
          items: [
            { label: "Avec 793 bis", value: avec.droits },
            { label: "Sans 793 bis", value: sans.droits },
          ],
        },
      ],
      notes: [
        "Conditions : biens loués par bail rural à long terme (ou cessible hors cadre familial), parts détenues depuis 2 ans par le donateur, et CONSERVATION des parts par le bénéficiaire pendant 5 ans — sinon déchéance du régime.",
        "Le seuil s'apprécie par bénéficiaire et par le cumul des transmissions antérieures sous le même régime (non pris en compte ici).",
      ],
      refs: ["Art. 793 bis CGI", "Art. 793 1-4° CGI"],
    };
  },
};

export default def;
