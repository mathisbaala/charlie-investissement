// Impôt sur la fortune immobilière (art. 964 s. CGI) : assujettissement au-delà
// de 1,3 M€ de patrimoine immobilier net taxable, barème progressif dès
// 800 000 € (art. 977), décote entre 1,3 et 1,4 M€, plafonnement à 75 % des
// revenus (art. 979), abattement de 30 % sur la résidence principale (art. 973).

import type { CalculatorDef } from "../types";
import { eur, pct, num } from "../types";
import { applyBareme, type Tranche } from "../bareme";

/** Barème IFI (art. 977 CGI) — inchangé depuis la création de l'IFI (2018). */
const BAREME_IFI: Tranche[] = [
  { jusqua: 800_000, taux: 0 },
  { jusqua: 1_300_000, taux: 0.005 },
  { jusqua: 2_570_000, taux: 0.007 },
  { jusqua: 5_000_000, taux: 0.01 },
  { jusqua: 10_000_000, taux: 0.0125 },
  { jusqua: Infinity, taux: 0.015 },
];

const SEUIL_ASSUJETTISSEMENT = 1_300_000;
const PLAFOND_DECOTE = 1_400_000; // décote = 17 500 − 1,25 % × P entre 1,3 et 1,4 M€
const ABATTEMENT_RP = 0.3; // résidence principale (art. 973)
const TAUX_PLAFONNEMENT = 0.75; // 75 % des revenus (art. 979)

const def: CalculatorDef = {
  id: "ifi",
  title: "Impôt sur la fortune immobilière",
  description:
    "IFI (art. 964 s. CGI) : barème progressif, décote entre 1,3 et 1,4 M€, abattement de 30 % sur la résidence principale et plafonnement à 75 % des revenus.",
  category: "transmission",
  aliases: ["IFI", "fortune immobilière", "977 CGI", "plafonnement IFI", "décote IFI"],
  fields: [
    {
      key: "patrimoine_immo_net",
      label: "Patrimoine immobilier net taxable",
      type: "eur",
      min: 0,
      help: "Hors résidence principale, net des dettes déductibles (art. 974 CGI).",
    },
    {
      key: "residence_principale",
      label: "Valeur de la résidence principale",
      type: "eur",
      default: 0,
      min: 0,
      help: "Abattement de 30 % appliqué automatiquement (art. 973 CGI).",
    },
    {
      key: "revenus",
      label: "Revenus mondiaux de l'année",
      type: "eur",
      default: 0,
      min: 0,
      required: false,
      help: "Renseigner pour calculer le plafonnement : IFI + IR + PS ≤ 75 % des revenus (art. 979 CGI).",
    },
    {
      key: "autres_impots",
      label: "IR + prélèvements sociaux de l'année",
      type: "eur",
      default: 0,
      min: 0,
      required: false,
      help: "Impôts pris en compte dans le plafonnement, hors IFI.",
    },
  ],
  compute(v) {
    const horsRp = num(v, "patrimoine_immo_net");
    const rp = num(v, "residence_principale");
    const revenus = num(v, "revenus");
    const autresImpots = num(v, "autres_impots");

    // Assiette : patrimoine hors RP + résidence principale après abattement 30 %.
    const assiette = horsRp + rp * (1 - ABATTEMENT_RP);
    const assujetti = assiette > SEUIL_ASSUJETTISSEMENT;

    // Barème progressif (appliqué dès 800 000 € une fois le seuil franchi).
    const bareme = applyBareme(BAREME_IFI, assiette);
    const brut = assujetti ? bareme.droits : 0;

    // Décote entre 1,3 et 1,4 M€ : 17 500 − 1,25 % × P.
    const decote =
      assujetti && assiette <= PLAFOND_DECOTE ? Math.max(0, 17_500 - 0.0125 * assiette) : 0;
    const apresDecote = Math.max(0, brut - decote);

    // Plafonnement (art. 979) : IFI + IR + PS ≤ 75 % des revenus mondiaux —
    // calculé seulement si les revenus sont renseignés.
    let reductionPlafonnement = 0;
    if (assujetti && revenus > 0) {
      reductionPlafonnement = Math.max(0, apresDecote + autresImpots - revenus * TAUX_PLAFONNEMENT);
      reductionPlafonnement = Math.min(reductionPlafonnement, apresDecote);
    }

    const ifiDu = apresDecote - reductionPlafonnement;
    const tauxMoyen = assiette > 0 ? (ifiDu / assiette) * 100 : 0;

    const notes = [
      `Assiette taxable : ${eur(assiette)} (résidence principale retenue pour ${eur(rp * (1 - ABATTEMENT_RP))} après abattement de 30 %).`,
      "Assujettissement si le patrimoine net taxable excède 1 300 000 € — mais le barème s'applique alors dès 800 000 €.",
    ];
    if (!assujetti) notes.push("Patrimoine net taxable ≤ 1 300 000 € : pas d'IFI dû.");
    if (revenus === 0) notes.push("Plafonnement non calculé (revenus non renseignés).");

    return {
      kpis: [
        { label: "IFI dû", value: eur(ifiDu), tone: ifiDu > 0 ? "bad" : "ok" },
        { label: "Taux moyen sur l'assiette", value: pct(tauxMoyen) },
        { label: "Effet de la décote", value: eur(decote), tone: decote > 0 ? "ok" : undefined },
        {
          label: "Effet du plafonnement",
          value: eur(reductionPlafonnement),
          tone: reductionPlafonnement > 0 ? "ok" : undefined,
        },
      ],
      tables: [
        {
          title: "Barème appliqué (art. 977 CGI)",
          columns: ["Tranche", "Taux", "Assiette", "IFI"],
          rows: bareme.detail.map((d) => [d.tranche, pct(d.taux * 100), eur(d.assiette), eur(d.droits)]),
        },
      ],
      notes,
      refs: ["Art. 964 CGI", "Art. 973 CGI", "Art. 977 CGI", "Art. 979 CGI"],
    };
  },
};

export default def;
