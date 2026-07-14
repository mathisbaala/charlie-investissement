import { FeeSimulator } from "@/components/simulator/FeeSimulator";

export const metadata = { title: "Simulateur de frais · Charlie" };

// Simulateur de frais & de gains d'une assurance vie : frais du contrat + frais
// des UC (entrée / gestion / sortie), perf 5 ans réelle des UC, projections
// 5/10/15 ans, courbe des frais cumulés.
export default function SimulateurPage() {
  return <FeeSimulator />;
}
