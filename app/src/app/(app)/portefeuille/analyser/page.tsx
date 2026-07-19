import { Suspense } from "react";
import { AnalyseExistant } from "@/components/existant/AnalyseExistant";

export const metadata = { title: "Analyser un portefeuille · Charlie" };

// Portefeuille — chemin « analyser » (docs/analyse-existant-spec.md). Deux
// modes réunis (l'ex-onglet « Documents » y a fusionné) : un portefeuille
// complet (relevés de situation PDF → extraction des positions + reconnaissance
// des contrats → synthèse consolidée + recommandations) ou un support unique
// (DICI/KID → rapport de fonds). Chemin jumeau de /portefeuille/construire.
// Suspense : AnalyseExistant lit ?isins=&weights=&montant= (lien profond depuis
// le simulateur de frais) via useSearchParams, qui l'exige au prérendu.
export default function AnalyserPage() {
  return (
    <Suspense>
      <AnalyseExistant />
    </Suspense>
  );
}
