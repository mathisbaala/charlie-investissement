// Droit de partage (art. 746 CGI) : 2,5 % en général, 1,1 % pour les partages
// de successions et de communautés conjugales après divorce/séparation.

import type { CalculatorDef } from "../types";
import { eur, pct, num, str } from "../types";
import { DROIT_PARTAGE_GENERAL, DROIT_PARTAGE_SUCCESSORAL } from "../bareme";

const def: CalculatorDef = {
  id: "droits-partage",
  title: "Droit de partage",
  description: "Droit de partage — art. 746 CGI (2,5 % général, 1,1 % successoral/divorce).",
  category: "transmission",
  aliases: ["746 CGI", "partage indivision", "partage communauté", "droit de partage divorce"],
  fields: [
    {
      key: "actif_net",
      label: "Actif net partagé",
      type: "eur",
      min: 0,
      help: "Valeur nette des biens partagés (après passif), soultes comprises.",
    },
    {
      key: "nature",
      label: "Nature du partage",
      type: "enum",
      options: [
        { value: "succession", label: "Succession ou communauté conjugale (divorce/séparation)" },
        { value: "general", label: "Autre indivision (général)" },
      ],
      default: "general",
    },
  ],
  compute(v) {
    const actif = num(v, "actif_net");
    const taux = str(v, "nature") === "succession" ? DROIT_PARTAGE_SUCCESSORAL : DROIT_PARTAGE_GENERAL;
    const droit = actif * taux;
    return {
      kpis: [
        { label: "Droit de partage", value: eur(droit), tone: droit > 0 ? "bad" : "ok" },
        { label: "Taux appliqué", value: pct(taux * 100) },
        { label: "Net après droit", value: eur(actif - droit), tone: "ok" },
      ],
      notes: [
        "Le taux réduit de 1,1 % vise les partages d'intérêts patrimoniaux consécutifs à un divorce, une rupture de PACS ou une séparation de corps, et les partages successoraux.",
        "Un partage verbal (sans acte) de meubles n'est pas soumis au droit ; l'acte notarié sur des immeubles l'est toujours.",
      ],
      refs: ["Art. 746 CGI", "Art. 748 CGI"],
    };
  },
};

export default def;
