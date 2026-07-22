import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Logo officiel Charlie (« C ») embarqué en data URI, partagé par tous les
// documents PDF (frais, fiche de fonds, proposition d'allocation). Lecture disque
// au rendu (routes Node), sans dépendance réseau ; mémoïsé entre requêtes.
// En cas d'échec, le document retombe sur son repli de marque (pastille / wordmark).

let logoCache: string | null | undefined;

export async function loadLogo(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const png = await readFile(join(process.cwd(), "public", "charlie-logo.png"));
    logoCache = `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}
