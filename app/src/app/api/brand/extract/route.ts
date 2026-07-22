import { NextRequest, NextResponse } from "next/server";
import { botGuard, dataRateLimit } from "@/lib/rateLimit";
import { normalizeHex, saturation, relativeLuminance, pickDistinct } from "@/lib/branding";

export const runtime = "nodejs";

// ─── Extraction de marque depuis l'URL du site du cabinet ─────────────────────
//
// 100 % gratuit et local (cf. mémoire « collecte toujours gratuite ») : on va
// chercher le HTML public du site, on en tire les candidats logo (icônes,
// og:image, <img> « logo ») et la couleur de marque (theme-color, puis couleur
// saturée la plus fréquente du CSS). Le meilleur logo est renvoyé en data URL
// (téléchargé côté serveur → pas de souci CORS/hotlink côté navigateur). Aucun
// service tiers payant, aucune clé d'API.

const FETCH_TIMEOUT_MS = 7000;
const MAX_HTML_BYTES = 1_500_000; // ~1,5 Mo de HTML suffit largement
const MAX_LOGO_BYTES = 600_000; // logo embarqué en data URL : plafonné
const UA =
  "Mozilla/5.0 (compatible; CharlieScreener/1.0; +https://www.charliewealth.fr)";

interface ExtractResult {
  siteUrl: string;
  siteName: string | null;
  logo: string | null; // data URL du meilleur logo
  logoCandidates: string[]; // URLs absolues, pour laisser le choix
  accent: string | null; // #rrggbb
  accentCandidates: string[];
}

/** Normalise l'URL saisie et bloque les cibles internes (garde-fou SSRF). */
function normalizeUrl(raw: string): URL | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  // Bloque localhost, adresses privées et liens locaux : on ne récupère que des
  // sites publics, jamais une ressource du réseau interne de l'hébergeur.
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    host === "0.0.0.0" ||
    host === "[::1]"
  ) {
    return null;
  }
  return u;
}

async function fetchText(url: string, maxBytes: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,text/css,*/*" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, maxBytes).toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Télécharge une image et la renvoie en data URL, ou null si trop lourde/absente. */
async function fetchImageDataUrl(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "image/*" },
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Décode les entités HTML fréquentes dans une valeur d'attribut (surtout
 *  &amp; dans les URLs : sans ça, ?w=180&amp;h=180 casserait la requête image). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x26;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  const raw = m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
  return raw == null ? null : decodeEntities(raw);
}

/** Résout une URL de ressource (relative ou absolue) contre la page. */
function resolve(base: URL, href: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/** Candidats logo, du plus prometteur au moins prometteur. */
function extractLogoCandidates(html: string, base: URL): string[] {
  const out: { url: string; score: number }[] = [];
  const push = (url: string | null, score: number) => {
    if (url && !out.some((o) => o.url === url)) out.push({ url, score });
  };

  const isSvg = (u: string) => /\.svg(\?|$)/i.test(u);
  // Logos tiers/badges à écarter : ils contiennent « logo » sans être la marque.
  const BADGE =
    /trustpilot|google|facebook|twitter|linkedin|instagram|youtube|tiktok|app.?store|play.?store|visa|mastercard|paypal|stripe|badge|award|avis|partenaire|partner|sponsor|prismic|gravatar/i;
  // Aperçus volontairement floutés (CDN) : à ne jamais retenir.
  const BLURRED = /[?&](blur|blurhash)=/i;

  // <link rel="...icon..."> — la marque déclarée du site. Un SVG ici est net à
  // toute taille (un favicon PNG de 32 px agrandi en filigrane deviendrait flou).
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    if (!/icon/.test(rel)) continue;
    const href = resolve(base, attr(tag, "href"));
    if (!href) continue;
    const sizes = attr(tag, "sizes") || "";
    const dim = parseInt(sizes, 10) || 0;
    let score = 40 + Math.min(dim, 512) / 8;
    if (rel.includes("apple-touch")) score += 50; // en général 180 px, coloré
    if (isSvg(href)) score += 120; // vectoriel = toujours net
    if (rel.includes("mask-icon")) score = 5; // silhouette monochrome : inexploitable
    push(href, score);
  }

  // <img> dont le src/alt/class évoque un logo — mais PAS un badge tiers.
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgs) {
    const src = resolve(base, attr(tag, "src"));
    if (!src) continue;
    const hay = `${attr(tag, "src") || ""} ${attr(tag, "alt") || ""} ${
      attr(tag, "class") || ""
    } ${attr(tag, "id") || ""}`.toLowerCase();
    if (!/logo|brand/.test(hay)) continue;
    if (BADGE.test(hay) || BADGE.test(src) || BLURRED.test(src)) continue;
    const sameHost = (() => {
      try {
        return new URL(src).hostname === base.hostname;
      } catch {
        return false;
      }
    })();
    // Un vrai logo d'en-tête vectoriel et du même domaine est le meilleur des
    // candidats ; sinon on reste prudent (les <img> « logo » sont bruités).
    let score = 45;
    if (isSvg(src)) score += 70;
    if (sameHost) score += 15;
    push(src, score);
  }

  // <meta property="og:image"> — souvent une bannière, moins bon qu'une icône.
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    const prop = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
    if (prop === "og:image" || prop === "twitter:image") {
      const src = resolve(base, attr(tag, "content"));
      if (src && !BADGE.test(src) && !BLURRED.test(src)) push(src, 25);
    }
  }

  // Repli standard : /favicon.ico.
  push(resolve(base, "/favicon.ico"), 10);

  return out.sort((a, b) => b.score - a.score).map((o) => o.url);
}

/** Couleur de marque : theme-color en priorité, sinon couleur CSS dominante. */
function extractAccentCandidates(html: string, css: string): string[] {
  const scored = new Map<string, number>();
  const add = (hex: string | null, weight: number) => {
    if (!hex) return;
    // Écarte les gris et les extrêmes (blanc/noir/quasi) : ce ne sont pas des
    // couleurs de marque exploitables comme accent.
    if (saturation(hex) < 0.12) return;
    const lum = relativeLuminance(hex);
    if (lum > 0.9 || lum < 0.02) return;
    scored.set(hex, (scored.get(hex) || 0) + weight);
  };

  // theme-color : signal le plus fiable de la couleur de marque.
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    if ((attr(tag, "name") || "").toLowerCase() === "theme-color") {
      add(normalizeHex(attr(tag, "content")), 1000);
    }
  }

  // Fréquence des couleurs déclarées dans le CSS (inline + feuilles liées).
  const colorTokens =
    css.match(/#[0-9a-fA-F]{3,6}\b|rgba?\([^)]+\)/g) || [];
  for (const tok of colorTokens) add(normalizeHex(tok), 1);

  const byFrequency = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  // Couleurs visuellement distinctes : la plus présente d'abord, puis des teintes
  // franchement différentes (pour une vraie proposition de 3 couleurs).
  return pickDistinct(byFrequency, 6);
}

function extractSiteName(html: string): string | null {
  const og = (html.match(/<meta\b[^>]*property\s*=\s*["']og:site_name["'][^>]*>/i) ||
    [])[0];
  if (og) {
    const c = attr(og, "content");
    if (c) return c.trim();
  }
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t ? t[1].trim().slice(0, 80) : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const bot = botGuard(req);
  if (bot) return bot;
  const burst = await dataRateLimit(req, 2); // fetch réseau : coût un peu plus élevé
  if (burst) return burst;

  let body: { url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const url = normalizeUrl(body.url || "");
  if (!url) {
    return NextResponse.json(
      { error: "URL invalide ou non autorisée" },
      { status: 400 },
    );
  }

  const html = await fetchText(url.href, MAX_HTML_BYTES);
  if (html == null) {
    return NextResponse.json(
      { error: "Site inaccessible", code: "fetch_failed" },
      { status: 502 },
    );
  }

  // Concatène le CSS inline + jusqu'à 3 feuilles de style liées (pour la couleur).
  let css = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []).join("\n");
  const sheets: string[] = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    if (/stylesheet/i.test(attr(tag, "rel") || "")) {
      const href = resolve(url, attr(tag, "href"));
      if (href) sheets.push(href);
    }
    if (sheets.length >= 3) break;
  }
  const fetched = await Promise.all(
    sheets.slice(0, 3).map((s) => fetchText(s, 300_000)),
  );
  css += "\n" + fetched.filter(Boolean).join("\n");

  const logoCandidates = extractLogoCandidates(html, url);
  const accentCandidates = extractAccentCandidates(html, css);

  // Télécharge le meilleur logo qui rentre dans le plafond (essaie les 4 premiers).
  let logo: string | null = null;
  for (const cand of logoCandidates.slice(0, 4)) {
    logo = await fetchImageDataUrl(cand);
    if (logo) break;
  }

  const result: ExtractResult = {
    siteUrl: url.href,
    siteName: extractSiteName(html),
    logo,
    logoCandidates: logoCandidates.slice(0, 6),
    accent: accentCandidates[0] ?? null,
    accentCandidates,
  };

  return NextResponse.json(result);
}
