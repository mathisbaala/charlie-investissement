import { NextRequest, NextResponse } from "next/server";
import { reviewAllocation, type ReviewClientContext } from "@/lib/allocationReview";
import type { AllocationResult, AssetClass } from "@/lib/optimizer";

export const dynamic = "force-dynamic";

// Vérification IA d'une allocation produite par le moteur : reçoit le résultat
// d'optimisation + le contexte client, renvoie un verdict, des constats et
// d'éventuelles corrections (exclusions / cibles de classes) que le FRONT
// ré-exécute via /api/portfolio/optimize. Le coût API (tokens, USD) est
// remonté systématiquement pour que le cabinet puisse suivre la dépense.

interface ReviewRequestBody {
  allocation: AllocationResult;
  client: ReviewClientContext;
  engineTargets?: Partial<Record<AssetClass, number>>;
  mustInclude?: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!process.env.ZAI_API_KEY) {
    return NextResponse.json(
      { error: "Vérification IA indisponible : ZAI_API_KEY non configurée." },
      { status: 503 },
    );
  }

  let body: ReviewRequestBody;
  try {
    body = (await req.json()) as ReviewRequestBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  if (!body?.allocation?.lines?.length || !body.client) {
    return NextResponse.json(
      { error: "Champs requis : allocation (avec lignes) et client." },
      { status: 400 },
    );
  }

  try {
    const review = await reviewAllocation(
      body.allocation,
      body.client,
      body.engineTargets,
      body.mustInclude ?? [],
    );
    return NextResponse.json({ review }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    // Erreur API (clé invalide, rate-limit, réseau) : la génération de
    // portefeuille ne doit JAMAIS échouer à cause de la revue — le front
    // affiche l'allocation non vérifiée avec la raison.
    console.error("[review] revue IA échouée:", e);
    return NextResponse.json(
      { error: "La vérification IA a échoué (service indisponible ou clé invalide)." },
      { status: 502 },
    );
  }
}
