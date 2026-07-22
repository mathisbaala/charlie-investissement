import { after } from "next/server";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { track } from "@vercel/analytics/server";
import { supabase } from "@/lib/supabase";

// Télémétrie produit côté serveur (Couche 1). Journalise des événements d'usage
// (fonds consultés, recherches, filtres) APRÈS l'envoi de la réponse via `after()`
// → aucune latence ajoutée. Fail-open : une erreur d'insertion ne casse jamais le
// produit. Aucune donnée personnelle stockée : l'IP est pseudonymisée (cf. visitorHash).
//
// Le sel décorrèle le hash de l'IP. À défaut de variable d'env (dev/local), un sel
// constant est utilisé — le hash reste stable mais non secret ; en prod, définir
// ANALYTICS_SALT (une chaîne aléatoire) pour une vraie pseudonymisation.
const SALT = process.env.ANALYTICS_SALT ?? "charlie-dev-salt";

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Pseudonyme stable d'un visiteur : SHA-256(ip + sel) tronqué à 32 hex. Permet de
 * compter des visiteurs distincts sans jamais stocker l'IP, et n'est pas réversible
 * en IP sans connaître le sel. Pur et déterministe → testable hors requête.
 */
export function visitorHash(ip: string, salt: string = SALT): string {
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex").slice(0, 32);
}

/**
 * Ne conserve que les filtres réellement actifs (valeur non vide). Évite de stocker
 * des clés à null/[]/"" qui fausseraient les comptages de la vue filter_usage. Pur.
 */
export function activeFilters(
  filters: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

type AnalyticsEvent = {
  event_type: "search" | "search_nl" | "fund_view" | "matching" | "dici";
  path?: string | null;
  isin?: string | null;
  query?: string | null;
  filters?: Record<string, unknown> | null;
  result_count?: number | null;
  meta?: Record<string, unknown> | null;
};

// Propriétés admises par un événement custom Vercel : uniquement des scalaires.
type VercelProps = Record<string, string | number | boolean>;

/**
 * Traduit un événement de télémétrie interne en propriétés d'événement Vercel.
 * On ne retient QUE des dimensions à faible cardinalité (type de produit, tri,
 * booléens) : les valeurs à forte cardinalité (ISIN, nom, requête brute) feraient
 * exploser le nombre de combinaisons d'événements côté Vercel et n'apportent rien
 * à l'analyse d'usage agrégée. Pur → testable hors requête.
 */
export function vercelEventProps(ev: AnalyticsEvent): VercelProps {
  const p: VercelProps = {};
  const m = ev.meta ?? {};
  if (typeof m.product_type === "string") p.product_type = m.product_type;
  if (typeof m.source === "string") p.source = m.source;
  if (typeof m.matched === "boolean") p.matched = m.matched;
  if (typeof m.sort_by === "string") p.sort_by = m.sort_by;
  if (typeof ev.result_count === "number") p.has_results = ev.result_count > 0;
  if (ev.query != null && String(ev.query).trim() !== "") p.has_query = true;
  return p;
}

/**
 * Émet un événement custom Vercel Web Analytics côté serveur. Différé via `after()`
 * (aucune latence ajoutée) et fail-open intégral : ni l'absence de contexte de
 * requête (tests, hors scope) ni une erreur réseau ne doivent casser le produit.
 * En local/preview sans Analytics activé, `track` no-op silencieusement.
 */
export function trackVercel(event: string, props?: VercelProps, req?: NextRequest): void {
  try {
    // Transmet les en-têtes de la requête quand on les a : fiabilise l'attribution
    // (IP/geo/UA) côté Vercel indépendamment du contexte asynchrone.
    const options = req ? { headers: req.headers } : undefined;
    after(async () => {
      try {
        await track(event, props, options);
      } catch {
        // fail-open : jamais casser le produit pour de l'analytics.
      }
    });
  } catch {
    // idem (`after` hors scope de requête, etc.) — on n'émet juste pas l'événement.
  }
}

/**
 * Journalise un événement d'usage. Synchrone côté appelant : on capture le contexte
 * de requête maintenant, puis l'insertion est différée après la réponse (`after`).
 * N'attend rien, ne lève jamais.
 */
export function logEvent(req: NextRequest, ev: AnalyticsEvent): void {
  // Fail-open intégral : aucune erreur d'analytics ne doit casser le produit, y compris
  // `after()` appelé hors contexte de requête (tests appelant le handler directement).
  try {
    // Lecture du contexte AVANT le différé (req peut ne plus être lisible ensuite).
    const visitor = visitorHash(clientIp(req));
    const session = req.cookies.get("charlie_sid")?.value ?? null;
    const path = ev.path ?? req.nextUrl.pathname;

    after(async () => {
      try {
        await supabase.from("investissement_user_events").insert({
          event_type: ev.event_type,
          path,
          isin: ev.isin ?? null,
          query: ev.query ?? null,
          filters: ev.filters ?? null,
          result_count: ev.result_count ?? null,
          visitor,
          session,
          meta: ev.meta ?? null,
        });
      } catch {
        // fail-open : jamais casser le produit pour de l'analytics.
      }
    });

    // Miroir vers Vercel Web Analytics : mêmes événements d'usage, dashboard prêt
    // à l'emploi (volume, geo, croissance) sans requête SQL. Décorrélé du succès
    // de l'insertion Supabase.
    trackVercel(ev.event_type, vercelEventProps(ev), req);
  } catch {
    // idem (ex. `after` hors scope, req sans cookies) — on n'émet juste pas l'événement.
  }
}
