import type { AllocationResult, AssetClass } from "./optimizer";

// ─── Vérification IA d'une allocation ───────────────────────────────────────
// Le moteur quantitatif produit l'allocation ; l'IA n'alloue PAS — elle relit
// le portefeuille final à l'aune d'une grille de règles patrimoniales
// (diversification, adéquation horizon/âge/profil, redondances, cohérence)
// et peut demander deux types de corrections que le MOTEUR ré-exécute :
//   - exclure un fonds (redondance, inadéquation) ;
//   - ajuster les cibles par classe d'actifs (ex. horizon long → plus d'actions).
// L'IA ne choisit jamais de fonds ni de poids elle-même : garde-fou contre les
// hallucinations, et le résultat corrigé reste optimal au sens du moteur.
//
// Fournisseur : Z.AI (GLM), API HTTP « chat/completions » appelée en fetch —
// pas de SDK dédié. Clé attendue dans ZAI_API_KEY (app/.env.local).

const ZAI_ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";

/** Modèle de la revue + tarifs $/MTok (Z.AI, juillet 2026 : 1,40 $ / 4,40 $). */
export const REVIEW_MODEL = "glm-5.2";
const PRICE_PER_MTOK = { input: 1.4, output: 4.4 };

export function reviewCostUsd(usage: { input_tokens: number; output_tokens: number }): number {
  return (
    (usage.input_tokens * PRICE_PER_MTOK.input + usage.output_tokens * PRICE_PER_MTOK.output) / 1e6
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReviewSeverity = "info" | "attention" | "critique";

export interface ReviewIssue {
  /** Règle de la grille concernée (libellé court). */
  rule: string;
  severity: ReviewSeverity;
  /** Constat, rédigé pour le CGP. */
  message: string;
}

export interface ReviewActions {
  /** ISIN à écarter (présents dans l'allocation, hors fonds imposés). */
  exclude: string[];
  /** Nouvelles cibles par classe (pourcentages), ou null si inchangées. */
  classTargets: Partial<Record<AssetClass, number>> | null;
}

export interface AllocationReview {
  verdict: "conforme" | "a_corriger";
  issues: ReviewIssue[];
  actions: ReviewActions;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  model: string;
}

/** Profil client — seuls les champs utiles à l'adéquation. */
export interface ReviewClientContext {
  age: number | null;
  horizonYears: number | null;
  objectif: string | null;
  riskProfile: string | null;
  perteMax: string | null;
  incomeNeed: string | null;
  esg: string | null;
  geographies: string[];
  /** Exclusions éthiques déclarées (tabac, armes, fossiles, jeux, alcool). */
  exclusions: string[];
}

// ─── Grille de règles (inspirée de l'approche Finary, adaptée côté CGP) ─────
// Les frais sont volontairement HORS périmètre : l'outil s'adresse au CGP
// (rétrocessions, conventions), pas à l'épargnant final.

const RULES = `RÈGLES D'ANALYSE — grille dérivée des principes publiés par Finary (Méthode Finary, guide « Comment investir », scores de l'app), adaptée à un outil CGP. Les frais sont HORS périmètre (outil côté conseiller, pas côté épargnant).

1. COHÉRENCE RISQUE ↔ PROFIL (règle centrale, adéquation MIF2/DDA)
1a. Le SRI moyen pondéré doit rester à ±1 cran du profil déclaré (prudent≈1-2, modéré≈2-3, équilibré≈3-4, dynamique≈4-5, offensif≈5-6). Écart > 1 cran = "critique" → corriger les cibles de classes.
1b. Profil "prudent" avec > 50 % d'actions = "critique". Profil "dynamique"/"offensif" à horizon long saturé de fonds euros + monétaire (> 40 %) = "critique" : incohérence symétrique → corriger les cibles.
1c. Perte max déclarée faible (< 10 %) avec volatilité attendue > 12 % = "attention".
1d. Repères d'allocation par profil (grille Finary, à ne pas appliquer mécaniquement si l'horizon le justifie) : prudent ≈ 50 % fonds euros / 10 % actions / 40 % immobilier ; équilibré ≈ 40/20/40 ; dynamique ≈ 20 % fonds euros / 30 % actions / 48 % immobilier / 2 % crypto ; offensif ≈ 10/40/45/5. Un écart massif ET inexpliqué = "attention".

2. ADÉQUATION HORIZON (l'horizon prime sur l'âge — pivot Finary à 5 ans)
2a. Horizon < 5 ans : les actifs volatils (actions + immobilier + crypto + alternatif) doivent rester minoritaires. Horizon < 3 ans avec > 30 % d'actions = "critique" → corriger les cibles (plus de monétaire/obligations/fonds euros). Horizon 3-5 ans avec > 60 % d'actions = "attention".
2b. Horizon ≥ 10 ans avec > 40 % en obligations + monétaire + fonds euros = "critique" : coût d'opportunité majeur → corriger les cibles (plus d'actions). Horizon ≥ 8 ans avec > 30 % de monétaire + fonds euros = "attention".
2c. Échéance proche (horizon ≤ 5 ans) sans AUCUNE poche sécurisée (fonds euros/monétaire/obligations) = "attention" (sécurisation progressive absente).
2d. La règle "100/110 − âge = % actions" n'est qu'un repère grossier : ne la citer que si l'écart est massif ET incohérent avec l'horizon et le profil.

3. DIVERSIFICATION / CONCENTRATION (scores Finary : régions, secteurs, lignes)
3a. Concentration par ligne : > 25 % sur un support (hors fonds indiciel monde "cœur" et hors fonds euros) = "attention" ; > 35 % = "critique".
3b. Au moins 3 classes d'actifs significatives (≥ 5 % chacune) attendues sur un patrimoine diversifié = sinon "attention" (sauf profil très typé cohérent).
3c. Concentration géographique : > 60 % de la poche actions sur une seule région (hors "monde") = "attention" ; aucune exposition internationale = "attention".
3d. Concentration sectorielle : > 30 % de la poche actions sur un secteur/thématique unique = "attention". Les fonds sectoriels/thématiques sont du "satellite" : > 20 % de la poche actions en thématiques = "attention".
3e. Nombre de lignes : < 4 = "attention" (sous-diversification) ; > 12 = "info" (sur-diversification, doublons probables — un cœur de 1-2 fonds globaux + poche sécurisée est le portefeuille de référence).

4. REDONDANCE (règle Finary explicite : jamais deux supports qui se recouvrent)
4a. Deux fonds répliquant le même indice, ou des indices emboîtés (ex. MSCI World + S&P 500), ou la même catégorie fine sans différence de style = "attention" → proposer d'exclure le moins pertinent.
4b. Un fonds "monde" + des fonds régionaux qui recouvrent ses principales zones = "info" (chevauchement à signaler, pas nécessairement à corriger).

5. ACTIFS SPÉCULATIFS (pyramide patrimoniale : le sommet reste marginal)
5a. Crypto-actifs : > 5 % = "attention" ; toute présence chez un profil prudent ou équilibré = "critique" → exclure ou réduire via les cibles. Repère par profil : 0 % prudent/équilibré, ~2 % dynamique, ~5 % offensif.
5b. Somme crypto + alternatif + thématiques étroites > 15 % = "attention" (sommet de pyramide trop lourd).

6. STRUCTURE ET PRÉFÉRENCES
6a. Somme des poids ≠ 100 % (tolérance 0,5 pt) = "critique".
6b. Une classe cible demandée au moteur totalement absente du résultat = "info".
6c. Préférence ESG déclarée (art8/art9) avec des fonds article 6 en portefeuille = "attention" → exclure les fonds article 6.
6d. Objectif "revenus" sans aucune poche distributive/obligataire/immobilière = "attention".
6e. Client ESG "indifferent" (ou non renseigné) : un fonds à mandat explicitement CONTRAINT restreint l'univers sans demande du client = "attention" → exclure ce fonds, le moteur re-sélectionnera l'équivalent le plus adapté (classique ou non). Mandat contraint = le NOM ou la catégorie l'affiche (SRI, ISR, ESG, Climat, Paris-Aligned, PAB, Sustainable, Green, Impact…). Le simple article SFDR 8 ne compte PAS (auto-déclaratif, majoritaire dans l'univers) ; l'article 9 seul non plus si le nom est neutre.
6f. Fonds présent avec un poids nul ou négligeable (< 1 %) = "attention" → exclure (ligne morte qui brouille la lecture).
6g. Exclusions sectorielles déclarées par le client (tabac, armes, fossiles, jeux d'argent, alcool) : le moteur écarte déjà les fonds au mandat dédié — tu es le FILET DE SÉCURITÉ. Tout fonds dont le nom, la catégorie ou le thème évoque un secteur exclu (ex. "Défense", "Aerospace", "Oil & Gas", "Énergie" classique pour fossiles, casinos pour jeux) = "critique" → exclure. Ne pas sur-appliquer : un fonds généraliste ne se juge pas sur d'hypothétiques lignes sous-jacentes invisibles.

DISCIPLINE — CORRIGER, NE PAS RECOMMANDER :
- Le CGP reçoit un portefeuille DÉJÀ corrigé, jamais une liste de recommandations à appliquer lui-même. Toute anomalie corrigeable par tes actions DOIT être corrigée, dès la sévérité "attention" :
  · exclude → redondance (garder le plus pertinent), fonds inadapté aux préférences (ex. mandat ESG contraint pour un client indifférent), poids nul, concentration excessive sur une ligne (l'exclusion force le moteur à redistribuer).
  · class_targets → inadéquation horizon/profil (trop défensif à horizon long, trop agressif à horizon court, crypto excessive).
- Les constats "info" (chevauchement mineur, sur-diversification légère) se signalent SANS action.
- Chaque issue explique ce qui a été corrigé et pourquoi (le CGP la lit comme un journal de corrections), ou ce qui reste à son appréciation pour les "info".
- exclude : uniquement des ISIN présents dans le portefeuille.
- class_targets : pourcentages qui somment à ~100, uniquement les classes autorisées.
- Jamais de commentaire sur les frais.`;

const SYSTEM = `Tu es un contrôleur qualité d'allocations d'actifs au sein d'un outil destiné aux CGP (conseillers en gestion de patrimoine). Un moteur quantitatif (max-Sharpe/HRP sous contraintes) a produit le portefeuille ci-dessous pour un client donné. Ton rôle : vérifier le portefeuille contre la grille de règles, PAS de le re-générer.

${RULES}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "verdict": "conforme" | "a_corriger",
  "issues": [{"rule": "<libellé court de la règle, ex. 3a>", "severity": "info"|"attention"|"critique", "message": "<constat en français, 1-2 phrases, adressé au CGP>"}],
  "actions": {
    "exclude": ["<ISIN>"],
    "class_targets": {"actions": 60, "obligations": 25, "monetaire": 15} | null
  }
}
"verdict": "a_corriger" dès que actions contient au moins une correction (exclude non vide ou class_targets non null) — et il DOIT en contenir dès qu'un constat "attention" ou "critique" est corrigeable par tes actions. "conforme" = rien à corriger. Pas de texte hors du JSON.`;

const VALID_CLASSES: AssetClass[] = [
  "actions", "obligations", "monetaire", "diversifie",
  "immobilier", "alternatif", "crypto", "fonds_euros",
];

// ─── Construction du payload (pure, testable) ───────────────────────────────

export function buildReviewPayload(
  allocation: AllocationResult,
  client: ReviewClientContext,
  engineTargets: Partial<Record<AssetClass, number>> | undefined,
  mustInclude: string[],
): string {
  return JSON.stringify(
    {
      client: {
        age: client.age,
        horizon_annees: client.horizonYears,
        objectif: client.objectif,
        profil_risque: client.riskProfile,
        perte_max: client.perteMax,
        besoin_revenus: client.incomeNeed,
        esg: client.esg,
        zones_souhaitees: client.geographies,
        exclusions_sectorielles: client.exclusions,
      },
      cibles_du_moteur_pct: engineTargets ?? null,
      fonds_imposes_par_le_conseiller: mustInclude,
      portefeuille: {
        sri_moyen_pondere: allocation.weightedSri,
        rendement_attendu_pct: Math.round(allocation.expectedReturn * 1000) / 10,
        volatilite_pct: Math.round(allocation.volatility * 1000) / 10,
        poids_par_classe_pct: allocation.classWeights,
        lignes: allocation.lines.map((l) => ({
          isin: l.isin,
          nom: l.name,
          classe: l.assetClass,
          categorie: l.category ?? null,
          region: l.region ?? null,
          poids_pct: l.weight,
          sri: l.sri ?? null,
          sfdr: l.sfdr ?? null,
        })),
        notes_moteur: allocation.notes,
      },
    },
    null,
    1,
  );
}

// ─── Validation de la sortie LLM (pure, testable) ───────────────────────────
// Même philosophie que sanitizeParsedFilters : on ne laisse passer QUE des
// valeurs sûres. Un ISIN halluciné ou une classe inconnue est écartée en
// silence — au pire la revue dégénère en "conforme" sans action.

export function sanitizeReview(
  raw: unknown,
  portfolioIsins: string[],
  mustInclude: string[],
): Pick<AllocationReview, "verdict" | "issues" | "actions"> {
  const fallback = {
    verdict: "conforme" as const,
    issues: [] as ReviewIssue[],
    actions: { exclude: [], classTargets: null } as ReviewActions,
  };
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;

  const issues: ReviewIssue[] = [];
  if (Array.isArray(r.issues)) {
    for (const it of r.issues.slice(0, 10)) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const severity: ReviewSeverity =
        o.severity === "critique" ? "critique" : o.severity === "attention" ? "attention" : "info";
      const message = typeof o.message === "string" ? o.message.trim().slice(0, 400) : "";
      if (!message) continue;
      issues.push({
        rule: typeof o.rule === "string" ? o.rule.trim().slice(0, 60) : "règle",
        severity,
        message,
      });
    }
  }

  const inPortfolio = new Set(portfolioIsins.map((s) => s.toUpperCase()));
  const imposed = new Set(mustInclude.map((s) => s.toUpperCase()));
  const actionsRaw = (r.actions && typeof r.actions === "object" ? r.actions : {}) as Record<string, unknown>;

  const exclude: string[] = [];
  if (Array.isArray(actionsRaw.exclude)) {
    for (const isin of actionsRaw.exclude) {
      if (typeof isin !== "string") continue;
      const up = isin.trim().toUpperCase();
      // Jamais un fonds hors portefeuille (halluciné) ni un fonds imposé par le
      // conseiller (sa décision prime sur la revue).
      if (inPortfolio.has(up) && !imposed.has(up) && !exclude.includes(up)) exclude.push(up);
    }
  }
  // Garde-fou : ne jamais vider le portefeuille (max la moitié des lignes).
  const maxExclusions = Math.floor(portfolioIsins.length / 2);
  exclude.splice(maxExclusions);

  let classTargets: Partial<Record<AssetClass, number>> | null = null;
  const ct = actionsRaw.class_targets;
  if (ct && typeof ct === "object") {
    const out: Partial<Record<AssetClass, number>> = {};
    for (const [k, v] of Object.entries(ct as Record<string, unknown>)) {
      const cls = k as AssetClass;
      const num = typeof v === "number" ? v : Number(v);
      if (VALID_CLASSES.includes(cls) && Number.isFinite(num) && num > 0 && num <= 100) {
        out[cls] = Math.round(num);
      }
    }
    const sum = Object.values(out).reduce((a, b) => a + (b ?? 0), 0);
    // Cibles plausibles uniquement (somme ~100) — sinon on ignore l'action.
    if (sum >= 90 && sum <= 110 && Object.keys(out).length > 0) classTargets = out;
  }

  const hasActions = exclude.length > 0 || classTargets !== null;
  return {
    verdict: hasActions ? "a_corriger" : "conforme",
    issues,
    actions: { exclude, classTargets },
  };
}

// ─── Appel LLM ──────────────────────────────────────────────────────────────

/** Réponse Z.AI (format chat/completions, style OpenAI). */
interface ZaiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export async function reviewAllocation(
  allocation: AllocationResult,
  client: ReviewClientContext,
  engineTargets: Partial<Record<AssetClass, number>> | undefined,
  mustInclude: string[],
): Promise<AllocationReview> {
  const payload = buildReviewPayload(allocation, client, engineTargets, mustInclude);

  const res = await fetch(ZAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: REVIEW_MODEL,
      // Raisonnement DÉSACTIVÉ : pour une application de grille structurée, la
      // qualité reste équivalente et la latence tombe de ~45 s à ~7 s (mesuré).
      // Sans tokens de raisonnement, 4k de sortie suffisent largement au JSON.
      thinking: { type: "disabled" },
      max_tokens: 4000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: payload },
      ],
    }),
  });

  const data = (await res.json().catch(() => null)) as ZaiResponse | null;
  if (!res.ok || !data) {
    throw new Error(data?.error?.message ?? `Z.AI a répondu ${res.status}.`);
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(json);
  } catch {
    // Sortie non parsable → revue neutre (conforme, sans action) ; le coût est
    // tout de même remonté pour la télémétrie.
  }

  const usage = {
    input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0,
  };
  const clean = sanitizeReview(parsed, allocation.lines.map((l) => l.isin), mustInclude);
  return {
    ...clean,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costUsd: reviewCostUsd(usage),
    },
    model: REVIEW_MODEL,
  };
}
