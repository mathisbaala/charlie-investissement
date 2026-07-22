import { isValidIsin, scrubLabel, type ExtractedPosition } from "./releve";

// ─── Lecture IA des relevés de situation (Z.AI GLM 5.2) ─────────────────────
// Chaque banque/assureur a son template : l'extraction déterministe (regex
// ligne à ligne, cf. lib/releve) échoue sur les mises en page exotiques. Ici,
// le MÊME modèle que la revue d'allocation (GLM 5.2, appel fetch direct) lit le
// texte du document et en sort les positions structurées. Le déterministe reste
// en repli (pas de clé, erreur, zéro position) et en complément (union des ISIN).
//
// CONFIDENTIALITÉ : le texte part chez un tiers (Z.AI) → il est ANONYMISÉ avant
// envoi par scrubDocumentText (e-mails, civilité+nom, suites de ≥ 6 chiffres =
// n° de contrat/adhérent/téléphone), en préservant les ISIN (protégés par
// placeholder) et les montants français formatés (« 123 456,78 » : groupes de
// ≤ 3 chiffres, jamais masqués). Comme pour le pipeline déterministe, rien
// n'est stocké : le texte est lu, envoyé, oublié.

const ZAI_ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";

/** Même modèle et mêmes tarifs que la revue d'allocation ($/MTok Z.AI). */
export const RELEVE_AI_MODEL = "glm-5.2";
const PRICE_PER_MTOK = { input: 1.4, output: 4.4 };

/** Borne d'entrée : ~80k caractères ≈ 25k tokens ≈ 0,04 $ — couvre un relevé
 *  de plusieurs dizaines de pages ; au-delà on tronque (les positions vivent
 *  dans les premières pages, les CG/annexes juridiques à la fin). */
const MAX_INPUT_CHARS = 80_000;

export interface ReleveAiUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ReleveAiResult {
  positions: ExtractedPosition[];
  /** Total de valorisation imprimé sur le document, si le modèle l'a lu. */
  documentTotal: number | null;
  usage: ReleveAiUsage;
  model: string;
}

// ─── Anonymisation du texte AVANT envoi au tiers (pure, testable) ───────────

const ISIN_GUARD_RE = /\b[A-Z]{2}[A-Z0-9]{9}\d\b/g;

export function scrubDocumentText(text: string): string {
  // 1) Protéger les ISIN (leur queue numérique ressemble à un n° de contrat).
  const isins: string[] = [];
  let t = (text || "").replace(ISIN_GUARD_RE, (m) => {
    isins.push(m);
    return `__ISIN_${isins.length - 1}__`;
  });
  // 2) Masquer l'identifiant : e-mails, civilité + nom, longues suites de
  //    chiffres (n° adhérent/contrat/téléphone — les montants français sont
  //    groupés par ≤ 3 chiffres et les millésimes font 4 chiffres : préservés).
  t = t
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "•")
    .replace(/\b(?:M\.|Mr|Mme|Mlle|Monsieur|Madame|Mademoiselle)\s+[A-ZÀ-Ý][\wÀ-ÿ'-]*/g, "•")
    .replace(/\d{6,}/g, "•");
  // 3) Restaurer les ISIN.
  return t.replace(/__ISIN_(\d+)__/g, (_, i) => isins[Number(i)] ?? "•");
}

// ─── Validation de la sortie LLM (pure, testable) ───────────────────────────
// Même philosophie que la revue d'allocation : on ne laisse passer QUE des
// valeurs sûres. ISIN invalide → position écartée ; montants non plausibles →
// null (éditable à l'écran) ; libellés re-passés par scrubLabel (défense en
// profondeur RGPD) ; doublons d'ISIN fusionnés en sommant (multi-poches).

export function sanitizeAiExtraction(raw: unknown): {
  positions: ExtractedPosition[];
  documentTotal: number | null;
} {
  const out = { positions: [] as ExtractedPosition[], documentTotal: null as number | null };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;

  const byIsin = new Map<string, ExtractedPosition>();
  if (Array.isArray(r.positions)) {
    for (const p of r.positions.slice(0, 400)) {
      if (!p || typeof p !== "object") continue;
      const o = p as Record<string, unknown>;
      const isin = typeof o.isin === "string" ? o.isin.trim().toUpperCase() : "";
      if (!isValidIsin(isin)) continue;

      const label = typeof o.libelle === "string" ? scrubLabel(o.libelle).slice(0, 120) : "";
      const amtRaw = o.montant_eur;
      const amt =
        typeof amtRaw === "number" && Number.isFinite(amtRaw) && amtRaw >= 0 && amtRaw < 1e10
          ? Math.round(amtRaw * 100) / 100
          : null;

      const prev = byIsin.get(isin);
      if (prev) {
        if (amt !== null) prev.amount = (prev.amount ?? 0) + amt;
        if (!prev.label && label) prev.label = label;
      } else {
        byIsin.set(isin, { isin, label, amount: amt });
      }
    }
  }
  out.positions = Array.from(byIsin.values());

  const total = r.total_document;
  if (typeof total === "number" && Number.isFinite(total) && total > 0 && total < 1e10) {
    out.documentTotal = Math.round(total * 100) / 100;
  }
  return out;
}

// ─── Appel LLM ──────────────────────────────────────────────────────────────

const SYSTEM = `Tu lis des documents de portefeuille français déposés par des conseillers en gestion de patrimoine : relevés de situation d'assurance-vie, PEA, compte-titres, PER (tous assureurs/courtiers, tous formats — le texte provient d'un PDF, d'un Excel ou d'un CSV, la mise en page peut être hachée).

Ta mission : extraire chaque POSITION du portefeuille.

Réponds UNIQUEMENT avec un objet JSON :
{
  "positions": [
    {"isin": "<code ISIN de 12 caractères>", "libelle": "<nom du support>", "montant_eur": <valorisation de la ligne en euros, nombre> | null}
  ],
  "total_document": <valorisation totale imprimée sur le document, en euros> | null
}

Règles impératives :
- N'inclus QUE les lignes portant un ISIN (2 lettres + 10 caractères). Ne JAMAIS inventer ni corriger un ISIN : recopie exactement.
- montant_eur = la VALORISATION de la position (montant en euros). Ce n'est NI la valeur liquidative (VL) unitaire, NI le nombre de parts, NI un pourcentage, NI une performance. Si la valorisation n'apparaît pas pour cette ligne, mets null.
- Certains documents séparent la synthèse chiffrée (noms + montants) de l'annexe des supports (noms + ISIN) : associe-les par le nom du support.
- Un même support peut apparaître dans plusieurs poches : additionne ses montants.
- Les montants français s'écrivent « 12 345,67 » : la virgule est décimale, l'espace sépare les milliers.
- total_document = le total du portefeuille imprimé sur le document (« Valorisation totale », « Total général »…), pas ta propre somme.
- Ignore tout ce qui n'est pas une position : frais, performances, avances, garanties, texte juridique.
Pas de texte hors du JSON.`;

interface ZaiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Lit un relevé par IA. `text` doit déjà être passé par scrubDocumentText.
 * Lance en cas d'échec API — l'appelant retombe sur l'extraction déterministe.
 */
export async function extractPositionsAi(text: string): Promise<ReleveAiResult> {
  const res = await fetch(ZAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: RELEVE_AI_MODEL,
      // Extraction structurée : le raisonnement n'apporte rien et coûte des
      // tokens/du temps (mesuré sur la revue d'allocation : ~7 s vs ~45 s).
      thinking: { type: "disabled" },
      max_tokens: 8000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text.slice(0, MAX_INPUT_CHARS) },
      ],
    }),
  });

  const data = (await res.json().catch(() => null)) as ZaiResponse | null;
  if (!res.ok || !data) {
    throw new Error(data?.error?.message ?? `Z.AI a répondu ${res.status}.`);
  }

  const content = data.choices?.[0]?.message?.content ?? "";
  const json = content.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(json);
  } catch {
    // Sortie non parsable → zéro position ; l'appelant replie sur le déterministe.
  }

  const clean = sanitizeAiExtraction(parsed);
  const usage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
  return {
    ...clean,
    usage: {
      ...{ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      costUsd:
        (usage.inputTokens * PRICE_PER_MTOK.input + usage.outputTokens * PRICE_PER_MTOK.output) /
        1e6,
    },
    model: RELEVE_AI_MODEL,
  };
}
