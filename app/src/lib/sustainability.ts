// ─── Durabilité / DDA ─────────────────────────────────────────────────────────
// Socle exploitable du recueil des préférences de durabilité (DDA / MiFID II) :
// classification SFDR + labels officiels français. Les 3 catégories MiFID
// précises (taxonomie, investissement durable, PAI) sont enrichies en fond et
// affichées quand disponibles — jamais signalées comme manquantes.

// Labels officiels français reconnus (≠ tags internes esg/sri/cost…).
export const OFFICIAL_LABELS: { key: string; label: string; hint: string }[] = [
  { key: "isr",      label: "ISR",      hint: "Label public ISR (Bercy)" },
  { key: "greenfin", label: "Greenfin", hint: "Label vert (transition écologique)" },
  { key: "finansol", label: "Finansol", hint: "Finance solidaire" },
];

const OFFICIAL_KEYS = new Set(OFFICIAL_LABELS.map((l) => l.key));

/** Labels officiels portés par un fonds (intersection avec OFFICIAL_LABELS). */
export function officialLabelsOf(labels: string[] | null | undefined): { key: string; label: string }[] {
  if (!labels) return [];
  const set = new Set(labels.map((l) => l.toLowerCase()));
  return OFFICIAL_LABELS.filter((l) => set.has(l.key)).map(({ key, label }) => ({ key, label }));
}

/** Libellé + sens DDA d'un article SFDR. */
export function sfdrInfo(article: number | null | undefined): { tag: string; title: string; desc: string } | null {
  switch (article) {
    case 9:
      return {
        tag: "Article 9",
        title: "Objectif d'investissement durable",
        desc: "Le fonds poursuit un objectif d'investissement durable (« vert foncé »).",
      };
    case 8:
      return {
        tag: "Article 8",
        title: "Caractéristiques environnementales / sociales",
        desc: "Le fonds promeut des caractéristiques E/S sans objectif durable exclusif (« vert clair »).",
      };
    case 6:
      return {
        tag: "Article 6",
        title: "Sans objectif de durabilité",
        desc: "Le fonds n'intègre pas d'objectif de durabilité au sens SFDR.",
      };
    default:
      return null;
  }
}

// ─── Exclusions sectorielles documentées (EET) ───────────────────────────────
// Clés canoniques de investissement_funds.esg_exclusions (cf. COMMENT SQL de la
// colonne et esg-exclusions-enricher.py) → libellé d'affichage. L'ordre est
// celui d'affichage : thèmes du recueil client d'abord, normes ensuite.
export const EXCLUSION_KEY_LABELS: { key: string; label: string }[] = [
  { key: "tobacco",               label: "Tabac" },
  { key: "controversial_weapons", label: "Armes controversées" },
  { key: "weapons",               label: "Armement" },
  { key: "fossil",                label: "Énergies fossiles" },
  { key: "thermal_coal",          label: "Charbon thermique" },
  { key: "gambling",              label: "Jeux d'argent" },
  { key: "alcohol",               label: "Alcool" },
  { key: "adult_entertainment",   label: "Divertissement pour adultes" },
  { key: "nuclear",               label: "Nucléaire" },
  { key: "ungc_violations",       label: "Violations Pacte mondial ONU" },
];

/** Exclusions documentées d'un fonds, triées pour l'affichage :
 *  {excluded} = secteurs que le fonds EXCLUT, {notExcluded} = secteurs qu'il
 *  documente ne PAS exclure. Clés inconnues du vocabulaire : ignorées. */
export function exclusionEntries(
  esgExclusions: Record<string, boolean> | null | undefined,
): { excluded: { key: string; label: string }[]; notExcluded: { key: string; label: string }[] } {
  const excluded: { key: string; label: string }[] = [];
  const notExcluded: { key: string; label: string }[] = [];
  if (esgExclusions) {
    for (const { key, label } of EXCLUSION_KEY_LABELS) {
      const v = esgExclusions[key];
      if (v === true) excluded.push({ key, label });
      else if (v === false) notExcluded.push({ key, label });
    }
  }
  return { excluded, notExcluded };
}
