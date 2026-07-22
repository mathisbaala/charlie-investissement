// Fiscalité successorale de l'assurance-vie : prélèvement 990 I (primes avant
// 70 ans, par bénéficiaire) + régime 757 B (primes après 70 ans, abattement
// global 30 500 € puis DMTG selon le lien).

import type { CalculatorDef } from "../types";
import { eur, num, str, bool } from "../types";
import {
  LIEN_OPTIONS,
  baremeForLien,
  abattementSuccession,
  applyBareme,
  prelevement990I,
  AV_990I_ABATTEMENT,
  AV_757B_ABATTEMENT_GLOBAL,
  type LienParente,
} from "../bareme";

const def: CalculatorDef = {
  id: "assurance-vie-succession",
  title: "Assurance-vie succession",
  description: "Fiscalité successorale de l'assurance-vie (art. 990 I + 757 B CGI).",
  category: "transmission",
  aliases: ["990 I", "757 B", "capitaux décès", "primes après 70 ans", "clause bénéficiaire"],
  fields: [
    {
      key: "capital_avant70",
      label: "Capitaux décès issus de primes versées avant 70 ans",
      type: "eur",
      min: 0,
      help: "Valeur au décès des compartiments alimentés avant les 70 ans de l'assuré (régime 990 I).",
    },
    { key: "nb_beneficiaires", label: "Nombre de bénéficiaires", type: "int", default: 1, min: 1, max: 20 },
    {
      key: "nb_exoneres",
      label: "Dont bénéficiaires exonérés (conjoint / PACS)",
      type: "int",
      default: 0,
      min: 0,
      help: "Le conjoint et le partenaire PACS sont exonérés du 990 I comme du 757 B (loi TEPA).",
    },
    {
      key: "primes_apres70",
      label: "Primes versées après 70 ans",
      type: "eur",
      default: 0,
      min: 0,
      help: "Seules les PRIMES sont taxables (757 B) — les produits sont exonérés.",
    },
    {
      key: "lien",
      label: "Lien de parenté des bénéficiaires taxables",
      type: "enum",
      options: LIEN_OPTIONS,
      default: "enfant",
      showIf: (v) => num(v, "primes_apres70") > 0,
    },
    {
      key: "abattement_dispo",
      label: "Abattement successoral personnel encore disponible",
      type: "bool",
      default: true,
      help: "Le bénéficiaire taxé au 757 B profite aussi de son abattement personnel (ex. 100 000 € en ligne directe) s'il n'est pas consommé par ailleurs.",
      showIf: (v) => num(v, "primes_apres70") > 0,
    },
  ],
  compute(v) {
    const capital = num(v, "capital_avant70");
    const nb = Math.max(1, num(v, "nb_beneficiaires"));
    const nbExo = Math.min(num(v, "nb_exoneres"), nb);
    const nbTaxables = nb - nbExo;
    const primes70 = num(v, "primes_apres70");
    const lien = (str(v, "lien") || "enfant") as LienParente;

    // 990 I : par bénéficiaire, parts égales (hypothèse), abattement 152 500 chacun.
    const part = capital / nb;
    const p990parBenef = prelevement990I(part);
    const p990 = p990parBenef * nbTaxables;

    // 757 B : abattement global 30 500 € (partagé entre bénéficiaires non exonérés),
    // puis DMTG selon le lien, avec l'abattement personnel s'il est disponible.
    let dmtg757 = 0;
    let base757 = 0;
    if (primes70 > 0 && nbTaxables > 0) {
      base757 = Math.max(0, primes70 - AV_757B_ABATTEMENT_GLOBAL);
      const perso = bool(v, "abattement_dispo") ? abattementSuccession(lien) : 0;
      const taxable = perso === Infinity ? 0 : Math.max(0, base757 - perso * nbTaxables);
      dmtg757 = applyBareme(baremeForLien(lien), taxable / Math.max(1, nbTaxables)).droits * nbTaxables;
    }

    const total = p990 + dmtg757;
    const transmis = capital + primes70;

    const notes = [
      "Hypothèse : parts égales entre bénéficiaires. Le 990 I s'applique par bénéficiaire (abattement de 152 500 € chacun), le 757 B par contrat (abattement global de 30 500 €).",
      "757 B : seules les primes versées après 70 ans sont taxables — les intérêts et plus-values de ce compartiment sont exonérés.",
    ];
    if (nbExo > 0) notes.push("Conjoint / partenaire PACS : exonération totale (990 I et 757 B).");

    return {
      kpis: [
        { label: "Prélèvement 990 I", value: eur(p990), tone: p990 > 0 ? "bad" : "ok" },
        { label: "DMTG 757 B", value: eur(dmtg757), tone: dmtg757 > 0 ? "bad" : "ok" },
        { label: "Fiscalité totale", value: eur(total), tone: total > 0 ? "bad" : "ok" },
        { label: "Net aux bénéficiaires", value: eur(transmis - total), tone: "ok" },
      ],
      tables: [
        {
          title: "Détail par régime",
          columns: ["Régime", "Assiette", "Abattement", "Impôt"],
          rows: [
            [
              "990 I (par bénéficiaire taxable)",
              eur(part),
              eur(Math.min(part, AV_990I_ABATTEMENT)),
              eur(p990parBenef),
            ],
            [
              "757 B (global)",
              eur(primes70),
              eur(Math.min(primes70, AV_757B_ABATTEMENT_GLOBAL)),
              eur(dmtg757),
            ],
          ],
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Capitaux décès",
          items: [
            { label: "Net transmis", value: transmis - total },
            { label: "Fiscalité", value: total },
          ],
        },
      ],
      notes,
      refs: ["Art. 990 I CGI", "Art. 757 B CGI", "Art. 796-0 bis CGI"],
    };
  },
};

export default def;
