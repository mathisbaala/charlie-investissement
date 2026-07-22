// AV vs contrat de capitalisation pour la transmission : pour un même capital,
// compare la fiscalité au décès (990 I hors succession) à celle d'un contrat de
// capitalisation transmis par succession ou donné de son vivant (DMTG).

import type { CalculatorDef } from "../types";
import { eur, num, str } from "../types";
import { LIEN_OPTIONS, prelevement990I, type LienParente } from "../bareme";
import { droitsDmtg } from "./_lotC";

const def: CalculatorDef = {
  id: "av-vs-capitalisation",
  title: "AV vs contrat de capitalisation pour la transmission",
  description:
    "Compare la fiscalité de transmission d'un même capital : assurance-vie (990 I), capitalisation transmise par succession ou donnée de son vivant (DMTG).",
  category: "transmission",
  aliases: ["contrat de capitalisation", "capi vs AV", "990 I vs DMTG", "transmission capitalisation"],
  fields: [
    { key: "capital", label: "Capital à transmettre", type: "eur", min: 0 },
    { key: "nb_beneficiaires", label: "Nombre de bénéficiaires / héritiers", type: "int", default: 1, min: 1, max: 20 },
    {
      key: "lien",
      label: "Lien de parenté",
      type: "enum",
      options: LIEN_OPTIONS,
      default: "enfant",
    },
    {
      key: "abattement_consomme",
      label: "Abattement DMTG déjà consommé (par bénéficiaire)",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations de moins de 15 ans au même bénéficiaire (art. 784 CGI) — n'affecte pas le 990 I.",
    },
  ],
  compute(v) {
    const capital = num(v, "capital");
    const nb = Math.max(1, num(v, "nb_beneficiaires"));
    const lien = (str(v, "lien") || "enfant") as LienParente;
    const consomme = num(v, "abattement_consomme");
    const part = capital / nb;

    // A — Assurance-vie : hors succession, 990 I par bénéficiaire (hypothèse :
    // primes versées avant 70 ans, parts égales). Conjoint/PACS : exonéré (TEPA).
    const impotAv = lien === "epoux" ? 0 : prelevement990I(part) * nb;

    // B — Capitalisation transmise PAR SUCCESSION : DMTG selon le lien, par
    // héritier (abattement successoral + barème). Le contrat n'est pas dénoué.
    const succ = droitsDmtg(part, lien, "succession", consomme);
    const impotSucc = succ.droits * nb;

    // C — Capitalisation DONNÉE DE SON VIVANT : DMTG donation, par donataire,
    // avec purge des produits latents (BOI-RPPM-RCM-20-10-20-50).
    const don = droitsDmtg(part, lien, "donation", consomme);
    const impotDon = don.droits * nb;

    const scenarios = [
      { label: "Assurance-vie (990 I)", impot: impotAv, obs: "Hors succession, abattement 152 500 € par bénéficiaire" },
      { label: "Capitalisation — succession", impot: impotSucc, obs: succ.exonere ? "Exonérée (époux/PACS)" : "Antériorité fiscale conservée par l'héritier" },
      { label: "Capitalisation — donation", impot: impotDon, obs: "Produits latents purgés, antériorité conservée" },
    ].map((s) => ({ ...s, net: capital - s.impot }));

    const meilleur = scenarios.reduce((a, b) => (b.impot < a.impot ? b : a));
    const ecartMax = Math.max(...scenarios.map((s) => s.impot)) - Math.min(...scenarios.map((s) => s.impot));

    return {
      kpis: [
        {
          label: "Meilleur scénario",
          value: meilleur.label,
          hint: `Net transmis : ${eur(meilleur.net)} — fiscalité : ${eur(meilleur.impot)}`,
          tone: "ok",
        },
        { label: "Écart max de fiscalité entre scénarios", value: eur(ecartMax), tone: ecartMax > 0 ? "bad" : "ok" },
      ],
      tables: [
        {
          title: "Comparaison des trois voies de transmission",
          columns: ["Scénario", "Impôt", "Net transmis", "Observations"],
          rows: scenarios.map((s) => [s.label, eur(s.impot), eur(s.net), s.obs]),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Net transmis par scénario",
          items: scenarios.map((s) => ({ label: s.label, value: s.net })),
        },
      ],
      notes: [
        "Hypothèses : primes d'assurance-vie versées avant 70 ans (régime 990 I), parts égales entre bénéficiaires, mêmes bénéficiaires dans les trois scénarios.",
        "Capitalisation par succession : le contrat n'est PAS dénoué — l'héritier conserve l'antériorité fiscale du contrat (durée de détention pour les rachats).",
        "Capitalisation donnée de son vivant : les produits latents sont purgés — le prix d'acquisition retenu pour les rachats ultérieurs est la valeur au jour de la donation (BOI-RPPM-RCM-20-10-20-50).",
        "DMTG : l'abattement et le barème s'appliquent par bénéficiaire ; l'abattement déjà consommé (donations < 15 ans) est déduit.",
      ],
      refs: ["Art. 990 I CGI", "Art. 777 CGI", "Art. 779 CGI", "BOI-RPPM-RCM-20-10-20-50"],
    };
  },
};

export default def;
