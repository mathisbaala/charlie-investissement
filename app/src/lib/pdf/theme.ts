import { Font } from "@react-pdf/renderer";

// ─────────────────────────────────────────────────────────────────────────────
// ADN visuel Charlie — partagé par tous les documents PDF (rapports, fiches).
// Même palette terre/terracotta (désaturée) que l'app (cf. globals.css) +
// typographie institutionnelle : Inter partout (display + texte), DM Mono pour
// les chiffres tabulaires. Plus de serif éditoriale. Polices servies en WOFF
// par jsDelivr (CDN fiable, supporté par @react-pdf/fontkit).
// ─────────────────────────────────────────────────────────────────────────────

const FS = "https://cdn.jsdelivr.net/npm";

let registered = false;

/** Enregistre les polices Charlie. Idempotent — sûr à appeler à chaque rendu. */
export function registerCharlieFonts() {
  if (registered) return;
  registered = true;

  Font.register({
    family: "Inter",
    fonts: [
      { src: `${FS}/@fontsource/inter@5.0.18/files/inter-latin-400-normal.woff`, fontWeight: 400 },
      { src: `${FS}/@fontsource/inter@5.0.18/files/inter-latin-500-normal.woff`, fontWeight: 500 },
      { src: `${FS}/@fontsource/inter@5.0.18/files/inter-latin-600-normal.woff`, fontWeight: 600 },
      { src: `${FS}/@fontsource/inter@5.0.18/files/inter-latin-700-normal.woff`, fontWeight: 700 },
    ],
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

/** Palette Charlie, en hex (équivalents des tokens OKLCH de l'app — tonalité
    neutre/lin + accent clay, alignée Charlie Prospection ; cf. globals.css). */
export const C = {
  cream: "#F5F3F0", // fond global neutre
  paper: "#FCFCF9", // cartes / panneaux (blanc cassé froid)
  paper2: "#EDEBE7", // surface alternée
  ink: "#1B1A18", // texte principal (encre)
  ink2: "#3B3A38", // texte secondaire
  muted: "#7C7A76", // labels, texte tertiaire
  line: "#C9C7C2", // bordures cartes
  lineSoft: "#DFDEDA", // séparateurs discrets
  clay: "#8F4A31", // accent clay désaturé (sobre)
  claySoft: "#EFCBBB", // fond accent doux
  clayInk: "#5E2411", // texte sur fond accent
  green: "#1E7A4F", // performance positive
  greenSoft: "#E4EFE8",
  red: "#A83A2A", // performance négative (brique chaude)
  redSoft: "#F3E3DD",
  gold: "#9A7B33", // signal secondaire (rétro, alertes)
  goldSoft: "#F4EAD3",
} as const;

export const FONT = {
  serif: "Inter",
  sans: "Inter",
  mono: "DMMono",
} as const;

/** Couleur d'une performance selon son signe. */
export function perfColor(n: number | null | undefined): string {
  if (n == null) return C.ink2;
  return n >= 0 ? C.green : C.red;
}
