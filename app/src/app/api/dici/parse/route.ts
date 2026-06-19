import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { aiRateLimit, AI_COST } from "@/lib/rateLimit";
import { logEvent } from "@/lib/analytics";
import { EXTRACTION_MODEL } from "@/lib/claude";

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
  "inception_date": string | null,  // format ISO AAAA-MM-JJ
  "transaction_costs": number | null,  // coûts de transaction annuels en % (ex: 0.15)
  "total_costs": number | null,  // coûts totaux annuels en % (réduction de rendement / RIY) si indiqué
  "performance_scenarios": [  // tableau des scénarios de performance du KID (null si absents)
    {
      "scenario": "stress" | "defavorable" | "intermediaire" | "favorable",
      "return_pct": number | null,  // rendement annuel moyen en % sur la durée recommandée
      "final_amount": number | null  // montant récupéré en € pour 10 000 € investis (durée recommandée)
    }
  ] | null
}

Règles :
- sri : extraire le chiffre de l'indicateur synthétique de risque (1 à 7)
- ongoing_charges : extraire le pourcentage annuel de frais courants (ex: 0.25 pour 0.25%)
- product_type : déduire du type de fonds mentionné dans le document
- sfdr_article : chercher les mentions "article 6", "article 8", "article 9" de la réglementation SFDR
- entry/exit_fees_max : extraire sous forme de string (ex: "2%", "0%", "Non applicable")
- key_risks : liste des principaux risques mentionnés (max 5, concis)
- inception_date : date de création/lancement au format ISO AAAA-MM-JJ. Les DICI français
  écrivent les dates en JJ/MM/AAAA : convertir impérativement (ex: "07/11/2019" → "2019-11-07").
- performance_scenarios : extraire le tableau « Scénarios de performance » du KID/PRIIPs.
  Il contient en général 4 scénarios (Tensions/Stress, Défavorable, Intermédiaire/Modéré,
  Favorable). Pour CHAQUE scénario, à la DURÉE DE DÉTENTION RECOMMANDÉE, extraire le
  rendement annuel moyen (return_pct, en %) et/ou le montant final récupéré (final_amount, en €,
  base d'investissement de 10 000 €). Mapper les libellés : "Tensions"/"Stress" → "stress",
  "Défavorable" → "defavorable", "Intermédiaire"/"Modéré"/"Central" → "intermediaire",
  "Favorable" → "favorable". Si le tableau est absent, mettre null.
- transaction_costs / total_costs : extraire du tableau des coûts si présents (en % annuel).
- Répondre en JSON pur, sans markdown, sans commentaires`;

// Retrouve en base le fonds correspondant au DIC analysé.
// Priorité à l'ISIN (correspondance exacte) ; repli sur le nom (ilike, plus gros encours).
async function matchFund(
  isin: string | null,
  name: string | null,
): Promise<{ isin: string; name: string } | null> {
  if (isin) {
    const clean = isin.trim().toUpperCase();
    if (/^[A-Z0-9]{12}$/.test(clean)) {
      const { data } = await supabase
        .from("investissement_funds")
        .select("isin, name")
        .eq("isin", clean)
        .maybeSingle();
      if (data) return { isin: data.isin, name: data.name };
    }
  }
  if (name) {
    const safe = name.replace(/[%_,()[\]\\]/g, " ").trim().slice(0, 60);
    if (safe.length >= 4) {
      const { data } = await supabase
        .from("investissement_funds")
        .select("isin, name, aum_eur")
        .ilike("name", `%${safe}%`)
        .order("aum_eur", { ascending: false, nullsFirst: false })
        .limit(1);
      if (data && data[0]) return { isin: data[0].isin, name: data[0].name };
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { file_base64 } = body as { file_base64?: string };

    if (!file_base64) {
      return NextResponse.json({ error: "file_base64 requis" }, { status: 400 });
    }

    // Garde-fou COÛT : un PDF est facturé par Claude au prorata du nombre de
    // pages (texte + image par page). Un document de centaines de pages coûterait
    // une fortune en tokens. Un DICI/KID fait 2-3 pages → quelques centaines de
    // Ko. On plafonne donc la taille AVANT tout appel au modèle. La taille brute
    // ≈ longueur base64 × 3/4.
    const MAX_PDF_BYTES = Number(process.env.DICI_MAX_BYTES ?? 3_000_000); // ~3 Mo
    const approxBytes = Math.floor((file_base64.length * 3) / 4);
    if (approxBytes > MAX_PDF_BYTES) {
      return NextResponse.json(
        {
          error: "Fichier trop volumineux",
          code: "too_large",
          max_mb: Math.round(MAX_PDF_BYTES / 1_000_000),
        },
        { status: 413 },
      );
    }

    // Garde-fou COÛT/ABUS : vérifier que c'est bien un PDF (magie %PDF) avant
    // d'envoyer quoi que ce soit au modèle — sinon n'importe quel blob arbitraire
    // serait facturé.
    const head = Buffer.from(file_base64.slice(0, 16), "base64").toString("latin1");
    if (!head.startsWith("%PDF")) {
      return NextResponse.json(
        { error: "Le fichier n'est pas un PDF valide", code: "not_pdf" },
        { status: 422 },
      );
    }

    const limited = await aiRateLimit(req, AI_COST.dici);
    if (limited) return limited;

    const response = await client.messages.create({
      model: EXTRACTION_MODEL,
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
    // Échec de parsing = le modèle n'a pas su lire le document (PDF illisible,
    // hors-format, non DICI). On distingue ce cas (422, faute côté document) des
    // pannes du service IA (catch global, 503) — sinon une clé invalide ou un
    // quota dépassé s'affiche à tort « DICI invalide » côté utilisateur.
    let fiche;
    try {
      fiche = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Document illisible", code: "unreadable" },
        { status: 422 },
      );
    }

    // Reliure DIC → fonds : on tente de retrouver le fonds correspondant en base
    // pour pouvoir ouvrir directement sa fiche produit complète. ISIN d'abord
    // (correspondance exacte, fiable), repli sur le nom sinon.
    const match = await matchFund(fiche.isin, fiche.name);

    // Télémétrie : upload/analyse d'un DICI (usage + taux de matching en base).
    logEvent(req, {
      event_type: "dici",
      isin: match?.isin ?? null,
      meta: { matched: Boolean(match), product_type: fiche.product_type ?? null },
    });

    return NextResponse.json({ ...fiche, matched_isin: match?.isin ?? null, matched_name: match?.name ?? null });
  } catch (err) {
    // Toute autre erreur ici = panne en amont (appel Claude : clé invalide,
    // quota, indisponibilité réseau). Ce n'est PAS la faute du document : on le
    // signale par un 503 + code dédié pour que l'UI affiche un message adapté.
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    console.error("DICI parse error:", status ?? "", err);
    return NextResponse.json(
      { error: "Service d'analyse indisponible", code: "ai_unavailable" },
      { status: 503 },
    );
  }
}
