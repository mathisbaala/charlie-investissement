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

/** Palette Charlie par défaut, en hex (équivalents des tokens OKLCH de l'app —
    tonalité neutre/lin + accent clay, alignée Charlie Prospection). */
const DEFAULTS = {
  cream: "#F5F3F0", // fond global neutre
  paper: "#FCFCF9", // cartes / panneaux (blanc cassé froid)
  paper2: "#EDEBE7", // surface alternée
  ink: "#1B1A18", // texte principal (encre)
  ink2: "#3B3A38", // texte secondaire
  muted: "#7C7A76", // labels, texte tertiaire
  line: "#C9C7C2", // bordures cartes
  lineSoft: "#DFDEDA", // séparateurs discrets
  clay: "#8F4A31", // accent (clay désaturé) — surchargé par la marque du cabinet
  claySoft: "#EFCBBB", // fond accent doux
  clayInk: "#5E2411", // texte sur fond accent
  clayOnDark: "#C88A6E", // accent éclairci, lisible sur la couverture sombre
  green: "#1E7A4F", // performance positive
  greenSoft: "#E4EFE8",
  red: "#A83A2A", // performance négative (brique chaude)
  redSoft: "#F3E3DD",
  gold: "#9A7B33", // signal secondaire (rétro, alertes)
  goldSoft: "#F4EAD3",
};

/** Palette VIVANTE : mutable pour que la marque du cabinet (couleur de son site)
    remplace l'accent clay dans les documents. Tous les accents des PDF passent
    par ces clés ; setBrandAccent() les réécrit avant le rendu. */
export const C: Record<keyof typeof DEFAULTS, string> = { ...DEFAULTS };

function hx(h: string): [number, number, number] {
  const t = h.replace("#", "");
  return [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)];
}
function mix(hex: string, target: string, t: number): string {
  const [r1, g1, b1] = hx(hex);
  const [r2, g2, b2] = hx(target);
  const c = (a: number, b: number) => Math.round(a + (b - a) * t);
  return (
    "#" +
    [c(r1, r2), c(g1, g2), c(b1, b2)]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Applique la couleur de marque du cabinet à tous les accents des PDF, ou
 * rétablit l'accent clay Charlie si `accent` est nul. Les nuances dérivées (fond
 * doux, texte, version claire pour la couverture sombre) sont calculées pour
 * rester cohérentes et lisibles. À appeler AVANT chaque rendu de document.
 */
export function setBrandAccent(accent: string | null | undefined): void {
  if (!accent || !/^#?[0-9a-fA-F]{6}$/.test(accent.replace("#", ""))) {
    C.clay = DEFAULTS.clay;
    C.claySoft = DEFAULTS.claySoft;
    C.clayInk = DEFAULTS.clayInk;
    C.clayOnDark = DEFAULTS.clayOnDark;
    return;
  }
  const base = accent.startsWith("#") ? accent.toLowerCase() : "#" + accent.toLowerCase();
  C.clay = base;
  C.claySoft = mix(base, "#ffffff", 0.78); // fond accent très doux
  C.clayInk = mix(base, "#000000", 0.38); // texte sur fond accent
  C.clayOnDark = mix(base, "#ffffff", 0.45); // éclairci pour la couverture sombre
}

export const FONT = {
  sans: "Inter",
  mono: "DMMono",
} as const;

/** Couleur d'une performance selon son signe. */
export function perfColor(n: number | null | undefined): string {
  if (n == null) return C.ink2;
  return n >= 0 ? C.green : C.red;
}
