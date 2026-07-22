import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { aiRateLimit, botGuard, dataRateLimit, AI_COST } from "@/lib/rateLimit";
import { EXTRACTION_MODEL } from "@/lib/claude";
import { buildSystemPrompt, sanitizeParsedCalc } from "@/lib/calculators/parse";

// Routing + pré-remplissage des calculateurs patrimoniaux : une phrase du CGP →
// {calculator_id, values} validés en dur. Le CALCUL reste 100 % déterministe
// côté client (lib/calculators) — cette route ne renvoie jamais un résultat.

export const runtime = "nodejs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Le prompt dépend du registre (statique au build) : construit une fois.
const SYSTEM = buildSystemPrompt();

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

  try {
    const response = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 2000) }],
    });
    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
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
