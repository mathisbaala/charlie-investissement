import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `Tu es Charlie, un assistant spécialisé pour les Conseillers en Gestion de Patrimoine français. Tu aides à analyser des fonds d'investissement, interpréter des données financières et préparer des recommandations clients. Tu réponds en français, de façon concise et professionnelle. Tu ne donnes pas de conseils d'investissement personnalisés.`;

type Message = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { messages } = (await req.json()) as { messages: Message[] };

    if (!messages?.length) {
      return new Response("Messages manquants", { status: 400 });
    }

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (
              chunk.type === "content_block_delta" &&
              chunk.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
          }
        } catch {
          // Stream error (e.g. API quota) — close cleanly so client sees empty body
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[chat]", err);
    return new Response("Erreur serveur", { status: 500 });
  }
}
