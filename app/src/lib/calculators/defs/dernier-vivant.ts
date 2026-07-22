// Donation au dernier vivant (art. 1094-1 C.civ) : en présence d'enfants, le
// conjoint survivant gratifié peut choisir entre (a) l'usufruit de la totalité,
// (b) 1/4 en pleine propriété + 3/4 en usufruit, (c) la quotité disponible
// ordinaire en pleine propriété (1/2, 1/3 ou 1/4 selon le nombre d'enfants).
// On compare la VALEUR ÉCONOMIQUE de chaque option en valorisant l'usufruit au
// barème fiscal de l'art. 669 CGI (fonction de l'âge du conjoint) — aucun
// droit n'est dû, le conjoint étant exonéré (art. 796-0 bis CGI).

import type { CalculatorDef } from "../types";
import { eur, pct, num } from "../types";
import { usufruitViager } from "../bareme";

const def: CalculatorDef = {
  id: "dernier-vivant",
  title: "Donation au dernier vivant",
  description:
    "Compare la valeur économique des trois options du conjoint survivant (usufruit total, 1/4 PP + 3/4 US, quotité disponible) selon son âge.",
  category: "transmission",
  aliases: ["DDV", "donation entre époux", "1094-1", "options du conjoint survivant", "quotité disponible"],
  fields: [
    { key: "actif_successoral", label: "Actif successoral net", type: "eur", min: 0 },
    { key: "nb_enfants", label: "Nombre d'enfants", type: "int", min: 1, default: 2 },
    {
      key: "age_conjoint",
      label: "Âge du conjoint survivant",
      type: "int",
      min: 18,
      max: 110,
      help: "Détermine la valeur fiscale de l'usufruit (barème art. 669 CGI).",
    },
  ],
  compute(v) {
    const actif = num(v, "actif_successoral");
    const nb = Math.max(1, Math.round(num(v, "nb_enfants")));
    const age = num(v, "age_conjoint");

    // Quotité disponible ordinaire (art. 913 C.civ) : la réserve des enfants
    // croît avec leur nombre — 1/2 pour 1 enfant, 2/3 pour 2, 3/4 pour 3+.
    const qd = nb === 1 ? 1 / 2 : nb === 2 ? 1 / 3 : 1 / 4;
    const qdLabel = nb === 1 ? "1/2" : nb === 2 ? "1/3" : "1/4";

    // Valeur fiscale de l'usufruit viager selon l'âge (art. 669 CGI).
    const u = usufruitViager(age);

    const options = [
      { label: "a — Usufruit de la totalité", pp: 0, us: actif * u },
      { label: "b — 1/4 en pleine propriété + 3/4 en usufruit", pp: actif / 4, us: (actif * 3 / 4) * u },
      { label: `c — Quotité disponible (${qdLabel}) en pleine propriété`, pp: actif * qd, us: 0 },
    ].map((o) => ({ ...o, total: o.pp + o.us, enfants: actif - (o.pp + o.us) }));

    const best = options.reduce((a, b) => (b.total > a.total ? b : a));

    return {
      kpis: [
        {
          label: "Meilleure option (valeur économique)",
          value: eur(best.total),
          hint: best.label,
          tone: "ok",
        },
        ...options.map((o) => ({
          label: o.label,
          value: eur(o.total),
          hint: actif > 0 ? `${pct((o.total / actif) * 100)} de l'actif` : undefined,
        })),
      ],
      tables: [
        {
          title: "Comparaison des trois options (valorisation art. 669 CGI)",
          columns: ["Option", "PP reçue", "US reçu (valeur 669)", "Total économique conjoint", "Part enfants"],
          rows: options.map((o) => [o.label, eur(o.pp), eur(o.us), eur(o.total), eur(o.enfants)]),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Valeur économique reçue par le conjoint",
          items: options.map((o) => ({ label: o.label, value: o.total })),
        },
      ],
      notes: [
        `Usufruit viager valorisé à ${pct(u * 100)} de la pleine propriété (conjoint de ${age} ans, art. 669 CGI) — c'est une valeur FISCALE, pas économique : le choix réel dépend aussi des besoins en revenus ou en capital du conjoint.`,
        "Aucun droit de succession : le conjoint survivant est exonéré (art. 796-0 bis CGI).",
        "Le conjoint peut CANTONNER son émolument (n'accepter qu'une partie, art. 1094-1 al. 2 C.civ) — non modélisé ici.",
        "En présence d'enfants non communs, l'option usufruit total légale n'existe pas sans DDV — c'est justement l'un de ses apports.",
      ],
      refs: ["Art. 1094-1 C.civ", "Art. 669 CGI", "Art. 796-0 bis CGI"],
    };
  },
};

export default def;
