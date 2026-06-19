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
