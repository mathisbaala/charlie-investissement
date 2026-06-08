import { Font } from "@react-pdf/renderer";

// ─────────────────────────────────────────────────────────────────────────────
// ADN visuel Charlie — partagé par tous les documents PDF (rapports, fiches).
// Même palette terre/terracotta que l'app (cf. globals.css) + typographie
// éditoriale (Instrument Serif en display, DM Sans en texte, DM Mono pour les
// chiffres tabulaires). Polices servies en WOFF par jsDelivr (CDN fiable,
// supporté par @react-pdf/fontkit). Inspiration : charlie-reporting (cartes,
// gros chiffres, labels eyebrow, hairlines).
// ─────────────────────────────────────────────────────────────────────────────

const FS = "https://cdn.jsdelivr.net/npm";

let registered = false;

/** Enregistre les polices Charlie. Idempotent — sûr à appeler à chaque rendu. */
export function registerCharlieFonts() {
  if (registered) return;
  registered = true;

  Font.register({
    family: "DMSans",
    fonts: [
      { src: `${FS}/@fontsource/dm-sans@5.0.18/files/dm-sans-latin-400-normal.woff`, fontWeight: 400 },
      { src: `${FS}/@fontsource/dm-sans@5.0.18/files/dm-sans-latin-500-normal.woff`, fontWeight: 500 },
      { src: `${FS}/@fontsource/dm-sans@5.0.18/files/dm-sans-latin-700-normal.woff`, fontWeight: 700 },
    ],
  });
  Font.register({
    family: "InstrumentSerif",
    src: `${FS}/@fontsource/instrument-serif@5.0.18/files/instrument-serif-latin-400-normal.woff`,
  });
  Font.register({
    family: "DMMono",
    fonts: [
      { src: `${FS}/@fontsource/dm-mono@5.0.20/files/dm-mono-latin-400-normal.woff`, fontWeight: 400 },
      { src: `${FS}/@fontsource/dm-mono@5.0.20/files/dm-mono-latin-500-normal.woff`, fontWeight: 500 },
    ],
  });

  // Pas de césure automatique : garde les noms de fonds / labels intacts.
  Font.registerHyphenationCallback((word) => [word]);
}

/** Palette terracotta Charlie, en hex (équivalents des tokens OKLCH de l'app). */
export const C = {
  cream: "#F4EFE4", // fond global chaud
  paper: "#FCFAF4", // cartes / panneaux
  paper2: "#EFE9DD", // surface alternée
  ink: "#2B2722", // texte principal (encre brune)
  ink2: "#5C544A", // texte secondaire
  muted: "#857D72", // labels, texte tertiaire
  line: "#E2DACB", // bordures cartes
  lineSoft: "#EDE7DB", // séparateurs discrets
  clay: "#9A4222", // accent terracotta
  claySoft: "#F1E2D6", // fond accent doux
  clayInk: "#6E3219", // texte sur fond accent
  green: "#1E7A4F", // performance positive
  greenSoft: "#E4EFE8",
  red: "#A83A2A", // performance négative (brique chaude)
  redSoft: "#F3E3DD",
  gold: "#9A7B33", // signal secondaire (rétro, alertes)
  goldSoft: "#F4EAD3",
} as const;

export const FONT = {
  serif: "InstrumentSerif",
  sans: "DMSans",
  mono: "DMMono",
} as const;

/** Couleur d'une performance selon son signe. */
export function perfColor(n: number | null | undefined): string {
  if (n == null) return C.ink2;
  return n >= 0 ? C.green : C.red;
}
