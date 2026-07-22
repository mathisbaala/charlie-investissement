// Couche IA des calculateurs : routing (quelle demande → quel calculateur) et
// pré-remplissage des champs depuis la phrase du CGP. L'IA ne CALCULE jamais —
// elle mappe du texte vers le registre ; tout ce qu'elle renvoie est re-validé
// ici en dur (même philosophie que sanitizeParsedFilters dans lib/claude.ts :
// une clé hallucinée ou une valeur hors enum n'atteint jamais le formulaire).

import { CALCULATORS, CALCULATOR_BY_ID } from "./registry";
import type { CalcValues } from "./types";

// ─── Prompt de routing (construit depuis le registre — jamais à la main) ─────

function fieldLine(f: (typeof CALCULATORS)[number]["fields"][number]): string {
  const type =
    f.type === "enum"
      ? `enum(${(f.options ?? []).map((o) => o.value).join("|")})`
      : f.type;
  return `    - ${f.key} (${type}) : ${f.label}`;
}

/** Catalogue des calculateurs pour le prompt système (id, description, champs). */
export function buildCatalog(): string {
  return CALCULATORS.map((c) => {
    const aliases = c.aliases?.length ? ` [alias : ${c.aliases.join(", ")}]` : "";
    return `- id "${c.id}" — ${c.title} : ${c.description}${aliases}\n  Champs :\n${c.fields.map(fieldLine).join("\n")}`;
  }).join("\n");
}

export function buildSystemPrompt(): string {
  return `Tu es l'assistant d'un conseiller en gestion de patrimoine. On te donne une demande en français ; tu dois identifier LE calculateur adapté parmi le catalogue et extraire les valeurs déjà présentes dans la phrase.

Catalogue :
${buildCatalog()}

Réponds UNIQUEMENT avec un objet JSON :
{
  "calculator_id": "<id>" | null,
  "candidates": ["<id>", ...],
  "values": { "<champ>": <valeur>, ... }
}

Règles :
- "calculator_id" : l'id le plus adapté si tu es confiant. En cas d'hésitation réelle entre 2-3 calculateurs, mets null et propose-les dans "candidates" (ids du catalogue uniquement).
- "values" : UNIQUEMENT des champs du calculateur choisi, UNIQUEMENT s'ils sont présents dans la demande. Ne devine pas, n'invente pas de valeur par défaut.
- Montants en euros → nombre ("300 k€" → 300000, "1,2 M€" → 1200000, "un million" → 1000000).
- Pourcentages → nombre (« 30 % » → 30).
- enum → exactement une des valeurs listées. bool → true/false.
- Liens de parenté : « à mon fils / ma fille / mes enfants » → "enfant" ; « petit-fils/petite-fille » → "petit_enfant" ; « à ma femme / mon mari / partenaire » → "epoux" ; « frère/sœur » → "frere_soeur" ; « neveu/nièce » → "neveu_niece" ; sans lien → "autre".
- Pas d'explication, pas de texte hors JSON.`;
}

// ─── Validation dure de la sortie LLM ────────────────────────────────────────

export interface ParsedCalcQuery {
  calculatorId: string | null;
  candidates: string[];
  values: CalcValues;
}

/**
 * Ne garde que : un id existant, des candidats existants (3 max), et des
 * valeurs conformes aux FieldDef du calculateur retenu (type, enum, bornes).
 * Une valeur hors bornes est ÉCARTÉE, pas clampée (une aberration trahit une
 * mauvaise lecture — mieux vaut un champ vide qu'un champ faux).
 */
export function sanitizeParsedCalc(raw: unknown): ParsedCalcQuery {
  const out: ParsedCalcQuery = { calculatorId: null, candidates: [], values: {} };
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;

  const id = typeof r.calculator_id === "string" ? r.calculator_id : null;
  if (id && CALCULATOR_BY_ID[id]) out.calculatorId = id;

  if (Array.isArray(r.candidates)) {
    out.candidates = r.candidates
      .filter((c): c is string => typeof c === "string" && !!CALCULATOR_BY_ID[c] && c !== out.calculatorId)
      .slice(0, 3);
  }

  const def = out.calculatorId ? CALCULATOR_BY_ID[out.calculatorId] : null;
  if (def && typeof r.values === "object" && r.values !== null) {
    const vals = r.values as Record<string, unknown>;
    for (const f of def.fields) {
      const v = vals[f.key];
      if (v === undefined || v === null) continue;
      switch (f.type) {
        case "eur":
        case "pct":
        case "int": {
          const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
          if (!Number.isFinite(n)) break;
          if (f.min != null && n < f.min) break;
          if (f.max != null && n > f.max) break;
          out.values[f.key] = f.type === "int" ? Math.round(n) : n;
          break;
        }
        case "enum": {
          if (typeof v === "string" && f.options?.some((o) => o.value === v)) out.values[f.key] = v;
          break;
        }
        case "bool": {
          if (typeof v === "boolean") out.values[f.key] = v;
          else if (v === "true" || v === "false") out.values[f.key] = v === "true";
          break;
        }
        case "date": {
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out.values[f.key] = v;
          break;
        }
      }
    }
  }
  return out;
}
