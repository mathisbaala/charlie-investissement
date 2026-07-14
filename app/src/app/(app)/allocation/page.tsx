import { redirect } from "next/navigation";

// L'onglet Allocation a fusionné avec Portefeuille (un seul atelier). On conserve
// la route en redirection permanente pour les liens et signets existants.
export default function AllocationPage() {
  redirect("/portefeuille");
}
