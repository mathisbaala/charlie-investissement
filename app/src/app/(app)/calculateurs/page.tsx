import { redirect } from "next/navigation";

// Onglet « Calculateurs » (Thomas) mis de côté temporairement : masqué du rail
// ET inaccessible par URL directe côté client. Pour réactiver, restaurer le
// rendu de <CalculateursClient /> ci-dessous (voir historique git) et
// décommenter l'entrée dans Rail.tsx.
export default function CalculateursPage() {
  redirect("/accueil");
}
