// Holding animatrice : évaluation de la QUALIFICATION (pas un calcul d'impôt).
// L'enjeu est massif — Dutreil 787 B, abattement dirigeant 150-0 D ter,
// IR-PME, apport-cession 150-0 B ter — et la qualification repose sur un
// faisceau d'indices dégagé par la jurisprudence : l'animation doit être
// l'activité PRINCIPALE, ce que le juge mesure notamment par la prépondérance
// des actifs affectés à l'animation (participations animées + moyens affectés
// > 50 % de l'actif total — CE 13/06/2018 n° 395495 ; Cass. com. 14/10/2020),
// combinée au contrôle effectif des filiales et à la conduite RÉELLE de la
// politique du groupe (conventions d'animation, PV, prestations effectives).

import type { CalculatorDef } from "../types";
import { eur, pct, num, bool } from "../types";

const def: CalculatorDef = {
  id: "holding-animatrice-evaluation",
  title: "Holding animatrice : évaluation de la qualification",
  description:
    "Faisceau d'indices et ratio de prépondérance (> 50 % d'actif animé) pour évaluer la qualification de holding animatrice.",
  category: "transmission",
  aliases: ["holding animatrice", "animation de groupe", "Dutreil holding", "787 B holding", "holding passive"],
  fields: [
    { key: "actif_total", label: "Actif total de la holding", type: "eur", min: 0 },
    {
      key: "participations_animees",
      label: "Participations dans les filiales animées",
      type: "eur",
      min: 0,
      help: "Valeur vénale des titres des filiales effectivement animées.",
    },
    {
      key: "actifs_affectes_animation",
      label: "Autres actifs affectés à l'animation",
      type: "eur",
      default: 0,
      min: 0,
      help: "Trésorerie/immobilier mis à disposition des filiales animées, comptes courants…",
    },
    {
      key: "controle_effectif",
      label: "Contrôle effectif des filiales animées",
      type: "bool",
      default: false,
      help: "La holding contrôle-t-elle effectivement les filiales animées ?",
    },
    {
      key: "conduite_politique_groupe",
      label: "Conduite effective de la politique du groupe",
      type: "bool",
      default: false,
      help: "Conventions d'animation, procès-verbaux, prestations effectives ?",
    },
    {
      key: "services_specifiques",
      label: "Services spécifiques rendus aux filiales",
      type: "bool",
      default: false,
      help: "Services administratifs/comptables/financiers rendus aux filiales (indice complémentaire, non exigé).",
    },
  ],
  compute(v) {
    const actifTotal = num(v, "actif_total");
    const participations = num(v, "participations_animees");
    const affectes = num(v, "actifs_affectes_animation");
    const controle = bool(v, "controle_effectif");
    const conduite = bool(v, "conduite_politique_groupe");
    const services = bool(v, "services_specifiques");

    const actifAnime = participations + affectes;
    const ratio = actifTotal > 0 ? actifAnime / actifTotal : 0;

    // Verdict en faisceau : le ratio de prépondérance est nécessaire mais
    // jamais suffisant — sans contrôle effectif ni animation réelle documentée,
    // la qualification tombe (c'est le terrain de contestation favori de
    // l'administration).
    let verdict: string;
    let tone: "ok" | "bad";
    if (ratio > 0.5 && controle && conduite) {
      verdict = "Qualification probable";
      tone = "ok";
    } else if (ratio > 0.5) {
      verdict = "Qualification fragile";
      tone = "bad";
    } else {
      verdict = "Qualification compromise";
      tone = "bad";
    }

    const notes = [
      "Analyse de faisceau d'indices : aucun verdict n'est jamais garanti — l'administration et le juge apprécient in concreto.",
      "Documenter l'animation : conventions d'animation, procès-verbaux, facturation effective des prestations, organigramme décisionnel.",
    ];
    if (ratio > 0.5 && !(controle && conduite)) {
      notes.push("Le ratio est atteint mais un indice qualitatif manque (contrôle effectif ou conduite de la politique du groupe) : point de fragilité majeur en cas de contrôle.");
    }
    if (!services) {
      notes.push("Les services spécifiques (administratifs, comptables, financiers) ne sont pas exigés mais renforcent le faisceau.");
    }

    return {
      kpis: [
        {
          label: "Actif affecté à l'animation",
          value: pct(ratio * 100),
          hint: `${eur(actifAnime)} sur ${eur(actifTotal)} — seuil : > 50 %`,
          tone: ratio > 0.5 ? "ok" : "bad",
        },
        { label: "Verdict", value: verdict, tone },
        {
          label: "Enjeu",
          value: "Dutreil 787 B, 150-0 D ter, IR-PME",
          hint: "Éligibilité au pacte Dutreil (787 B), à l'abattement dirigeant (150-0 D ter) et à l'IR-PME ; incidence 150-0 B ter et IFI.",
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Composition de l'actif",
          items: [
            { label: "Actif animé", value: actifAnime },
            { label: "Actif non animé", value: Math.max(0, actifTotal - actifAnime) },
          ],
        },
      ],
      notes,
      refs: ["CE, 13 juin 2018, n° 395495", "Cass. com., 14 oct. 2020", "BOI-PAT-IFI-30-10-40"],
    };
  },
};

export default def;
