export const meta = {
  name: 'av-fonds-euros-refresh-2025',
  description: 'Rafraîchit les taux fonds euros 2025 des contrats AV (1 agent/assureur, lecture seule, propositions sourcées)',
  phases: [{ title: 'Recherche', detail: '1 agent par assureur — table de taux officielle 2025' }],
}

const PROJECT_ID = 'dehigtgzizsdehyhmjxn'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['company', 'source_officiel', 'contrats', 'notes'],
  properties: {
    company: { type: 'string' },
    official_source_url: { type: 'string', description: "URL de la publication officielle de taux de l'assureur (ou vide)" },
    source_officiel: { type: 'boolean', description: 'true si taux issus d\'une publication officielle de l\'assureur' },
    bulk: {
      type: ['object', 'null'],
      additionalProperties: false,
      description: "Valeur par défaut du fonds euros GÉNÉRAL de l'assureur, à appliquer à tous ses contrats qui partagent ce fonds. null si les contrats ont des fonds euros distincts.",
      required: ['fe_nom', 'taux_2025', 'annee'],
      properties: {
        fe_nom: { type: ['string', 'null'] },
        taux_2025: { type: ['number', 'null'] },
        annee: { type: ['integer', 'null'] },
        frais_fe: { type: ['number', 'null'] },
      },
    },
    contrats: {
      type: 'array',
      description: 'Détail par contrat quand le fonds euros/taux diffère du bulk, ou pour préciser. Peut être vide si bulk couvre tout.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'taux', 'annee', 'confidence'],
        properties: {
          key: { type: 'string' },
          contract: { type: 'string' },
          fe_nom: { type: ['string', 'null'] },
          taux: { type: ['number', 'null'], description: 'taux net servi le plus récent trouvé' },
          annee: { type: ['integer', 'null'] },
          frais_fe: { type: ['number', 'null'] },
          source_url: { type: ['string', 'null'] },
          officiel: { type: 'boolean' },
          confidence: { type: 'string', enum: ['sourcé', 'indicative'] },
          changement: { type: ['string', 'null'], description: 'écart vs valeur en base' },
          qa_alert: { type: ['string', 'null'], description: 'anomalie (contrat introuvable au catalogue officiel, libellé douteux, etc.)' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

function prompt(company, n, bulkHint) {
  return `Tu es analyste data en assurance-vie française. Mission : rafraîchir/corriger les données du FONDS EN EUROS des contrats de l'assureur « ${company} », à partir de la publication OFFICIELLE de taux 2025 de cet assureur (les « taux de participation aux bénéfices 2025 » / « rendement du fonds euros 2025 », publiés entre janvier et mars 2026).

ÉTAPE 1 — Récupère la liste des contrats à traiter. Charge d'abord l'outil SQL : appelle ToolSearch avec la query exacte "select:mcp__claude_ai_Supabase__execute_sql", puis exécute cette requête (project_id = "${PROJECT_ID}") :
  SELECT key, contract, fonds_euros_nom, fonds_euros_taux_pct, fonds_euros_annee, frais_gestion_fonds_euros_pct
  FROM investissement_av_contract_terms
  WHERE company = '${company.replace(/'/g, "''")}'
    AND (fonds_euros_annee < 2025 OR fonds_euros_annee IS NULL)
    AND (fonds_euros_taux_pct IS NOT NULL OR fonds_euros_nom IS NOT NULL OR lower(coalesce(garantie_fonds_euros,'')) IN ('true','oui','1','yes'))
  ORDER BY contract;
C'est une lecture seule (SELECT). Si tu n'arrives pas à joindre la base, continue quand même en recherchant le taux du fonds euros GÉNÉRAL de l'assureur (fallback bulk). Il y a environ ${n} contrat(s) attendu(s).

ÉTAPE 2 — Trouve la publication OFFICIELLE des taux 2025 de ${company} (site de l'assureur, communiqué, DIC du fonds général). Utilise WebSearch + WebFetch. Les agrégateurs (francetransactions, moneyvox, finance-heros, goodvalueformoney…) sont acceptables en APPOINT mais marque-les officiel=false.

ÉTAPE 3 — Pour chaque contrat, détermine le taux NET 2025 de SON fonds euros :
- Convention : taux NET de frais de gestion, BRUT de prélèvements sociaux/fiscaux (le taux « servi » communiqué).
- Beaucoup de contrats d'un même assureur partagent UN fonds euros général → même taux. Dans ce cas remplis le bloc "bulk" (fonds général : nom, taux 2025, année, frais de gestion du fonds euros) et laisse "contrats" vide ou minimal.
- Si des contrats ont des fonds euros DISTINCTS (dynamiques/nouvelle génération/immobiliers, taux différents), détaille-les dans "contrats".
- ATTENTION : le taux dépend souvent des frais de gestion du fonds euros propres au contrat (ex. un fonds à 2,30% de frais rend moins qu'à 2,00%). Ne plaque pas un taux headline sur un contrat qui porte des frais différents.

RÈGLES STRICTES :
- N'INVENTE JAMAIS un taux. Si introuvable pour un contrat, mets taux=null et explique dans notes/qa_alert.
- Chaque taux doit avoir une source (URL). confidence="sourcé" seulement si le taux vient d'une publication officielle de l'assureur ; sinon "indicative".
- Signale toute ANOMALIE QA : contrat qui n'existe dans aucun catalogue officiel, libellé non canonique, doublon, fonds euros fermé/liquidé.
${bulkHint ? '- CAS ' + company + ' : ces contrats partagent quasi tous le même fonds euros général (« La Mondiale »). Ne liste PAS les ~241 contrats un par un — trouve le(s) taux 2025 du/des fonds euros général(aux) La Mondiale et renvoie-les dans "bulk" (+ éventuelles variantes distinctes dans "contrats"). ' : ''}
Renvoie STRICTEMENT l'objet structuré demandé.`
}

phase('Recherche')

const companies = typeof args === 'string' ? JSON.parse(args) : args

const results = await parallel(
  companies.map((c) => () =>
    agent(prompt(c.company, c.n, c.bulk_hint), {
      label: `FE:${c.company}`,
      phase: 'Recherche',
      schema: SCHEMA,
    }).catch(() => null)
  )
)

const ok = results.filter(Boolean)
const totalContrats = ok.reduce((s, r) => s + (r.contrats ? r.contrats.length : 0), 0)
const withBulk = ok.filter((r) => r.bulk && r.bulk.taux_2025 != null).length
const alerts = ok.flatMap((r) => (r.contrats || []).filter((x) => x.qa_alert).map((x) => ({ company: r.company, key: x.key, qa_alert: x.qa_alert })))

log(`${ok.length}/${companies.length} assureurs traités — ${withBulk} avec taux général, ${totalContrats} contrats détaillés, ${alerts.length} alertes QA`)

return { assureurs: ok, resume: { traites: ok.length, sur: companies.length, avec_bulk: withBulk, contrats_detailles: totalContrats }, alertes_qa: alerts }
