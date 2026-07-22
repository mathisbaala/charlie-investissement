import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { aiRateLimit, botGuard, dataRateLimit, AI_COST } from "@/lib/rateLimit";
import { EXTRACTION_MODEL } from "@/lib/claude";
import { buildSystemPrompt, sanitizeParsedCalc } from "@/lib/calculators/parse";

// Routing + pré-remplissage des calculateurs patrimoniaux : une phrase du CGP →
// {calculator_id, values} validés en dur. Le CALCUL reste 100 % déterministe
// côté client (lib/calculators) — cette route ne renvoie jamais un résultat.
//
// Modèle : Z.AI GLM 5.2 (moins cher que Haiku, appel direct OpenAI-compatible
// comme lib/allocationReview). Repli sur Claude Haiku si la clé Z.AI manque ou
// si Z.AI est en panne — le routing est un mapping simple, les deux modèles
// s'en acquittent ; on privilégie le coût, jamais la panne.

export const runtime = "nodejs";

const ZAI_ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";
const ZAI_MODEL = "glm-5.2";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Le prompt dépend du registre (statique au build) : construit une fois.
const SYSTEM = buildSystemPrompt();

interface ZaiResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** Appel Z.AI GLM 5.2 — renvoie le texte brut de la réponse. */
async function callZai(text: string): Promise<string> {
  const res = await fetch(ZAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ZAI_MODEL,
      // Raisonnement désactivé : mapping structuré, la qualité ne bouge pas et
      // la latence tombe de dizaines de secondes à quelques-unes (cf.
      // allocationReview, mesuré sur la revue d'allocation).
      thinking: { type: "disabled" },
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    }),
  });
  const data = (await res.json().catch(() => null)) as ZaiResponse | null;
  if (!res.ok || !data) {
    throw new Error(data?.error?.message ?? `Z.AI a répondu ${res.status}.`);
  }
  return data.choices?.[0]?.message?.content ?? "{}";
}

/** Repli Claude Haiku (même prompt) — utilisé seulement sans clé Z.AI ou sur panne. */
async function callAnthropic(text: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: "user", content: text }],
  });
  return response.content[0].type === "text" ? response.content[0].text : "{}";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Anti-bot + anti-burst en amont du quota IA (même défense que parse-profile).
  const bot = botGuard(req);
  if (bot) return bot;
  const burst = await dataRateLimit(req, 1);
  if (burst) return burst;

  let body: { text?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "Aucune demande à analyser" }, { status: 400 });
  }

  const limited = await aiRateLimit(req, AI_COST.parse);
  if (limited) return limited;

  const input = text.slice(0, 2000);
  try {
    let raw: string;
    if (process.env.ZAI_API_KEY) {
      try {
        raw = await callZai(input);
      } catch (e) {
        // Z.AI en panne → repli Haiku plutôt qu'un échec utilisateur.
        console.error("calculateurs/parse: Z.AI indisponible, repli Anthropic:", e);
        raw = await callAnthropic(input);
      }
    } else {
      raw = await callAnthropic(input);
    }
    const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    return NextResponse.json(sanitizeParsedCalc(JSON.parse(json)));
  } catch (e) {
    console.error("calculateurs/parse error:", e);
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: "Service d'analyse indisponible", code: "ai_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Analyse impossible" }, { status: 500 });
  }
}
