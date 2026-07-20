import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { aiRateLimit, botGuard, dataRateLimit, AI_COST } from "@/lib/rateLimit";
import { EXTRACTION_MODEL } from "@/lib/claude";
import { pdfToLines } from "@/lib/pdfText";
import {
  csvToText, extractDocumentTotal, extractPositions, looksLikeFeeDocument, reconcileTotal, rowsToText,
  mergePositions, sanitizeAiPositions, type ExtractedPosition,
  type ReleveApiPosition as RelevePosition, type ReleveContractMatch as ContractMatch,
} from "@/lib/releve";
import { retroFallbackFrac } from "@/lib/remuneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Analyse d'un relevé de situation PDF (onglet « Analyse de l'existant ») :
//   1. extraction du texte (pdfjs, reconstruction des lignes par ordonnée Y —
//      les invariants ISIN+montants vivent sur une même ligne visuelle) ;
//   2. extraction des positions (lib/releve, pur) ;
//   3. enrichissement catalogue (nom, TER, SRI) + RECONNAISSANCE DU CONTRAT :
//      les ISIN extraits sont confrontés au référencement UC↔contrat
//      (investissement_av_lux_eligibility) — le contrat dont l'univers couvre
//      le mieux le relevé est proposé en tête, avec son score de couverture.
// Le PDF n'est JAMAIS stocké (RGPD) : il est lu en mémoire puis oublié — seules
// les positions validées côté client ont une existence durable (URL/état local).

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_ISINS = 200;
// Plafond de taille SPÉCIFIQUE à la lecture IA : le coût Vision croît avec le
// nombre de pages. Un relevé fait 2-10 pages (< ~2 Mo) ; au-delà on ne double
// PAS la lecture par l'IA (regex seule) — borne dure de dépense par appel.
// Réglable par env sans redéploiement de code.
const AI_MAX_BYTES = Number(process.env.RELEVE_AI_MAX_BYTES ?? 8_000_000);


/** Classeur Excel → texte lignes (toutes les feuilles, cellules brutes). */
async function workbookToLines(data: Uint8Array): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      raw: true,
      defval: "",
    }) as unknown[][];
    parts.push(rowsToText(rows));
  }
  return parts.join("\n");
}

/** CSV → texte lignes, avec repli d'encodage : les extranets français exportent
 *  souvent en windows-1252 (accents cassés en UTF-8 strict). */
function decodeCsv(data: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(data);
  const raw = utf8.includes("�")
    ? new TextDecoder("windows-1252").decode(data)
    : utf8;
  return csvToText(raw);
}

// Lecture IA d'un relevé (Claude Vision). Le modèle comprend la STRUCTURE que la
// regex ignore : la bonne colonne (valorisation, pas la VL ni les parts), les
// lignes éclatées sur plusieurs cellules, et surtout les PDF SCANNÉS (image) où
// la regex ne voit aucun texte. Sa sortie est ensuite validée par la clé Luhn
// (sanitizeAiPositions) puis fusionnée avec la regex.
const RELEVE_SYSTEM = `Tu es un expert en lecture de relevés de situation d'assurance-vie, de comptes-titres et de contrats de capitalisation français. On te fournit un relevé (parfois scanné). Extrais CHAQUE ligne de support/fonds détenu.

Retourne UNIQUEMENT un objet JSON valide :
{
  "positions": [ { "isin": string, "label": string|null, "amount": number|null } ],
  "total": number|null
}

Règles STRICTES :
- Une position = une ligne portant un code ISIN valide (2 lettres pays + 10 caractères, ex: FR0010959676, LU1234567890, IE00B4L5Y983).
- "amount" = la VALORISATION en euros de la ligne (ce que vaut la position aujourd'hui). JAMAIS le nombre de parts, JAMAIS la valeur liquidative unitaire, JAMAIS un pourcentage (perf/frais), JAMAIS le versement initial. En cas de plusieurs colonnes chiffrées, prends la valeur/valorisation ACTUELLE.
- Convertis les montants français en nombre JS : "12 345,67 €" -> 12345.67 (point décimal, sans espace ni symbole monétaire).
- N'invente JAMAIS d'ISIN. Si tu n'es pas certain d'un code, OMETS la ligne plutôt que de deviner (mieux vaut la manquer qu'inventer un faux code).
- Ignore les supports sans ISIN (fonds en euros parfois sans code) : ils seront ajoutés à la main.
- "total" = la valorisation totale du contrat imprimée sur le relevé (null si absente). Pas un total de frais, de versements ou de plus-values.
- N'extrais QUE les lignes de support : ignore l'état civil, l'adresse, les numéros de contrat/adhérent.
- Réponds en JSON pur, sans markdown, sans commentaire.`;

/** Extraction IA d'un PDF de relevé → positions validées + total. `null` si le
 *  service IA est indisponible (panne, clé, quota) : l'appelant retombe alors
 *  proprement sur la regex seule — jamais d'échec dur. */
async function extractPdfWithClaude(
  base64: string,
): Promise<{ positions: ExtractedPosition[]; total: number | null } | null> {
  try {
    const resp = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 4096,
      system: RELEVE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: "Extrais toutes les lignes de support de ce relevé et retourne le JSON." },
          ],
        },
      ],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim().match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json) as { positions?: unknown; total?: unknown };
    const total =
      typeof parsed.total === "number" && Number.isFinite(parsed.total) && parsed.total > 0
        ? parsed.total
        : null;
    return { positions: sanitizeAiPositions(parsed.positions), total };
  } catch (e) {
    console.error("[releve] extraction IA échouée (repli regex):", e);
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Anti-abus, EN AMONT de tout : un client non-navigateur (script d'aspiration)
  // est refusé avant la moindre lecture — a fortiori avant tout appel IA facturé.
  const bot = botGuard(req);
  if (bot) return bot;
  // Anti-burst : borne les rafales d'une même IP avant toute lecture/appel IA
  // (défense en profondeur, distincte du quota IA journalier).
  const burst = await dataRateLimit(req, 1);
  if (burst) return burst;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Requête multipart attendue" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier PDF requis (champ « file »)" }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF trop volumineux (15 Mo max)" }, { status: 413 });
  }

  // Ingestion multi-format : PDF, classeur Excel (xlsx/xls) ou CSV — détection
  // par SIGNATURE de fichier (l'extension ment parfois), même pipeline ensuite.
  const buf = new Uint8Array(await file.arrayBuffer());
  const sig4 = buf.length >= 4 ? String.fromCharCode(...buf.slice(0, 4)) : "";
  const isPdf = sig4 === "%PDF";
  const isZip = sig4.startsWith("PK");                          // xlsx = zip
  const isOle = buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf; // xls BIFF

  let text: string;
  try {
    if (isPdf) {
      text = await pdfToLines(buf);
    } else if (isZip || isOle) {
      text = await workbookToLines(buf);
    } else {
      text = decodeCsv(buf);
    }
  } catch (e) {
    // On loggue la cause réelle (le message générique côté client masquait, par
    // ex., un souci d'environnement pdfjs en serverless).
    console.error("[releve] extraction texte échouée:", e);
    return NextResponse.json(
      {
        error: isPdf
          ? "PDF illisible (protégé ou scanné ? L'OCR n'est pas géré en V1)"
          : "Fichier illisible : formats acceptés PDF, Excel (xlsx/xls) ou CSV",
      },
      { status: 422 },
    );
  }

  // Extraction déterministe (regex + clé Luhn) : gratuite, fiable sur les PDF
  // « texte » et les tableurs. Sert de base ET de filet de validation.
  const regexPositions = extractPositions(text).slice(0, MAX_ISINS);
  // Total de valorisation imprimé sur le document (contrôle de cohérence UI).
  let documentTotal = extractDocumentTotal(text);

  // Doubler la lecture par Claude Vision coûte cher (facturé à la page) et l'outil
  // est en libre-service (pas de compte, pas de paiement) : on ne l'appelle QUE
  // quand la regex — gratuite — ne peut pas PROUVER qu'elle a tout lu. Le juge de
  // paix est objectif : la réconciliation avec le total imprimé sur le relevé.
  //   • regex réconcilie au centime près (rec.status === "ok") → on a capté 100 %
  //     de la valeur du document : inutile de payer un 2ᵉ avis, on garde la regex ;
  //   • écart, ou pas de total exploitable, ou 0 ISIN (relevé scanné) → c'est
  //     EXACTEMENT là que l'IA apporte de la valeur → on escalade.
  // Ainsi la majorité des relevés « texte » bien formés ne consomment AUCUN appel
  // IA, sans dégrader la qualité sur les cas douteux. Repli silencieux sur la
  // regex seule si l'IA est indisponible/quota atteint — jamais d'échec dur.
  const regexSum = regexPositions.reduce((s, p) => s + (p.amount ?? 0), 0);
  const rec = reconcileTotal(regexSum, documentTotal);
  const regexIsComplete = rec !== null && rec.status === "ok";

  let extracted = regexPositions;
  if (isPdf && !regexIsComplete && buf.length <= AI_MAX_BYTES) {
    const limited = await aiRateLimit(req, AI_COST.releve);
    if (!limited) {
      const ai = await extractPdfWithClaude(Buffer.from(buf).toString("base64"));
      if (ai) {
        // L'IA fait autorité sur le montant (comprend les colonnes), la regex
        // complète (montants manquants, ISIN qu'elle seule a vus). Union par ISIN.
        extracted = mergePositions(ai.positions, regexPositions).slice(0, MAX_ISINS);
        if (documentTotal === null) documentTotal = ai.total;
      }
    }
  }

  if (extracted.length === 0) {
    return NextResponse.json(
      { positions: [], matches: [], warning: "Aucun ISIN détecté — relevé scanné illisible ou format inattendu ?" },
    );
  }
  const isins = extracted.map((p) => p.isin);

  // Enrichissement catalogue + candidats contrats, en parallèle.
  const [fundsRes, eligRes] = await Promise.all([
    supabase
      .from("investissement_funds")
      .select("isin, name, ter, sri, srri, ongoing_charges, retrocession_cgp, product_type, management_style")
      .in("isin", isins),
    supabase
      .from("investissement_av_lux_eligibility")
      .select("isin, company_name, contract_name")
      .in("isin", isins)
      .limit(20000),
  ]);
  if (fundsRes.error) {
    return NextResponse.json({ error: fundsRes.error.message }, { status: 500 });
  }

  const funds = new Map(
    (fundsRes.data ?? []).map((f) => [
      f.isin,
      {
        name: (f.name as string | null) ?? null,
        // TER stocké en fraction (0.018) → % pour l'affichage/diagnostic.
        ter: f.ter !== null && f.ter !== undefined ? Math.round(Number(f.ter) * 10000) / 100 : null,
        sri: (f.sri ?? f.srri ?? null) as number | null,
        // Repli de rétrocession (FRACTION/an) pour le calcul de rémunération
        // cabinet : valeur sourcée en base sinon estimation de place. Les frais
        // en base sont en fraction (pas de conversion, contrairement au TER %).
        retro: retroFallbackFrac(
          f.retrocession_cgp as number | null,
          (f.ongoing_charges ?? f.ter) as number | null,
          f.product_type as string | null,
          f.management_style as string | null,
        ),
      },
    ]),
  );

  const positions: RelevePosition[] = extracted.map((p) => {
    const f = funds.get(p.isin);
    return {
      ...p,
      // Anonymisation : dès que le fonds est au catalogue, son nom OFFICIEL
      // remplace le libellé extrait du relevé (déjà nettoyé par scrubLabel) —
      // le texte du document ne sert plus à rien et n'est pas renvoyé.
      label: f ? "" : p.label,
      known: Boolean(f),
      name: f?.name ?? null,
      ter: f?.ter ?? null,
      sri: f?.sri ?? null,
      retro: f?.retro ?? null,
    };
  });

  // Score par contrat : nb d'ISIN CONNUS du relevé présents dans son univers.
  const knownCount = positions.filter((p) => p.known).length;
  const perContract = new Map<string, { company: string; contract: string; set: Set<string> }>();
  for (const row of eligRes.data ?? []) {
    const key = `${row.company_name}::${row.contract_name}`;
    const entry = perContract.get(key) ?? {
      company: row.company_name as string,
      contract: row.contract_name as string,
      set: new Set<string>(),
    };
    entry.set.add(row.isin as string);
    perContract.set(key, entry);
  }
  const matches: ContractMatch[] = Array.from(perContract.values())
    .map((e) => ({
      company: e.company,
      contract: e.contract,
      matched: e.set.size,
      coverage: knownCount > 0 ? e.set.size / knownCount : 0,
    }))
    .sort((a, b) => b.coverage - a.coverage || b.matched - a.matched)
    .slice(0, 8);

  // Mauvais type de document : des supports mais aucun montant, c'est une
  // annexe de frais/performances, pas un relevé de situation.
  const warning = looksLikeFeeDocument(extracted)
    ? "Aucun montant détecté : ce document ressemble à une annexe de frais ou de performances. " +
      "Déposez le relevé de situation (celui qui valorise chaque support), ou saisissez les montants à la main."
    : undefined;

  return NextResponse.json({ positions, matches, knownCount, warning, documentTotal });
}
