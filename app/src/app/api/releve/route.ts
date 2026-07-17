import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractPositions } from "@/lib/releve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

interface RelevePosition {
  isin: string;
  label: string;
  amount: number | null;
  /** Présent dans investissement_funds (analysable) ? */
  known: boolean;
  name: string | null;
  ter: number | null;
  sri: number | null;
}

interface ContractMatch {
  company: string;
  contract: string;
  /** Part des ISIN connus du relevé couverts par l'univers du contrat (0-1). */
  coverage: number;
  matched: number;
}

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

  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length < 4 || String.fromCharCode(...buf.slice(0, 4)) !== "%PDF") {
    return NextResponse.json({ error: "Le fichier n'est pas un PDF" }, { status: 415 });
  }

  let text: string;
  try {
    text = await pdfToLines(buf);
  } catch {
    return NextResponse.json(
      { error: "PDF illisible (protégé ou scanné ? L'OCR n'est pas géré en V1)" },
      { status: 422 },
    );
  }

  const extracted = extractPositions(text).slice(0, MAX_ISINS);
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

  return NextResponse.json({ positions, matches, knownCount });
}
