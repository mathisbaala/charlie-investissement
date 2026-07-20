import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { aiRateLimit, botGuard, dataRateLimit, AI_COST } from "@/lib/rateLimit";
import { EXTRACTION_MODEL } from "@/lib/claude";

export const runtime = "nodejs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `Tu es un expert en conseil en gestion de patrimoine (CGP).
Extrais les informations du profil client depuis le contenu fourni et retourne un objet JSON avec les champs suivants (tous optionnels, inclure uniquement ceux détectés) :

{
  "age": number,
  "amount_eur": number,
  "horizon_years": number,
  "objectif": "capitalisation" | "revenus" | "retraite" | "transmission" | "defiscalisation",
  "risk_profile": "prudent" | "modere" | "equilibre" | "dynamique" | "offensif",
  "perte_max": "5" | "10" | "20" | "30" | "illimitee",
  "envelopes": ["PEA","PEA-PME","PER","AV-FR","AV-LUX","CTO"],
  "esg": "indifferent" | "art8" | "art9",
  "exclusions": ["tabac","armes","fossiles","jeux","alcool"],
  "tmi": "0" | "11" | "30" | "41" | "45",
  "asset_classes": ["actions","obligations","scpi","private_equity","monetaire","multi_actifs"]
}

Règles de mapping :
- SRRI/SRI 1-2 → prudent, 3 → modéré, 3-4 → équilibré, 4-5 → dynamique, 6-7 → offensif
- "prudent", "défensif", "sécurisé", "sans risque" → prudent
- "modéré", "modéré-prudent" → modere
- "équilibré", "balanced" → equilibre
- "dynamique", "croissance" → dynamique
- "offensif", "agressif", "performance" → offensif
- "retraite", "PER", "préparation retraite" → objectif retraite + enveloppe PER
- "revenus", "rente", "dividendes", "distribution" → objectif revenus
- "transmission", "succession", "donation" → objectif transmission
- "défiscalisation", "IR", "IFI", "réduction impôts" → objectif defiscalisation
- "capitalisation", "croissance", "valorisation" → objectif capitalisation
- "assurance-vie", "AV", "contrat" → enveloppe AV-FR (si mention France/française) ou AV-LUX (si Luxembourg)
- "PEA" → enveloppe PEA
- "CTO", "compte-titres" → enveloppe CTO
- "ESG", "durable", "responsable", "vert", "ISR" → esg art8
- "article 9", "impact" → esg art9
- "fossiles", "charbon", "pétrole", "hydrocarbures" → exclusions fossiles
- "armes", "défense", "armement" → exclusions armes
- "tabac", "cigarettes" → exclusions tabac
- TMI 30% → tmi "30", TMI 41% → tmi "41", TMI 45% → tmi "45"
- Horizon 1-3 ans → horizon_years 2, 3-7 ans → horizon_years 5, 8-12 ans → horizon_years 10, 13-18 ans → horizon_years 15, >18 ans → horizon_years 20
- "court terme" → horizon_years 2, "moyen terme" → horizon_years 7, "long terme" → horizon_years 15
- "SCPI" → asset_classes inclut "scpi"
- "private equity", "non coté", "PE", "capital investissement" → asset_classes inclut "private_equity"
- "obligations", "obligataire", "taux" → asset_classes inclut "obligations"
- "actions", "equity", "boursier" → asset_classes inclut "actions"
- "monétaire", "liquidités", "cash" → asset_classes inclut "monetaire"
- "multi-actifs", "diversifié", "flexible" → asset_classes inclut "multi_actifs"

Retourne UNIQUEMENT l'objet JSON valide. Pas d'explication.`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Anti-bot + anti-burst en amont du quota IA journalier (défense en profondeur).
  const bot = botGuard(req);
  if (bot) return bot;
  const burst = await dataRateLimit(req, 1);
  if (burst) return burst;

  let body: { text?: string; file_base64?: string; file_type?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  // Construit + VALIDE le contenu avant de consommer le quota IA (sinon une
  // requête vide ou un PDF hors gabarit gaspillerait une unité de quota).
  let messageContent: Anthropic.MessageParam["content"];

  if (body.file_base64 && body.file_type === "application/pdf") {
    // Garde-fou COÛT (aligné sur /api/dici/parse) : un PDF est facturé par Claude
    // au prorata du nombre de pages → on plafonne la taille AVANT tout appel au
    // modèle (taille brute ≈ longueur base64 × 3/4) et on exige la signature %PDF
    // (sinon un blob arbitraire étiqueté PDF serait facturé).
    const MAX_PDF_BYTES = Number(process.env.PROFILE_MAX_BYTES ?? 4_000_000); // ~4 Mo
    if (Math.floor((body.file_base64.length * 3) / 4) > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "Fichier trop volumineux", code: "too_large", max_mb: Math.round(MAX_PDF_BYTES / 1_000_000) },
        { status: 413 },
      );
    }
    const head = Buffer.from(body.file_base64.slice(0, 16), "base64").toString("latin1");
    if (!head.startsWith("%PDF")) {
      return NextResponse.json(
        { error: "Le fichier n'est pas un PDF valide", code: "not_pdf" },
        { status: 422 },
      );
    }
    messageContent = [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: body.file_base64,
        },
      } as Anthropic.DocumentBlockParam,
      {
        type: "text",
        text: "Extrais les informations du profil client de ce document.",
      },
    ];
  } else if (body.text?.trim()) {
    messageContent = `Extrais les informations du profil client depuis ce contenu :\n\n${body.text.slice(0, 8000)}`;
  } else {
    return NextResponse.json({ error: "Aucun contenu à analyser" }, { status: 400 });
  }

  const limited = await aiRateLimit(req, AI_COST.profile);
  if (limited) return limited;

  try {
    const response = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: messageContent }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    return NextResponse.json(JSON.parse(json));
  } catch (e) {
    console.error("parse-profile error:", e);
    // Panne Claude (indispo, quota SDK) → 503 pour que l'UI propose un retry ;
    // le reste (JSON illisible) → 500 générique, sans exposer la cause.
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: "Service d'analyse indisponible", code: "ai_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Analyse impossible" }, { status: 500 });
  }
}
