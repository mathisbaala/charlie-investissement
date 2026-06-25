import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { aiRateLimit, AI_COST } from "@/lib/rateLimit";
import { logEvent } from "@/lib/analytics";
import { searchFundsForChat } from "@/lib/chatTools";

export const runtime = "nodejs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Outil donnant au modèle l'accès aux données réelles des fonds (anti-hallucination).
const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_funds",
    description:
      "Recherche des fonds, ETF ou SCPI RÉELS dans la base Charlie Investissement. " +
      "À utiliser dès qu'une question porte sur des fonds concrets (trouver, lister, " +
      "comparer, « quel fonds… », un nom / ISIN / gestionnaire / thème précis). " +
      "Renvoie un tableau JSON de fonds avec leurs données à jour (ISIN, frais, " +
      "performances, SRI, SFDR, encours, éligibilités, url de la fiche).",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Termes de recherche en français : nom de fonds, gestionnaire, ISIN, " +
            "zone géographique, classe d'actif, thème (ex: « ETF monde », « Amundi », " +
            "« FR0010315770 », « obligataire euro »).",
        },
        limit: { type: "number", description: "Nombre maximum de fonds (défaut 8, max 12)." },
      },
      required: ["query"],
    },
  },
];

async function runTool(name: string, input: unknown): Promise<string> {
  try {
    if (name === "search_funds") {
      const { query, limit } = (input ?? {}) as { query?: string; limit?: number };
      const funds = await searchFundsForChat(query ?? "", limit ?? 8);
      return JSON.stringify(funds);
    }
  } catch (e) {
    console.error("[chat] tool error", name, e);
  }
  return "[]";
}

const SYSTEM = `Tu es Charlie, l'assistant IA intégré à la plateforme de recherche et d'analyse de fonds d'investissement Charlie Investissement. Tu assistes des Conseillers en Gestion de Patrimoine (CGP) français dans leur travail quotidien.

## Ton rôle
- Aider à interpréter les données des fonds : performance, risque, frais, éligibilités
- Expliquer les notions réglementaires et financières liées aux OPCVM/ETF/SCPI
- Aider à formuler des argumentaires et des comparaisons pour les clients
- Orienter vers les bonnes fonctionnalités de la plateforme

## Données disponibles dans la plateforme
- **Screener** (/recherche) : filtrer les fonds par catégorie, SFDR, SRI, performance, TER, éligibilité
- **Fiche fonds** (/fonds/ISIN) : détail complet : VL historique, composition, frais détaillés, éligibilités
- **Profil client** (/accueil) : décrire le client (risque, horizon, enveloppes) pour une sélection de fonds adaptée
- **Portefeuille** (/portefeuille) : composer un portefeuille pondéré : ratios, corrélation, back-test vs indice

## Référentiels clés

### Éligibilités fiscales (enveloppes françaises)
- **PEA** : actions européennes uniquement, plafond 150 000 €, exonération IR après 5 ans
- **PEA-PME** : PME/ETI européennes, plafond 225 000 € (cumulé PEA+PEA-PME = 225k), fiscalité identique PEA
- **PER** (Plan Épargne Retraite) : tous supports, déductibilité des versements, sortie en rente ou capital à la retraite
- **AV France** : assurance-vie de droit français, fonds en UC, fiscalité avantageuse après 8 ans
- **AV Luxembourg** : super-privilège liquidatif, neutralité fiscale, accès à une gamme UC plus large
- **CTO** : Compte-Titres Ordinaire, sans plafond ni avantage fiscal, flat tax 30%

### Classification SFDR (Sustainable Finance Disclosure Regulation)
- **Article 6** : fonds sans critère ESG particulier (non-classifié)
- **Article 8** : fonds promouvant des caractéristiques environnementales/sociales (« vert clair »)
- **Article 9** : fonds ayant l'investissement durable comme objectif principal (« vert foncé »), ex. fonds alignés Taxonomie

### Indicateur de risque SRI (échelle 1-7)
- 1-2 : faible risque (ex. fonds monétaires, obligataires courts)
- 3-4 : risque modéré (mixtes, obligataires diversifiés)
- 5-6 : risque élevé (actions, matières premières)
- 7 : risque très élevé (crypto, leviers, marchés émergents concentrés)

### Frais : lecture des indicateurs
- **TER / Frais courants (ongoing charges)** : frais totaux annualisés, base de comparaison principale ; < 0,5% = très faible (ETF) ; 1,5-2,5% = standard gestion active
- **Frais d'entrée max** : frais de souscription, souvent négociables à 0% en distributor direct
- **Frais de sortie max** : rares sur OPCVM modernes
- **Commission de performance** : prélevée sur la surperformance vs benchmark, attention à l'impact en années de forte hausse
- **Rétrocession CGP** : commission de distribution reversée au CGP par la société de gestion sur les frais courants (ex : 0,50% de 1,50% TER = 33% de rétrocession)

### Notation Morningstar (étoiles 1-5)
- Basée sur performance ajustée du risque sur 3/5/10 ans vs catégorie
- 5★ = top 10%, 4★ = 22,5%, 3★ = 35%, 2★ = 22,5%, 1★ = bas 10%
- Ne pas utiliser seul : une 1★ peut redevenir 5★ après changement de gérant

### Contexte réglementaire CGP
- **MIF2** : obligation de suitability, adéquation produit/profil client, documentation conseil
- **DDA** (Directive Distribution Assurance) : pour les produits vie
- **PRIIPS KID** : document d'information clé, obligatoire pour tout OPCVM
- **RTO** (Recueil des besoins) : document obligatoire avant toute recommandation

## Accès aux données réelles (outil search_funds)
Tu disposes de l'outil **search_funds** qui interroge la VRAIE base de fonds.
- Utilise-le SYSTÉMATIQUEMENT dès qu'une question porte sur des fonds concrets :
  trouver, lister, comparer, « quel fonds… », ou un nom / ISIN / gestionnaire / thème précis.
- Ne cite JAMAIS un fonds (nom, chiffres) sans l'avoir obtenu via l'outil. N'invente jamais
  un fonds, un ISIN ou une performance de mémoire.
- Si l'outil ne renvoie rien, dis-le clairement et propose de reformuler ou d'utiliser le screener.

## Comment citer un fonds
Présente chaque fonds en **lien markdown cliquable** vers sa fiche, au format exact
\`[Nom du fonds](/fonds/ISIN)\`, suivi des chiffres clés pertinents issus de l'outil
(TER, perf 1A/3A, SRI, SFDR, encours, éligibilités). Exemple :
« [Amundi MSCI World UCITS ETF](/fonds/IE000BI8OT95) : TER 0,12 %, perf 3A +17,6 %, SRI 4 ».
N'utilise QUE les valeurs renvoyées par l'outil.

## Ton style
- Réponses en français, concises et professionnelles
- Utilise des chiffres précis quand disponibles ; indique « données non disponibles » sinon
- Rappelle, lorsque c'est pertinent, que tu ne donnes pas de conseil en investissement personnalisé au sens réglementaire
- N'utilise jamais de tiret cadratin (—) : préfère la virgule, le deux-points ou une nouvelle phrase
- Évite les formules creuses et les superlatifs vides (« en un coup d'œil », « plongez », « le meilleur de »)`;



type Message = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { messages } = (await req.json()) as { messages: Message[] };

    if (!messages?.length) {
      return new Response("Messages manquants", { status: 400 });
    }

    const limited = await aiRateLimit(req, AI_COST.chat);
    if (limited) return limited;

    // Télémétrie : usage du chat (volume + longueur de conversation). On ne journalise
    // PAS le contenu des messages (questions du CGP), seulement le nombre de tours.
    logEvent(req, { event_type: "chat", meta: { turns: messages.length } });

    const convo: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Boucle d'outil : tant que le modèle demande search_funds, on exécute
          // l'outil et on relance. Le texte est streamé au fil de l'eau à chaque tour
          // (le tour final = la réponse rédigée avec liens cliquables). Borne à 4 tours
          // pour éviter toute boucle d'outil infinie.
          for (let round = 0; round < 4; round++) {
            const stream = client.messages.stream({
              model: "claude-sonnet-4-6",
              max_tokens: 2048,
              system: SYSTEM,
              tools: TOOLS,
              messages: convo,
            });

            for await (const chunk of stream) {
              if (
                chunk.type === "content_block_delta" &&
                chunk.delta.type === "text_delta"
              ) {
                controller.enqueue(encoder.encode(chunk.delta.text));
              }
            }

            const final = await stream.finalMessage();
            if (final.stop_reason !== "tool_use") break;

            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of final.content) {
              if (block.type === "tool_use") {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: await runTool(block.name, block.input),
                });
              }
            }
            convo.push({ role: "assistant", content: final.content });
            convo.push({ role: "user", content: toolResults });
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
