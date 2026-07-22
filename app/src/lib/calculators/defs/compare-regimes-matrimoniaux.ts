// Comparaison des régimes matrimoniaux au premier décès : mêmes chiffres de
// patrimoine, cinq liquidations côte à côte. L'enjeu est direct : la masse
// successorale est l'assiette taxable des enfants — changer de régime (ou de
// clause) déplace des centaines de milliers d'euros d'assiette. Réutilise la
// mécanique de `_lotB` pour rester cohérent avec `masse-successorale`.

import type { CalculatorDef } from "../types";
import { eur, num } from "../types";
import { REGIME_OPTIONS, isRegimeCommunautaire, masseSelonRegime } from "./_lotB";

/** Libellés courts pour le bar chart (les labels complets vont dans la table). */
const LABELS_COURTS: Record<string, string> = {
  communaute_legale: "Communauté légale",
  communaute_universelle: "Universelle",
  communaute_universelle_attribution: "Attribution intégrale",
  separation: "Séparation",
  participation: "Participation",
};

const def: CalculatorDef = {
  id: "compare-regimes-matrimoniaux",
  title: "Comparaison des régimes matrimoniaux au premier décès",
  description:
    "Masse successorale et patrimoine du conjoint hors succession, régime par régime, à patrimoine identique.",
  category: "transmission",
  aliases: ["changement de régime matrimonial", "quel régime matrimonial", "comparatif communauté séparation"],
  fields: [
    {
      key: "biens_communs",
      label: "Acquêts du couple",
      type: "eur",
      min: 0,
      help: "Patrimoine constitué pendant le mariage — biens communs dans les régimes communautaires.",
    },
    { key: "propres_defunt", label: "Biens propres du défunt", type: "eur", min: 0 },
    { key: "propres_conjoint", label: "Biens propres du conjoint survivant", type: "eur", min: 0 },
    {
      key: "part_acquets_defunt",
      label: "Part des acquêts au nom du défunt",
      type: "pct",
      default: 50,
      min: 0,
      max: 100,
      help: "Part des acquêts au nom du défunt (séparation/participation).",
    },
  ],
  compute(v) {
    const acquets = num(v, "biens_communs");
    const propresDefunt = num(v, "propres_defunt");
    const propresConjoint = num(v, "propres_conjoint");
    const part = num(v, "part_acquets_defunt") / 100;

    // Une seule saisie, deux lectures : en régime communautaire les acquêts
    // forment la masse commune ; en séparation/participation ils se répartissent
    // entre les époux selon la part détenue au nom du défunt.
    const resultats = REGIME_OPTIONS.map((opt) => {
      const communautaire = isRegimeCommunautaire(opt.value);
      const r = masseSelonRegime(opt.value, {
        propresDefunt,
        propresConjoint,
        biensCommuns: communautaire ? acquets : 0,
        acquetsDefunt: communautaire ? 0 : acquets * part,
        acquetsConjoint: communautaire ? 0 : acquets * (1 - part),
      });
      return { ...opt, ...r };
    });

    const masseMin = resultats.reduce((a, b) => (b.masse < a.masse ? b : a));
    const masseMax = resultats.reduce((a, b) => (b.masse > a.masse ? b : a));

    return {
      kpis: [
        { label: "Masse la plus faible", value: eur(masseMin.masse), hint: masseMin.label, tone: "ok" },
        { label: "Masse la plus élevée", value: eur(masseMax.masse), hint: masseMax.label },
        { label: "Écart entre régimes", value: eur(masseMax.masse - masseMin.masse) },
      ],
      tables: [
        {
          title: "Comparaison au premier décès",
          columns: ["Régime", "Patrimoine du conjoint hors succession", "Masse successorale"],
          rows: resultats.map((r) => [r.label, eur(r.conjointHorsSuccession), eur(r.masse)]),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Masse successorale par régime",
          items: resultats.map((r) => ({ label: LABELS_COURTS[r.value], value: r.masse })),
        },
      ],
      notes: [
        "La masse successorale est l'assiette taxable des enfants : elle dépend directement du régime (et de ses clauses).",
        "Une masse faible au premier décès (attribution intégrale…) reporte et concentre la taxation au second décès.",
        "Comparaison à patrimoine identique, hors avantages matrimoniaux particuliers, récompenses et donations entre époux.",
      ],
      refs: ["Art. 1400 s. C.civ.", "Art. 1526 C.civ.", "Art. 1569 C.civ."],
    };
  },
};

export default def;
