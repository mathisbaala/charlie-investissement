import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Plafonds anti-abus des appels IA (par IP). Stratégie « démo » : laisser un
// visiteur prendre l'outil en main (quelques recherches + uploads, ~10-15 min)
// puis le bloquer jusqu'au lendemain — il revient chaque jour, sans cramer les
// crédits, et on l'incite à demander un accès complet. Le plafond JOUR est la
// contrainte qui mord ; l'heure est calée pareil pour qu'une seule session
// puisse l'atteindre. Réglables via variables d'environnement (sans redéploiement
// du code, juste un redeploy Vercel).
//   coûts : 1 recherche=1, 1 chat=2, 1 upload DICI=3
const HOUR_LIMIT = Number(process.env.AI_HOUR_LIMIT ?? 25);
const DAY_LIMIT  = Number(process.env.AI_DAY_LIMIT ?? 25);
// Plafond GLOBAL journalier (toutes IP confondues) : plafond dur de dépense.
// Le plafond par IP ne stoppe pas une attaque distribuée (rotation d'IP) ; ce
// plafond-ci borne le coût absolu d'une journée quoi qu'il arrive. Réglable via
// env (sans toucher au code). À ~3 unités par DICI / 2 par chat / 1 par
// recherche, 2000 = large marge pour un usage démo, mur net en cas d'abus.
const GLOBAL_DAY_LIMIT = Number(process.env.AI_GLOBAL_DAY_LIMIT ?? 2000);

// ── Garde-fou anti-scraping des endpoints de DONNÉES (screener/fiche/VL) ──────
// Distinct du quota IA : ici on protège la BASE (aspiration en masse), pas un
// coût d'API. Plafonds par IP, fenêtre MINUTE (anti-burst) + HEURE (soutenu),
// volontairement GÉNÉREUX — un humain qui navigue (quelques requêtes par vue de
// page) reste très loin sous le seuil ; un crawler qui énumère des centaines de
// pages/fiches mord. Réglables par env (sans toucher au code).
const DATA_MIN_LIMIT  = Number(process.env.DATA_MIN_LIMIT  ?? 100);
const DATA_HOUR_LIMIT = Number(process.env.DATA_HOUR_LIMIT ?? 1800);

// ── Filtre anti-bot (User-Agent) des endpoints de DONNÉES ────────────────────
// Première barrière, en amont du rate-limit : un navigateur réel envoie TOUJOURS
// un User-Agent « Mozilla/… ». Ces signatures trahissent un client non-navigateur
// (bibliothèque de scripting / CLI) = scraping paresseux → 403 immédiat, sans
// requête DB. Scopé aux endpoints de DONNÉES uniquement : les crawlers qu'on VEUT
// (Googlebot, preview LinkedIn/WhatsApp/X) visent le HTML des pages, jamais
// /api/funds → zéro impact SEO ni aperçu de lien. Un scraper qui USURPE un UA de
// navigateur passe ici mais tombe sur le rate-limit → défense en profondeur, pas
// balle d'argent. Désactivable via env (BOT_FILTER_ENABLED=0) ; signatures
// additionnelles via env (BOT_UA_EXTRA, ex. "headlesschrome,bot").
const BOT_UA_PATTERNS = [
  "python-requests", "python-urllib", "aiohttp", "httpx", "scrapy", "curl/",
  "wget/", "go-http-client", "okhttp", "java/", "jakarta", "libwww-perl",
  "node-fetch", "axios/", "got (", "postmanruntime", "insomnia", "httpie",
  "mechanize", "colly", "guzzle", "scraper", "crawler", "spider", "phantomjs",
];

export function isBotUserAgent(ua: string): boolean {
  const v = ua.trim().toLowerCase();
  if (v === "") return true; // UA absent = jamais un navigateur normal
  const extra = (process.env.BOT_UA_EXTRA ?? "")
    .toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return [...BOT_UA_PATTERNS, ...extra].some((p) => v.includes(p));
}

/**
 * Refuse (403) un appel aux endpoints de DONNÉES dont le User-Agent trahit un
 * client non-navigateur. Synchrone, sans DB. Renvoie `null` si l'appel est
 * légitime (ou si le filtre est désactivé par env). Fail-open sur erreur.
 */
export function botGuard(req: NextRequest): NextResponse | null {
  try {
    const flag = (process.env.BOT_FILTER_ENABLED ?? "1").toLowerCase();
    if (flag === "0" || flag === "false") return null;
    if (!isBotUserAgent(req.headers.get("user-agent") ?? "")) return null;
    return NextResponse.json(
      { error: "forbidden", message: "Accès automatisé non autorisé." },
      { status: 403 },
    );
  } catch {
    return null; // fail-open : ne jamais casser le produit pour le filtre
  }
}

// Coût relatif par type d'appel (l'extraction DICI en vision coûte bien plus
// cher qu'une simple interprétation de requête).
export const AI_COST = {
  parse: 1,         // recherche en langage naturel
  profile: 1,       // parsing d'un profil client
  dici: 3,          // extraction d'un DICI (vision + gros prompt)
} as const;

export function clientIp(req: NextRequest): string {
  // IMPORTANT : ne PAS faire confiance au premier maillon de x-forwarded-for —
  // un client peut envoyer son propre en-tête XFF, et Vercel le préserve (en
  // préfixant la vraie IP) ; prendre split(",")[0] laisserait n'importe qui
  // usurper une IP arbitraire à chaque requête et contourner le quota par IP.
  // x-real-ip / x-vercel-forwarded-for sont posés par le proxy Vercel et ne sont
  // pas usurpables → on les privilégie.
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const vercel = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel.split(",")[0].trim();
  // Dernier recours (hors Vercel) : on prend le DERNIER maillon de XFF, le plus
  // proche du proxy de confiance, plutôt que le premier (usurpable).
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

/**
 * Renvoie une réponse 429 si la limite IA est atteinte pour cette IP, sinon
 * `null` (l'appelant continue normalement). Fail-open : toute erreur de
 * comptage laisse passer — on ne casse jamais le produit pour un souci de
 * rate-limit (au pire on dépense un peu plus).
 */
export async function aiRateLimit(req: NextRequest, cost = 1): Promise<NextResponse | null> {
  try {
    const ip = clientIp(req);
    const { data, error } = await supabase.rpc("inv_ai_rate_limit", {
      p_ip: ip, p_hour_limit: HOUR_LIMIT, p_day_limit: DAY_LIMIT, p_cost: cost,
      p_global_day_limit: GLOBAL_DAY_LIMIT,
    });
    if (error || !data) return null;
    const r = data as { allowed: boolean; scope: "ok" | "hour" | "day" | "global" };
    if (r.allowed) return null;

    // Plafond global atteint : ce n'est pas la faute de l'utilisateur, c'est une
    // protection de dépense côté service → 503 + message neutre (on ne révèle
    // pas qu'on rationne, et on n'invite pas à « revenir demain » à tort).
    if (r.scope === "global") {
      return NextResponse.json(
        {
          error: "ai_unavailable",
          scope: "global",
          message: "Le service d'analyse est momentanément saturé. Réessayez plus tard.",
        },
        { status: 503, headers: { "Retry-After": "3600" } },
      );
    }

    const perHour = r.scope === "hour";
    return NextResponse.json(
      {
        error: "rate_limited",
        scope: r.scope,
        message: perHour
          ? "Vous avez atteint votre quota de découverte pour cette heure. Réessayez d'ici une heure, ou contactez-nous pour un accès complet."
          : "Vous avez atteint votre quota de découverte du jour. Revenez demain, ou contactez-nous pour débloquer un accès complet à Charlie.",
      },
      { status: 429, headers: { "Retry-After": perHour ? "3600" : "86400" } },
    );
  } catch {
    return null; // fail-open
  }
}

/**
 * Garde-fou anti-scraping pour les endpoints de DONNÉES. Renvoie une réponse 429
 * si l'IP dépasse le plafond minute OU heure, sinon `null` (l'appelant continue).
 * Fail-open : toute erreur de comptage laisse passer — on ne casse jamais le
 * produit pour un souci de rate-limit. Sémantique « bloqué » STRICTE : on ne
 * refuse que sur `allowed === false` explicite (un retour inattendu = on laisse
 * passer), pour ne jamais transformer un aléa en faux 429.
 */
export async function dataRateLimit(req: NextRequest, cost = 1): Promise<NextResponse | null> {
  try {
    const ip = clientIp(req);
    const { data, error } = await supabase.rpc("inv_data_rate_limit", {
      p_ip: ip, p_min_limit: DATA_MIN_LIMIT, p_hour_limit: DATA_HOUR_LIMIT, p_cost: cost,
    });
    if (error || !data) return null;
    const r = data as { allowed: boolean; scope: "ok" | "minute" | "hour" };
    if (r.allowed !== false) return null;

    const perMinute = r.scope === "minute";
    return NextResponse.json(
      {
        error: "rate_limited",
        scope: r.scope,
        message: "Trop de requêtes. Patientez un instant avant de réessayer.",
      },
      { status: 429, headers: { "Retry-After": perMinute ? "60" : "3600" } },
    );
  } catch {
    return null; // fail-open
  }
}
