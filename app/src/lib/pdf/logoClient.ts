// Logo Charlie côté navigateur : récupère /charlie-logo.png en data URI pour
// l'embarquer dans les exports générés dans le navigateur (PDF @react-pdf et
// deck PPTX). Mémoïsé ; en cas d'échec, retourne undefined (repli de marque).

let cache: string | null | undefined;

export async function getLogoDataUri(): Promise<string | undefined> {
  if (cache !== undefined) return cache ?? undefined;
  try {
    const res = await fetch("/charlie-logo.png");
    const blob = await res.blob();
    cache = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error("read error"));
      r.readAsDataURL(blob);
    });
  } catch {
    cache = null;
  }
  return cache ?? undefined;
}
