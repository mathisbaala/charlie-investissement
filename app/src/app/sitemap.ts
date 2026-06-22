import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Pages publiques stables. Les fiches /fonds/[isin] (univers ~14k) ne sont pas
// énumérées ici : trop nombreuses et déjà découvrables via la recherche.
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/landing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/recherche", priority: 0.9, changeFrequency: "weekly" },
  { path: "/accueil", priority: 0.7, changeFrequency: "weekly" },
  { path: "/assureurs", priority: 0.7, changeFrequency: "monthly" },
  { path: "/matching", priority: 0.6, changeFrequency: "monthly" },
  { path: "/documents", priority: 0.5, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
