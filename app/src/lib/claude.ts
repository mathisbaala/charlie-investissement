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
- sri_min, sri_max: indicateur risque PRIIPs 1-7
- ter_max: frais courants max en % ex: 1.5
- perf_1y_min, perf_3y_min: performance annualisée min en % ex: 10.0
- vol_max: volatilité 1 an max en %
- sharpe_min: ratio Sharpe 1 an min
- aum_min: encours min en M€ ex: 100
- track_record_min: ancienneté min en années
- envelopes: tableau parmi ["PEA","PEA-PME","PER","AV-FR","AV-LUX","CTO"]
  (PEA=Plan Épargne en Actions, PEA-PME=PEA dédié PME, PER=Plan Épargne Retraite,
   AV-FR=Assurance-Vie France, AV-LUX=Assurance-Vie Luxembourg, CTO=Compte-Titres)
- universe: tableau de types ex: ["etf","opcvm","scpi","fonds_euros","fps"]
- sector: tableau parmi ["Technologie","Santé","Finance","Consommation","Industrie","Énergie","Immobilier","Environnement","Communication","Matériaux"]
- management_style: tableau parmi ["passif","actif","smart_beta","alternatif"]
- currency: tableau ex: ["EUR","USD"]
- morningstar_min: note Morningstar min 1-5
- retrocession_min: rétrocession CGP min en % ex: 0.5
- manager_search: nom du gestionnaire (ex: "Amundi", "BlackRock", "Carmignac")
- has_kid: true si l'utilisateur veut uniquement des fonds avec DICI disponible
- free_text: recherche libre dans le nom du fonds (pour les noms de fonds spécifiques)
- chips: tableau de labels lisibles courts en français pour afficher dans l'UI (ex: ["ETF monde", "PEA éligible", "Article 8"])

Règles de mapping :
- "ESG" ou "durable" → sfdr:[8,9]
- "article 9" ou "impact" → sfdr:[9]
- "peu risqué" / "défensif" → sri_max:3
- "modéré" / "équilibré" → sri_min:2, sri_max:5
- "dynamique" / "risqué" → sri_min:4
- "low cost" / "peu de frais" → ter_max:0.5
- "assurance-vie" (sans précision) → envelopes:["AV-FR","AV-LUX"]
- "retraite" → envelopes:["PER"]
- "bien noté" / "5 étoiles" → morningstar_min:4
- "rétrocession" / "rétro CGP" → retrocession_min:0.3
- "bonne rétrocession" / "rétrocession élevée" → retrocession_min:0.5
- "ancienneté" / "historique long" → track_record_min:5
- "volatilité faible" / "peu volatile" → vol_max:8
- "gros fonds" / "encours élevés" → aum_min:500
- "tech" / "technologie" / "numérique" → sector:["Technologie"]
- "santé" / "pharma" / "médical" / "biotech" → sector:["Santé"]
- "finance" / "banque" / "assurance" → sector:["Finance"]
- "énergie" / "pétrole" / "gaz" / "renouvelable" → sector:["Énergie"]
- "immobilier" / "REIT" / "foncier" → sector:["Immobilier"]
- "environnement" / "eau" / "climat" → sector:["Environnement"]
- "industrie" → sector:["Industrie"]
- "gestion passive" / "index" / "réplication" → management_style:["passif"]
- "gestion active" / "stock-picking" → management_style:["actif"]
- "smart beta" / "factoriel" → management_style:["smart_beta"]
- "hedge fund" / "long-short" / "alternatif" → management_style:["alternatif"]
- "avec DICI" / "DICI disponible" / "document réglementaire" → has_kid:true
- "sans frais d'entrée" / "no load" / "frais d'entrée zéro" → chips:["Sans frais d'entrée"] (pas de filtre direct, mentionner dans chips)

Exemples :
- "ETF monde éligibles PEA article 8" → {"sfdr":[8],"envelopes":["PEA"],"universe":["etf"],"chips":["ETF monde","PEA éligible","Article 8"]}
- "fonds avec DICI disponible" → {"has_kid":true,"chips":["DICI disponible"]}
- "fonds peu risqués ESG" → {"sfdr":[8,9],"sri_max":3,"chips":["ESG","Risque faible"]}
- "OPCVM actions US performants éligibles CTO" → {"universe":["opcvm"],"envelopes":["CTO"],"chips":["Actions US","CTO éligible"]}
- "fonds retraite PER Amundi" → {"envelopes":["PER"],"manager_search":"Amundi","chips":["PER","Amundi"]}
- "ETF low cost monde" → {"universe":["etf"],"ter_max":0.3,"chips":["ETF monde","Low cost"]}
- "OPCVM avec bonne rétrocession CGP éligibles AV" → {"universe":["opcvm"],"envelopes":["AV-FR","AV-LUX"],"retrocession_min":0.5,"chips":["Rétrocession ≥0.5%","Assurance-vie"]}
- "fonds actions peu volatils 5 étoiles" → {"universe":["opcvm","etf"],"vol_max":10,"morningstar_min":4,"chips":["Actions","Faible volatilité","5 étoiles"]}
- "fonds technologie innovants" → {"sector":["Technologie"],"chips":["Technologie"]}
- "ETF santé pharma article 9" → {"universe":["etf"],"sector":["Santé"],"sfdr":[9],"chips":["ETF","Santé","Article 9"]}
- "fonds énergie renouvelable ESG" → {"sector":["Énergie"],"sfdr":[8,9],"chips":["Énergie","ESG"]}

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
