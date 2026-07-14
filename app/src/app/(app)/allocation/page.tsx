import { AllocationStudio } from "@/components/portfolio/AllocationStudio";

export const metadata = { title: "Allocation optimisée · Charlie" };

// Plateforme d'allocation : saisie du profil client → génération automatique de
// l'allocation optimisée + présentation. Branchée sur /api/portfolio/optimize
// (fonds réels du contrat, corrélations DB) ; repli sur un univers d'exemple
// seulement si la base n'est pas joignable (dev local sans secrets).
export default function AllocationPage() {
  return <AllocationStudio />;
}
