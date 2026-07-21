import { Suspense } from "react";
import { FeeSimulator } from "@/components/simulator/FeeSimulator";

// Onglet « Frais » — angle comptabilité / rémunération du cabinet : rétrocessions
// et commission d'entrée, cumulées et détaillées support par support, partage
// assureur / société de gestion / cabinet. Supports importés en autonomie
// (recherche, relevé, fiche/DICI) ou préremplis via ?isins=&weights=&montant=
// (d'où le Suspense : useSearchParams l'exige au prérendu).
export default function FraisPage() {
  return (
    <Suspense>
      <FeeSimulator />
    </Suspense>
  );
}
