// URL canonique publique du site (domaine principal).
// Surchargeable par NEXT_PUBLIC_SITE_URL pour les déploiements de preview.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.charliewealth.fr"
).replace(/\/$/, "");
