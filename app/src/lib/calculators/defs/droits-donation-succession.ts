// Droits de donation / succession — le calculateur pivot : abattement selon le
// lien, barème progressif art. 777, option Dutreil (787 B : exonération 75 %)
// et réduction 50 % (790 CGI) pour donation d'entreprise en PP avant 70 ans.

import type { CalculatorDef, CalcValues } from "../types";
import { eur, pct, num, str, bool } from "../types";
import {
  LIEN_OPTIONS,
  baremeForLien,
  abattementDonation,
  abattementSuccession,
  applyBareme,
  ABATTEMENT_HANDICAP,
  EXO_DUTREIL,
  REDUCTION_DUTREIL_PP_MOINS_70,
  type LienParente,
} from "../bareme";

const def: CalculatorDef = {
  id: "droits-donation-succession",
  title: "Droits de donation / succession",
  description:
    "Droits de mutation à titre gratuit avec abattements, barème progressif, Dutreil et réduction pour âge du donateur.",
  category: "transmission",
  aliases: ["DMTG", "droits de mutation", "barème donation", "art. 777", "Dutreil", "787 B"],
  fields: [
    {
      key: "mode",
      label: "Opération",
      type: "enum",
      options: [
        { value: "donation", label: "Donation" },
        { value: "succession", label: "Succession" },
      ],
      default: "donation",
    },
    { key: "lien", label: "Lien de parenté (donataire/héritier)", type: "enum", options: LIEN_OPTIONS },
    { key: "montant", label: "Montant transmis", type: "eur", min: 0 },
    {
      key: "abattement_consomme",
      label: "Abattement déjà consommé (15 dernières années)",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations antérieures de moins de 15 ans rappelées fiscalement (art. 784 CGI).",
    },
    {
      key: "handicap",
      label: "Bénéficiaire en situation de handicap",
      type: "bool",
      default: false,
      help: "Abattement supplémentaire de 159 325 € (art. 779 II CGI), cumulable.",
    },
    {
      key: "dutreil",
      label: "Titres d'entreprise sous pacte Dutreil",
      type: "bool",
      default: false,
      help: "Exonération de 75 % de la valeur (art. 787 B CGI).",
    },
    {
      key: "donateur_moins_70",
      label: "Donateur de moins de 70 ans (donation en pleine propriété)",
      type: "bool",
      default: false,
      help: "Réduction de droits de 50 % (art. 790 CGI).",
      showIf: (v: CalcValues) => v.dutreil === true && v.mode !== "succession",
    },
  ],
  compute(v) {
    const mode = str(v, "mode") || "donation";
    const lien = (str(v, "lien") || "enfant") as LienParente;
    const montant = num(v, "montant");
    const consomme = num(v, "abattement_consomme");
    const notes: string[] = [];
    const refs = ["Art. 777, 779, 784 CGI"];

    if (mode === "succession" && lien === "epoux") {
      return {
        kpis: [
          { label: "Droits de succession", value: eur(0), tone: "ok" },
          { label: "Net transmis", value: eur(montant), tone: "ok" },
        ],
        notes: ["Le conjoint survivant et le partenaire PACS sont exonérés de droits de succession (loi TEPA)."],
        refs: ["Art. 796-0 bis CGI"],
      };
    }

    // Assiette : Dutreil exonère 75 % de la valeur des titres.
    let base = montant;
    if (bool(v, "dutreil")) {
      base = montant * (1 - EXO_DUTREIL);
      notes.push(`Pacte Dutreil : assiette réduite à 25 % de la valeur (${eur(base)}).`);
      refs.push("Art. 787 B CGI");
    }

    // Abattement selon le mode, amputé de la part déjà consommée.
    const plein = mode === "donation" ? abattementDonation(lien) : abattementSuccession(lien);
    let abattement = Math.max(0, plein - consomme);
    if (bool(v, "handicap")) {
      abattement += ABATTEMENT_HANDICAP;
      refs.push("Art. 779 II CGI");
    }
    const taxable = Math.max(0, base - abattement);

    const { droits: bruts, detail } = applyBareme(baremeForLien(lien), taxable);

    // Réduction 790 : donation Dutreil en PP, donateur < 70 ans.
    let droits = bruts;
    if (bool(v, "dutreil") && mode === "donation" && bool(v, "donateur_moins_70")) {
      droits = bruts * (1 - REDUCTION_DUTREIL_PP_MOINS_70);
      notes.push("Réduction de droits de 50 % : donation en pleine propriété de titres Dutreil avant 70 ans.");
      refs.push("Art. 790 CGI");
    }

    if (mode === "succession" && (lien === "petit_enfant" || lien === "arriere_petit_enfant")) {
      notes.push(
        "Petit-enfant venant en REPRÉSENTATION d'un parent prédécédé : l'abattement de 100 000 € du parent se partage entre les représentants (non pris en compte ici).",
      );
    }

    return {
      kpis: [
        { label: mode === "donation" ? "Droits de donation" : "Droits de succession", value: eur(droits), tone: droits > 0 ? "bad" : "ok" },
        { label: "Abattement appliqué", value: eur(Math.min(abattement, base)) },
        { label: "Taux moyen effectif", value: montant > 0 ? pct((droits / montant) * 100) : pct(0) },
        { label: "Net transmis", value: eur(montant - droits), tone: "ok" },
      ],
      tables: [
        {
          title: "Détail du barème",
          columns: ["Tranche", "Taux", "Assiette", "Droits"],
          rows: detail.map((d) => [d.tranche, pct(d.taux * 100), eur(d.assiette), eur(d.droits)]),
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Répartition du montant transmis",
          items: [
            { label: "Net transmis", value: montant - droits },
            { label: "Droits", value: droits },
          ],
        },
      ],
      notes,
      refs: [...new Set(refs)],
    };
  },
};

export default def;
