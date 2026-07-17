import { redirect } from "next/navigation";

// L'onglet Allocation a fusionné avec Portefeuille (un seul atelier). On conserve
// la route en redirection permanente pour les liens et signets existants, vers
// le chemin « construire » (l'intention historique de l'allocation).
export default function AllocationPage() {
  redirect("/portefeuille/construire");
}
