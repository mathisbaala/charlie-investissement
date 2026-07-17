import { AnalyseExistant } from "@/components/existant/AnalyseExistant";

export const metadata = { title: "Analyser un portefeuille · Charlie" };

// Portefeuille — chemin « analyser » (docs/analyse-existant-spec.md) : import
// des relevés de situation PDF du client → extraction des positions +
// reconnaissance des contrats via le référencement → synthèse consolidée
// multi-contrats → recommandations ciblées (corrélation, concentration, frais)
// — sans refaire le portefeuille. Chemin jumeau de /portefeuille/construire.
export default function AnalyserPage() {
  return <AnalyseExistant />;
}
