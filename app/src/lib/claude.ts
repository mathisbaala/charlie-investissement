import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ScreenerFilters = {
  sfdr_article?: number[];
  sri_min?: number;
  sri_max?: number;
  ter_max?: number;
  perf_1y_min?: number;
  pea_eligible?: boolean;
  per_eligible?: boolean;
  av_lux_eligible?: boolean;
  product_type?: string[];
  name_search?: string;
  limit?: number;
};

const SYSTEM_PROMPT = `Tu es un assistant qui convertit des requêtes en langage naturel en filtres JSON pour une base de données de fonds d'investissement français.

Colonnes disponibles :
- sfdr_article : Article SFDR (6, 8 ou 9)
- sri : Indicateur de risque 1 à 7 (1=très faible, 7=très élevé)
- ongoing_charges / ter : Frais courants en % (ex: 0.85 = 0.85%)
- performance_1y, performance_3y, performance_5y : Performances en % (ex: 12.5 = 12.5%)
- pea_eligible, per_eligible, av_lux_eligible : booléens (PEA, PER, Assurance-Vie Luxembourg)
- product_type : "opcvm", "etf", "scpi", "action", "crypto", "fonds_euros", "livret"
- morningstar_rating : 1 à 5

Retourne UNIQUEMENT un objet JSON valide avec ces champs optionnels :
{
  "sfdr_article": [8, 9],
  "sri_min": 1,
  "sri_max": 4,
  "ter_max": 1.0,
  "perf_1y_min": 5,
  "pea_eligible": true,
  "per_eligible": true,
  "av_lux_eligible": false,
  "product_type": ["opcvm", "etf"],
  "name_search": "amundi",
  "limit": 50
}

Ne retourne que les filtres pertinents pour la requête. Pas d'explication, juste le JSON.`;

export async function interpretQuery(query: string): Promise<ScreenerFilters> {
  const sanitized = query.slice(0, 500).replace(/[<>]/g, "");

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: sanitized }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    return JSON.parse(json) as ScreenerFilters;
  } catch {
    return {};
  }
}
