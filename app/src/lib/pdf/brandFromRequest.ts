import { loadLogo } from "./logo";
import { setBrandAccent } from "./theme";

// Marque du cabinet reçue du client (localStorage → corps de requête) pour teindre
// les documents PDF générés côté serveur à ses couleurs. Le client envoie un logo
// DÉJÀ converti en PNG (data URI) — @react-pdf ne rend ni SVG ni WebP.

const HEX6 = /^#?[0-9a-fA-F]{6}$/;
// Un logo PNG en data URI reste modeste (logoToPng borne à 512×256) ; on plafonne
// pour éviter qu'un corps de requête gonflé ne fasse ramer le rendu.
const MAX_LOGO_CHARS = 1_500_000;

export interface ClientBranding {
  accent: string | null;
  logo: string | null;
}

/** Extrait accent (#rrggbb) et logo PNG valides d'un objet `branding` de requête. */
export function parseClientBranding(raw: unknown): ClientBranding {
  const b = (raw ?? {}) as Record<string, unknown>;
  const accent = typeof b.accent === "string" && HEX6.test(b.accent.replace("#", "")) ? b.accent : null;
  const logo =
    typeof b.logo === "string" && b.logo.startsWith("data:image/png") && b.logo.length <= MAX_LOGO_CHARS
      ? b.logo
      : null;
  return { accent, logo };
}

/**
 * Applique la marque du cabinet au rendu à venir et renvoie le logo à poser en
 * en-tête : celui du cabinet s'il est fourni, sinon le « C » de Charlie. Appelle
 * TOUJOURS setBrandAccent (même sans marque) pour repartir de l'accent Charlie et
 * ne pas hériter de la couleur d'une requête précédente (palette globale mutable).
 */
export async function applyBranding(brand: ClientBranding): Promise<string | undefined> {
  setBrandAccent(brand.accent);
  return brand.logo ?? (await loadLogo()) ?? undefined;
}
