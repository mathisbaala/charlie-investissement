// ─── Marque du cabinet — personnalisation légère du screener ──────────────────
//
// Le CGP colle l'URL de son site : on en extrait son logo et sa couleur de
// marque (côté serveur, gratuitement, cf. /api/brand/extract), il valide, et le
// screener adopte ces deux éléments — logo en tête, couleur de marque sur les
// liens, onglets actifs et éléments sélectionnés. Le reste du design lisible de
// Charlie (surfaces neutres, tableaux, textes) reste INCHANGÉ : la couleur du
// client ne porte que l'accent, jamais les fonds ni le corps de texte.
//
// Deux éléments seulement, appliqués via des variables CSS surchargées en ligne
// sur <html> (le logo passe par un contexte React). C'est réversible : une
// remise à zéro efface les variables et rend son thème d'origine à Charlie.

export interface Branding {
  /** URL du site du cabinet, telle que saisie (peut être vide). */
  siteUrl: string;
  /** Logo du cabinet en data URL (base64), ou null si aucun. */
  logo: string | null;
  /** Couleur de marque en hexadécimal #rrggbb, ou null. */
  accent: string | null;
  /** Nom de l'organisation, affiché à côté du logo. */
  orgName: string;
  /** Texte affiché sous le logo (baseline). */
  tagline: string;
  /** Personnalisation active (le CGP a validé l'aperçu). */
  enabled: boolean;
}

export const EMPTY_BRANDING: Branding = {
  siteUrl: "",
  logo: null,
  accent: null,
  orgName: "",
  tagline: "",
  enabled: false,
};

// ─── localStorage (même pattern que le profil client et le cabinet) ───────────

const STORAGE_KEY = "charlie_branding";
/** Événement interne (même onglet) : storage ne se déclenche que cross-onglet. */
export const BRANDING_EVENT = "charlie:branding";

export function loadStoredBranding(): Branding {
  if (typeof window === "undefined") return EMPTY_BRANDING;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_BRANDING;
    const parsed = JSON.parse(raw) as Partial<Branding>;
    return { ...EMPTY_BRANDING, ...parsed };
  } catch {
    return EMPTY_BRANDING;
  }
}

export function saveStoredBranding(b: Branding): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  // Prévient le fournisseur de thème dans le MÊME onglet (storage est cross-onglet).
  window.dispatchEvent(new CustomEvent(BRANDING_EVENT));
}

export function clearStoredBranding(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(BRANDING_EVENT));
}

// ─── Logo → PNG (pour les PDF) ────────────────────────────────────────────────

/**
 * Rastérise un logo (SVG ou bitmap) en PNG (data URL). @react-pdf n'affiche que
 * du PNG/JPEG : un logo SVG doit être converti avant d'entrer dans un document.
 * Rendu net (×2) et cadré dans une boîte maxW×maxH. Client uniquement.
 */
export function logoToPng(src: string, maxW = 512, maxH = 256): Promise<string | null> {
  if (typeof document === "undefined" || !src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let iw = img.naturalWidth || img.width;
      let ih = img.naturalHeight || img.height;
      // SVG sans taille intrinsèque : ratio par défaut plausible pour un logo.
      if (!iw || !ih) {
        iw = maxW;
        ih = Math.round(maxW * 0.4);
      }
      const scale = Math.min(maxW / iw, maxH / ih);
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      const dpr = 2;
      const canvas = document.createElement("canvas");
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      try {
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null); // canvas taché (cross-origin) : on renonce au logo
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ─── Couleur : normalisation, luminance, contraste ────────────────────────────

/**
 * Normalise une couleur (#rgb, #rrggbb, rgb()/rgba()) en #rrggbb minuscule.
 * Retourne null si non reconnue — le seul format que le reste du module accepte.
 */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  // #rgb ou #rrggbb
  const hex = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return "#" + h;
  }

  // rgb(r, g, b) ou rgba(r, g, b, a) — composantes 0-255 ou en %
  const rgb = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => p.trim());
    if (parts.length < 3) return null;
    const chan = parts.slice(0, 3).map((p) => {
      if (p.endsWith("%")) return Math.round((parseFloat(p) / 100) * 255);
      return Math.round(parseFloat(p));
    });
    if (chan.some((c) => Number.isNaN(c) || c < 0 || c > 255)) return null;
    return "#" + chan.map((c) => c.toString(16).padStart(2, "0")).join("");
  }

  return null;
}

/** #rrggbb → [r, g, b] en 0-255. Suppose une entrée déjà normalisée. */
export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const cl = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
  return (
    "#" +
    [r, g, b].map((c) => cl(c).toString(16).padStart(2, "0")).join("")
  );
}

/** Luminance relative WCAG (0 = noir, 1 = blanc). */
export function relativeLuminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Ratio de contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Distance perceptuelle simple entre deux couleurs (0 = identiques). */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Garde jusqu'à `count` couleurs VISUELLEMENT distinctes, dans l'ordre reçu (le
 * premier élément — la couleur la plus présente — est toujours conservé). Évite
 * de proposer trois nuances quasi identiques du même bleu.
 */
export function pickDistinct(hexes: string[], count = 3, minDist = 45): string[] {
  const out: string[] = [];
  for (const hex of hexes) {
    const h = normalizeHex(hex);
    if (!h) continue;
    if (out.every((k) => colorDistance(k, h) >= minDist)) out.push(h);
    if (out.length >= count) break;
  }
  return out;
}

/** Saturation approchée (0 = gris, 1 = couleur pure) — chroma HSL. */
export function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min;
}

/** Texte lisible (blanc ou encre foncée) posé SUR la couleur d'accent. */
export function readableOn(accent: string): string {
  const ink = "#333030";
  return contrastRatio(accent, "#ffffff") >= contrastRatio(accent, ink)
    ? "#ffffff"
    : ink;
}

/** Éclaircit/assombrit vers blanc (t>0) ou noir (t<0), t dans [-1, 1]. */
function mixToward(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  return rgbToHex(
    r + (target - r) * k,
    g + (target - g) * k,
    b + (target - b) * k,
  );
}

/**
 * Rend une couleur de marque UTILISABLE comme accent : l'accent sert de texte
 * sur fond clair et de remplissage sur lequel on pose parfois du blanc. Une
 * couleur trop claire (jaune vif, cyan pâle) devient illisible → on l'assombrit
 * jusqu'à un contraste d'au moins 3:1 sur blanc, en gardant sa teinte.
 */
export function ensureUsableAccent(hex: string): string {
  let out = hex;
  let guard = 0;
  while (contrastRatio(out, "#ffffff") < 3 && guard < 24) {
    out = mixToward(out, -0.08); // assombrit par pas de 8 %
    guard++;
  }
  return out;
}

/**
 * Palette d'accent dérivée d'une seule couleur de marque : les six variables
 * CSS que Charlie utilise pour l'accent. Assombrissements/éclaircissements
 * cohérents avec les valeurs d'origine de globals.css.
 */
export function deriveAccentVars(rawAccent: string): Record<string, string> {
  const accent = ensureUsableAccent(rawAccent);
  return {
    "--color-accent": accent,
    "--color-brown": accent, // alias : états sélectionnés, toggles, nav active
    "--color-brown-2": mixToward(accent, -0.14), // hover
    "--color-accent-ink": mixToward(accent, -0.22), // texte accent renforcé
    "--color-accent-soft": mixToward(accent, 0.62), // fond doux
    "--color-accent-tint": mixToward(accent, 0.9), // fond très pâle
  };
}
