// Résolution des logos d'assureurs/distributeurs.
//
// Les logos sont sourcés hors-ligne par scripts/fetch-insurer-logos.mjs dans
// /public/insurers/{slug}.png. Ce module fait le pont nom → fichier, avec repli
// propre (monogramme) quand aucun vrai logo n'a pu être récupéré.

import { INSURER_LOGO_SLUGS } from "./insurer-logos.generated";

// slug déterministe — DOIT rester identique à slugify() du script de sourcing.
export function slugifyInsurer(company: string): string {
  return company
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Chemin du logo si un vrai logo existe pour cet assureur, sinon null.
export function insurerLogoSrc(company: string | null | undefined): string | null {
  if (!company) return null;
  const slug = slugifyInsurer(company);
  return INSURER_LOGO_SLUGS.has(slug) ? `/insurers/${slug}.png` : null;
}

// Mots vides ignorés pour composer un monogramme lisible.
const STOPWORDS = new Set([
  "de", "du", "des", "d", "la", "le", "les", "l", "vie", "and", "et",
]);

// Initiales (1-2 lettres) pour le monogramme de repli.
export function insurerInitials(company: string | null | undefined): string {
  if (!company) return "?";
  const words = company
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) return company.trim().slice(0, 2).toUpperCase() || "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
