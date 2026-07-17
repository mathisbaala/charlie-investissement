import { redirect } from "next/navigation";

// L'onglet « Analyse de l'existant » a fusionné dans Portefeuille (chemin
// « analyser »). On conserve la route en redirection pour les liens et signets
// existants.
export default function AnalyseExistantPage() {
  redirect("/portefeuille/analyser");
}
