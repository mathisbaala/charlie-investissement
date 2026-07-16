import { Suspense } from "react";
import { FeeSimulator } from "@/components/simulator/FeeSimulator";

export const metadata = { title: "Simulateur de frais · Charlie" };

// Simulateur de frais & de gains d'une assurance vie : frais du contrat + frais
// des UC (entrée / gestion / sortie), perf 5 ans réelle des UC, rétrocessions
// CGP, projections 5/10/15 ans, courbe des frais cumulés. Préremplissable
// depuis un portefeuille via ?isins=&weights=&montant= (d'où le Suspense :
// useSearchParams l'exige au prérendu).
export default function SimulateurPage() {
  return (
    <Suspense>
      <FeeSimulator />
    </Suspense>
  );
}
