import { AllocationStudio } from "@/components/portfolio/AllocationStudio";

export const metadata = { title: "Allocation optimisée · Charlie" };

// Plateforme d'allocation : saisie du profil client → génération automatique de
// l'allocation optimisée + présentation. Version démo (univers d'exemple) ;
// branchable sur /api/portfolio/optimize pour les fonds réels d'un contrat.
export default function AllocationPage() {
  return <AllocationStudio />;
}
