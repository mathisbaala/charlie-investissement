// Extraction de texte d'un PDF, partagée par les routes qui lisent des documents
// financiers (relevés de situation, DICI/KID). Reconstruit les LIGNES visuelles à
// partir des items pdfjs (tri par ordonnée Y décroissante puis abscisse X) : les
// invariants qu'on cherche (ISIN + montants, « Frais courants » + %) vivent sur
// une même ligne visuelle, que le flux brut d'items pdfjs éclate sinon.
//
// Server-only : `pdfjs-dist/legacy` s'appuie sur des API Node — n'importer que
// depuis des routes `runtime = "nodejs"`, jamais depuis du code client.

// pdfjs-dist v6 legacy charge @napi-rs/canvas par un require() DYNAMIQUE (pour
// fournir DOMMatrix/Path2D, sans quoi getTextContent throw en serverless). Ce
// require dynamique est invisible au traceur de fichiers de Vercel → le paquet
// n'était pas copié dans la lambda (« Cannot find module '@napi-rs/canvas' »).
// Cet import statique, sans effet à l'usage, rend la dépendance VISIBLE au
// traceur pour qu'il embarque @napi-rs/canvas + son binaire natif de plateforme.
import "@napi-rs/canvas";

/** Reconstruit des lignes de texte à partir des items pdfjs (tri Y puis X). */
export async function pdfToLines(data: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs TRANSFÈRE (neuter) l'ArrayBuffer de `data` vers son worker : au retour,
  // le buffer de l'APPELANT est détaché (byteLength 0). La route relevé réutilise
  // ces octets juste après (base64 → Claude Vision) ; sans copie, elle envoyait
  // un PDF vide à l'IA (« PDF cannot be empty », 400, escalade Vision perdue sur
  // les relevés scannés/éclatés). On passe une COPIE pour préserver l'appelant.
  const loadingTask = pdfjs.getDocument({ data: data.slice() });
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
