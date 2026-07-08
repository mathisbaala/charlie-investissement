// ─── Import d'un profil client depuis un fichier ─────────────────────────────
// Helpers partagés entre la page Profil client (/matching) et la zone de dépôt
// de la landing. Lecture du fichier (PDF base64 / Excel / texte)
// puis appel à /api/parse-profile qui en extrait un profil structuré via LLM.

import { type RichClientProfile } from "./clientProfile";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file, "UTF-8");
  });
}

async function readExcelAsText(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(sheet);
}

/**
 * Transforme un fichier en corps de requête pour /api/parse-profile selon son
 * extension (PDF → document base64, Excel → CSV texte, sinon texte brut).
 */
export async function fileToParseBody(file: File): Promise<Record<string, string>> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") {
    return { file_base64: await readAsBase64(file), file_type: "application/pdf" };
  }
  if (ext === "xlsx" || ext === "xls") {
    return { text: await readExcelAsText(file) };
  }
  return { text: await readAsText(file) };
}

/**
 * Lit un fichier et renvoie le profil extrait par /api/parse-profile.
 * `res` est exposé pour permettre à l'appelant de gérer un éventuel 429
 * (quota IA) via handledRateLimit. `extracted` est null si la réponse n'est
 * pas OK (l'appelant peut alors laisser l'utilisateur saisir manuellement).
 */
export async function parseProfileFromFile(
  file: File,
): Promise<{ res: Response; extracted: Partial<RichClientProfile> | null }> {
  const body = await fileToParseBody(file);
  const res = await fetch("/api/parse-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const extracted = res.ok ? ((await res.json()) as Partial<RichClientProfile>) : null;
  return { res, extracted };
}
