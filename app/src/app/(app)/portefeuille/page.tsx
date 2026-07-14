import { AllocationStudio } from "@/components/portfolio/AllocationStudio";

export const metadata = { title: "Portefeuille · Charlie" };

// Atelier Portefeuille : profil client → allocation optimisée (max-Sharpe / HRP /
// Markowitz interactif) → back-test historique vs indice → proposition PDF /
// PowerPoint. Fusionne l'ancien onglet Allocation et l'ancien back-test
// Portefeuille en un seul parcours, du profil à la proposition d'investissement.
export default function PortefeuillePage() {
  return <AllocationStudio />;
}
