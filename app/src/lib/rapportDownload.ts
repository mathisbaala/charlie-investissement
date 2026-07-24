import { loadStoredBranding, logoToPng } from "@/lib/branding";

// Ouvre le rapport de fonds (fiche ou comparatif) dans un nouvel onglet, teinté à
// la marque du cabinet. Le logo (data URI PNG) est trop volumineux pour une query
// string : on passe donc par POST. L'onglet est réservé DANS le geste utilisateur
// (window.open synchrone) pour ne pas être bloqué par l'anti-popup, puis on y
// charge le PDF une fois rendu. Repli GET (couleurs Charlie) si quoi que ce soit
// échoue.
export async function openRapportPdf(isins: string[]): Promise<void> {
  const list = [...new Set(isins.filter(Boolean))].slice(0, 20);
  if (list.length === 0) return;

  const tab = window.open("", "_blank");
  const fallback = () => {
    const href = `/api/rapport/pdf?isins=${list.join(",")}`;
    if (tab) tab.location.href = href;
    else window.open(href, "_blank");
  };

  try {
    const brand = loadStoredBranding();
    const logo = brand.enabled && brand.logo ? await logoToPng(brand.logo) : null;
    const res = await fetch("/api/rapport/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isins: list,
        branding: { accent: brand.enabled ? brand.accent : null, logo },
      }),
    });
    if (!res.ok) return fallback();
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    fallback();
  }
}
