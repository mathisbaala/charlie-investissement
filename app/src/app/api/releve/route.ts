import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  csvToText, extractDocumentTotal, extractPositions, looksLikeFeeDocument, rowsToText,
  type ExtractedPosition,
  type ReleveApiPosition as RelevePosition, type ReleveContractMatch as ContractMatch,
} from "@/lib/releve";
import { extractPositionsAi, scrubDocumentText, type ReleveAiUsage } from "@/lib/releveAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Analyse d'un relevé de situation PDF (onglet « Analyse de l'existant ») :
//   1. extraction du texte (pdfjs, reconstruction des lignes par ordonnée Y —
//      les invariants ISIN+montants vivent sur une même ligne visuelle) ;
//   2. extraction des positions : l'IA (GLM 5.2, lib/releveAi) lit le texte
//      ANONYMISÉ en lecteur principal — chaque assureur ayant son template, le
//      déterministe (lib/releve) échoue sur les mises en page exotiques ; il
//      reste le repli (pas de clé, erreur IA) et complète l'IA (union des ISIN
//      qu'elle aurait manqués) ;
//   3. enrichissement catalogue (nom, TER, SRI) + RECONNAISSANCE DU CONTRAT :
//      les ISIN extraits sont confrontés au référencement UC↔contrat
//      (investissement_av_lux_eligibility) — le contrat dont l'univers couvre
//      le mieux le relevé est proposé en tête, avec son score de couverture.
// Le PDF n'est JAMAIS stocké (RGPD) : il est lu en mémoire puis oublié — seules
// les positions validées côté client ont une existence durable (URL/état local).

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_ISINS = 200;


/** Reconstruit des lignes de texte à partir des items pdfjs (tri Y puis X). */
async function pdfToLines(data: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  const lines: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Regroupe les items par ordonnée arrondie (tolérance 2pt) : une « ligne ».
      const rows = new Map<number, { x: number; str: string }[]>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round((item.transform?.[5] ?? 0) / 2) * 2;
        const x = item.transform?.[4] ?? 0;
        const row = rows.get(y) ?? [];
        row.push({ x, str: item.str });
        rows.set(y, row);
      }
      const ys = Array.from(rows.keys()).sort((a, b) => b - a); // haut → bas
      for (const y of ys) {
        const row = rows.get(y)!;
        row.sort((a, b) => a.x - b.x);
        lines.push(row.map((r) => r.str).join("  "));
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  return lines.join("\n");
}

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

export async function POST(req: NextRequest): Promise<NextResponse> {
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
  } catch {
    return NextResponse.json(
      {
        error: isPdf
          ? "PDF illisible (protégé ou scanné ? L'OCR n'est pas géré en V1)"
          : "Fichier illisible : formats acceptés PDF, Excel (xlsx/xls) ou CSV",
      },
      { status: 422 },
    );
  }

  // Déterministe d'abord (gratuit, instantané) : repli et complément de l'IA.
  const deterministic = extractPositions(text).slice(0, MAX_ISINS);
  let extracted: ExtractedPosition[] = deterministic;
  let documentTotal = extractDocumentTotal(text);
  let ai: (ReleveAiUsage & { model: string; positions: number }) | null = null;

  if (process.env.ZAI_API_KEY) {
    try {
      const aiRes = await extractPositionsAi(scrubDocumentText(text));
      if (aiRes.positions.length > 0) {
        // L'IA devient la source principale ; les ISIN qu'elle aurait manqués
        // mais que le déterministe a vus sont réinjectés (union, jamais moins
        // bien que l'existant).
        const seen = new Set(aiRes.positions.map((p) => p.isin));
        extracted = [
          ...aiRes.positions,
          ...deterministic.filter((p) => !seen.has(p.isin)),
        ].slice(0, MAX_ISINS);
        if (aiRes.documentTotal !== null) documentTotal = aiRes.documentTotal;
        ai = { ...aiRes.usage, model: aiRes.model, positions: aiRes.positions.length };
      }
    } catch (e) {
      // IA indisponible → le déterministe fait le travail, comme avant.
      console.error("[releve] lecture IA échouée (repli déterministe):", e);
    }
  }

  if (extracted.length === 0) {
    return NextResponse.json(
      { positions: [], matches: [], warning: "Aucun ISIN détecté — relevé scanné ou format inattendu ?" },
    );
  }
  const isins = extracted.map((p) => p.isin);

  // Enrichissement catalogue + candidats contrats, en parallèle.
  const [fundsRes, eligRes] = await Promise.all([
    supabase
      .from("investissement_funds")
      .select("isin, name, ter, sri, srri")
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

  // `ai` : télémétrie de lecture (modèle, tokens, coût) — null si repli
  // déterministe. Consommée pour le suivi de dépense, pas affichée au CGP.
  return NextResponse.json({ positions, matches, knownCount, warning, documentTotal, ai });
}
