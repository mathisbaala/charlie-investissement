// Libéralité graduelle ou résiduelle (art. 1048 s. C.civ) — fiscalité de la
// SECONDE transmission (art. 784 C CGI) : au décès du premier gratifié, le
// second gratifié est réputé tenir le bien directement du DISPOSANT initial.
// Conséquences : taxation selon SON lien avec le disposant (souvent bien plus
// doux que son lien avec le premier gratifié), sur la valeur au jour de la
// seconde transmission, et les droits acquittés lors de la première mutation
// s'imputent sur les droits dus (plancher 0 — pas de restitution).

import type { CalculatorDef } from "../types";
import { eur, pct, num, str } from "../types";
import { LIEN_OPTIONS, type LienParente } from "../bareme";
import { dmtgPourBase, type ModeMutation } from "./_lotA";

const def: CalculatorDef = {
  id: "graduelle-residuelle",
  title: "Libéralité graduelle ou résiduelle",
  description:
    "Droits dus par le second gratifié à la seconde transmission : lien avec le disposant initial et imputation des droits de la première mutation.",
  category: "transmission",
  aliases: ["784 C", "libéralité graduelle", "libéralité résiduelle", "second gratifié", "double libéralité"],
  fields: [
    {
      key: "valeur_seconde_transmission",
      label: "Valeur du bien au jour de la seconde transmission",
      type: "eur",
      min: 0,
    },
    {
      key: "lien",
      label: "Lien disposant initial → second gratifié",
      type: "enum",
      options: LIEN_OPTIONS,
      help: "C'est CE lien qui compte (art. 784 C), pas celui avec le premier gratifié.",
    },
    {
      key: "droits_premiere_mutation",
      label: "Droits acquittés lors de la première mutation",
      type: "eur",
      default: 0,
      min: 0,
      help: "Imputés sur les droits dus par le second gratifié (sans restitution).",
    },
    {
      key: "abattement_consomme",
      label: "Abattement déjà consommé (disposant → second gratifié)",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations de moins de 15 ans du disposant au second gratifié (art. 784 CGI).",
    },
    {
      key: "mode",
      label: "Nature de la seconde transmission",
      type: "enum",
      options: [
        { value: "succession", label: "Succession (décès du premier gratifié)" },
        { value: "donation", label: "Donation (abandon anticipé par le premier gratifié)" },
      ],
      default: "succession",
      help: "Détermine l'abattement applicable (donation ou succession).",
    },
  ],
  compute(v) {
    const valeur = num(v, "valeur_seconde_transmission");
    const lien = (str(v, "lien") || "enfant") as LienParente;
    const droitsPremiere = num(v, "droits_premiere_mutation");
    const mode = (str(v, "mode") || "succession") as ModeMutation;

    // Liquidation comme si le disposant transmettait directement au second
    // gratifié : abattement et barème de CE lien, valeur au jour de la 2nde
    // transmission (le premier gratifié est fiscalement transparent).
    const { droits: bruts, detail } = dmtgPourBase(lien, mode, valeur, num(v, "abattement_consomme"));

    // Imputation des droits de la première mutation — plancher 0 : l'excédent
    // éventuel n'est jamais restitué.
    const imputation = Math.min(bruts, Math.max(0, droitsPremiere));
    const nets = bruts - imputation;

    const notes = [
      "Le second gratifié est réputé tenir le bien du disposant initial : lien, abattement et barème s'apprécient entre eux (art. 784 C CGI).",
      "L'imputation des droits de la première mutation est plafonnée aux droits dus — aucun excédent n'est restitué.",
    ];
    if (lien === "epoux" && mode === "succession") {
      notes.push("Second gratifié conjoint/PACS en succession : exonération totale de droits (art. 796-0 bis CGI).");
    }

    return {
      kpis: [
        { label: "Droits bruts (seconde transmission)", value: eur(bruts) },
        { label: "Imputation des droits de la 1ʳᵉ mutation", value: eur(imputation), tone: "ok" },
        { label: "Droits nets dus", value: eur(nets), tone: nets > 0 ? "bad" : "ok" },
        {
          label: "Net transmis au second gratifié",
          value: eur(valeur - nets),
          hint: valeur > 0 ? `Taux effectif : ${pct((nets / valeur) * 100)}` : undefined,
          tone: "ok",
        },
      ],
      tables: [
        {
          title: "Détail du barème (lien disposant → second gratifié)",
          columns: ["Tranche", "Taux", "Assiette", "Droits"],
          rows: detail.map((d) => [d.tranche, pct(d.taux * 100), eur(d.assiette), eur(d.droits)]),
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Répartition de la seconde transmission",
          items: [
            { label: "Net au second gratifié", value: valeur - nets },
            { label: "Droits nets", value: nets },
          ],
        },
      ],
      notes,
      refs: ["Art. 784 C CGI", "Art. 1048 s. C.civ"],
    };
  },
};

export default def;
