// Territorialité des DMTG (art. 750 ter CGI) — trois règles en cascade :
// 1° donateur/défunt domicilié fiscalement en France → taxation française sur
//    le patrimoine MONDIAL ; 2° sinon, bénéficiaire domicilié en France ET
//    l'ayant été au moins 6 des 10 dernières années → taxation MONDIALE aussi ;
// 3° sinon → seuls les biens SITUÉS EN FRANCE sont taxables. L'impôt acquitté
// à l'étranger est imputable (art. 784 A) mais n'est pas calculé ici.

import type { CalculatorDef, CalcValues } from "../types";
import { eur, pct, num, str, bool } from "../types";
import { LIEN_OPTIONS, type LienParente } from "../bareme";
import { dmtgPourBase, type ModeMutation } from "./_lotA";

const def: CalculatorDef = {
  id: "territorialite-dmtg",
  title: "Territorialité des DMTG",
  description:
    "Assiette française d'une donation ou succession internationale selon les domiciles (art. 750 ter CGI), puis droits au barème du lien.",
  category: "transmission",
  aliases: ["750 ter", "succession internationale", "donation internationale", "non-résident", "biens à l'étranger"],
  fields: [
    { key: "domicile_donateur_france", label: "Donateur / défunt domicilié fiscalement en France", type: "bool", default: true },
    { key: "domicile_beneficiaire_france", label: "Bénéficiaire domicilié fiscalement en France", type: "bool", default: true },
    {
      key: "beneficiaire_6_des_10",
      label: "Bénéficiaire domicilié en France au moins 6 des 10 dernières années",
      type: "bool",
      default: false,
      help: "Condition du 3° de l'art. 750 ter CGI pour la taxation mondiale côté bénéficiaire.",
      showIf: (v: CalcValues) => v.domicile_beneficiaire_france === true,
    },
    { key: "biens_france", label: "Biens situés en France", type: "eur", min: 0 },
    { key: "biens_etranger", label: "Biens situés à l'étranger", type: "eur", min: 0 },
    { key: "lien", label: "Lien de parenté", type: "enum", options: LIEN_OPTIONS },
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
    {
      key: "abattement_consomme",
      label: "Abattement déjà consommé",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations de moins de 15 ans au même bénéficiaire (art. 784 CGI).",
    },
  ],
  compute(v) {
    const donateurFr = bool(v, "domicile_donateur_france");
    const benefFr = bool(v, "domicile_beneficiaire_france");
    const six = bool(v, "beneficiaire_6_des_10");
    const biensFr = num(v, "biens_france");
    const biensEtr = num(v, "biens_etranger");
    const lien = (str(v, "lien") || "enfant") as LienParente;
    const mode = (str(v, "mode") || "donation") as ModeMutation;

    // Cascade de l'art. 750 ter : le domicile du donateur prime, puis celui du
    // bénéficiaire (avec la condition des 6 ans sur 10), sinon rattachement réel.
    let assiette: number;
    let regle: string;
    let regleNote: string;
    if (donateurFr) {
      assiette = biensFr + biensEtr;
      regle = "Taxation mondiale (750 ter 1°)";
      regleNote =
        "Le donateur/défunt est domicilié fiscalement en France : la France taxe l'ensemble des biens, situés en France comme à l'étranger (art. 750 ter 1° CGI).";
    } else if (benefFr && six) {
      assiette = biensFr + biensEtr;
      regle = "Taxation mondiale (750 ter 3°)";
      regleNote =
        "Le donateur/défunt est domicilié hors de France, mais le bénéficiaire est domicilié en France et l'a été au moins 6 des 10 dernières années : la France taxe l'ensemble des biens (art. 750 ter 3° CGI).";
    } else {
      assiette = biensFr;
      regle = "Biens français seuls (750 ter 2°)";
      regleNote =
        "Ni le donateur/défunt ni le bénéficiaire (condition des 6 ans sur 10 non remplie) ne rattachent la mutation à la France : seuls les biens situés en France sont taxables (art. 750 ter 2° CGI).";
    }

    const { droits, detail } = dmtgPourBase(lien, mode, assiette, num(v, "abattement_consomme"));

    return {
      kpis: [
        { label: "Assiette française retenue", value: eur(assiette), hint: `sur ${eur(biensFr + biensEtr)} au total` },
        { label: "Droits dus en France", value: eur(droits), tone: droits > 0 ? "bad" : "ok" },
        { label: "Règle appliquée", value: regle },
      ],
      tables: [
        {
          title: "Détail du barème",
          columns: ["Tranche", "Taux", "Assiette", "Droits"],
          rows: detail.map((d) => [d.tranche, pct(d.taux * 100), eur(d.assiette), eur(d.droits)]),
        },
      ],
      notes: [
        regleNote,
        "L'impôt acquitté à l'étranger sur les biens étrangers est imputable sur l'impôt français (art. 784 A CGI) — non calculé ici ; les conventions fiscales bilatérales peuvent déroger à ces règles.",
      ],
      refs: ["Art. 750 ter CGI", "Art. 784 A CGI"],
    };
  },
};

export default def;
