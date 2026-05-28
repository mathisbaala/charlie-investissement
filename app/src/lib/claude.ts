import Anthropic from "@anthropic-ai/sdk";
import type { ScreenerFilters } from "@/lib/types";
import type { ParsedFilters } from "@/lib/types";

// Re-export so that existing imports of ScreenerFilters from "@/lib/claude"
// continue to work without changes.
export type { ScreenerFilters };

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Tu es un assistant qui convertit des requêtes en langage naturel en filtres JSON pour une base de données de fonds d'investissement français.

Champs disponibles :
- sfdr_article : Article SFDR (6, 8 ou 9)
- sri_min / sri_max : Indicateur de risque 1 à 7 (1=très faible, 7=très élevé)
- ter_min / ter_max : Frais courants en % (ex: 0.85 = 0.85%)
- perf_1y_min / perf_3y_min : Performances minimales en % (ex: 12.5 = 12.5%)
- aum_min : Encours minimum en euros (ex: 100000000 = 100M€)
- pea_eligible, per_eligible, av_lux_eligible : booléens (PEA, PER, Assurance-Vie Luxembourg)
- product_type : "opcvm" | "etf" | "scpi" | "action" | "crypto" | "fonds_euros" | "livret" | "fps"
- asset_class : "actions" | "obligations" | "monetaire" | "immobilier" | "multi-actifs" | "euro_garanti" | "private_equity" | "crypto" | "alternatif"
- region : "france" | "europe" | "eurozone" | "usa" | "japan" | "asia" | "emerging" | "world"
- gestionnaire : nom du gestionnaire (ex: "Amundi", "BlackRock")
- labels : tags screener — ["pea","esg","article-8","low-cost","mid-cost","high-cost","screener-ready","kid-ready","large-cap"]
- sort_by : "performance_3y" | "performance_1y" | "aum_eur" | "ter" (défaut: data_completeness desc)
- name_search : recherche dans le nom du fonds
- completeness_min : complétude données minimum 0-100 (défaut 50)
- limit : nombre de résultats (défaut 50, max 200)

Exemples de mappings :
- "ESG peu risqués" → {"sfdr_article":[8,9],"sri_max":3}
- "ETF monde low cost éligibles PEA" → {"product_type":["etf"],"region":["world"],"labels":["low-cost"],"pea_eligible":true}
- "fonds euros garantis" → {"product_type":["fonds_euros"]}
- "actions US performantes" → {"asset_class":["actions"],"region":["usa"],"sort_by":"performance_3y"}
- "SCPI immobilier" → {"product_type":["scpi"]}
- "fonds Amundi article 8" → {"gestionnaire":"Amundi","sfdr_article":[8]}

Retourne UNIQUEMENT un objet JSON valide. Pas d'explication.`;

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

export async function parseFrenchQuery(query: string): Promise<ParsedFilters> {
  const sanitized = query.slice(0, 500).replace(/[<>]/g, "");

  const SYSTEM = `Tu es un assistant qui convertit des requêtes en langage naturel français en filtres JSON pour un screener de fonds d'investissement.

Retourne un objet JSON valide avec ces champs optionnels :
- sfdr: tableau de numéros SFDR ex: [8,9]
- sri_min, sri_max: indicateur risque 1-7
- ter_max: frais max en % ex: 1.5
- perf_1y_min, perf_3y_min: performance min en % ex: 10.0
- vol_max: volatilité max en %
- sharpe_min: ratio Sharpe min
- aum_min: encours min en M€ ex: 100
- track_record_min: ancienneté min en années
- envelopes: tableau parmi ["PEA","PER","AV-LUX"]
- universe: tableau de types ex: ["etf","opcvm","scpi"]
- currency: tableau ex: ["EUR","USD"]
- morningstar_min: note min 1-5
- manager_search: nom du gestionnaire
- chips: tableau de labels lisibles courts en français pour afficher dans l'UI comme chips (ex: ["ETF monde", "PEA éligible", "Article 8"])

Exemples :
- "ETF monde éligibles PEA article 8" → {"sfdr":[8],"envelopes":["PEA"],"universe":["etf"],"chips":["ETF monde","PEA éligible","Article 8"]}
- "fonds peu risqués ESG" → {"sfdr":[8,9],"sri_max":3,"chips":["ESG","Risque faible"]}
- "actions US performantes" → {"universe":["opcvm"],"chips":["Actions US","Performant"]}

Retourne UNIQUEMENT l'objet JSON. Pas d'explication.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: sanitized }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    return JSON.parse(json) as ParsedFilters;
  } catch {
    return {};
  }
}

// Re-export ParsedFilters pour compatibilité
export type { ParsedFilters };
