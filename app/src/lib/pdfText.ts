// Extraction de texte d'un PDF, partagée par les routes qui lisent des documents
// financiers (relevés de situation, DICI/KID). Reconstruit les LIGNES visuelles à
// partir des items pdfjs (tri par ordonnée Y décroissante puis abscisse X) : les
// invariants qu'on cherche (ISIN + montants, « Frais courants » + %) vivent sur
// une même ligne visuelle, que le flux brut d'items pdfjs éclate sinon.
//
// Server-only : `pdfjs-dist/legacy` s'appuie sur des API Node — n'importer que
// depuis des routes `runtime = "nodejs"`, jamais depuis du code client.

/** Reconstruit des lignes de texte à partir des items pdfjs (tri Y puis X). */
export async function pdfToLines(data: Uint8Array): Promise<string> {
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
