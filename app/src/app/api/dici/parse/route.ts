import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `Tu es un expert en analyse de documents financiers réglementaires (DICI / KID / PRIIPs).
Extrais les informations du document DICI fourni et retourne un objet JSON structuré.

Retourne UNIQUEMENT un objet JSON valide avec les champs suivants (null si non trouvé) :

{
  "name": string,
  "isin": string | null,
  "gestionnaire": string | null,
  "product_type": "etf" | "opcvm" | "scpi" | "fonds_euros" | "structured" | "autre" | null,
  "sfdr_article": 6 | 8 | 9 | null,
  "sri": number | null,
  "investment_objective": string | null,
  "recommended_holding_period": string | null,
  "entry_fees_max": string | null,
  "exit_fees_max": string | null,
  "ongoing_charges": number | null,
  "performance_fees": string | null,
  "target_investor": string | null,
  "key_risks": string[] | null,
  "benchmark": string | null,
  "currency": string | null,
  "domicile": string | null,
  "inception_date": string | null
}

Règles :
- sri : extraire le chiffre de l'indicateur synthétique de risque (1 à 7)
- ongoing_charges : extraire le pourcentage annuel de frais courants (ex: 0.25 pour 0.25%)
- product_type : déduire du type de fonds mentionné dans le document
- sfdr_article : chercher les mentions "article 6", "article 8", "article 9" de la réglementation SFDR
- entry/exit_fees_max : extraire sous forme de string (ex: "2%", "0%", "Non applicable")
- key_risks : liste des principaux risques mentionnés (max 5, concis)
- Répondre en JSON pur, sans markdown, sans commentaires`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { file_base64 } = body as { file_base64?: string };

    if (!file_base64) {
      return NextResponse.json({ error: "file_base64 requis" }, { status: 400 });
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: file_base64,
              },
            },
            {
              type: "text",
              text: "Extrais toutes les informations de ce DICI et retourne le JSON structuré.",
            },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const fiche = JSON.parse(cleaned);

    return NextResponse.json(fiche);
  } catch (err) {
    console.error("DICI parse error:", err);
    return NextResponse.json({ error: "Erreur d'analyse du document" }, { status: 500 });
  }
}
