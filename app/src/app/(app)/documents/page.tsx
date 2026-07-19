import { redirect } from "next/navigation";

// L'onglet « Documents » (lecteur de DICI) a fusionné dans Portefeuille →
// Analyser (mode « support unique »). On conserve la route en redirection pour
// les liens et signets existants.
export default function DocumentsPage() {
  redirect("/portefeuille/analyser?mode=support");
}
