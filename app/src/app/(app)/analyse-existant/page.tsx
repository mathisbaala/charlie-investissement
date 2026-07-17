import { AnalyseExistant } from "@/components/existant/AnalyseExistant";

export const metadata = { title: "Analyse de l'existant · Charlie" };

// Onglet « Analyse de l'existant » (docs/analyse-existant-spec.md) : import des
// relevés de situation PDF du client → extraction des positions + reconnaissance
// des contrats via le référencement → synthèse consolidée multi-contrats →
// recommandations ciblées (corrélation, concentration, frais) — sans refaire
// le portefeuille.
export default function AnalyseExistantPage() {
  return <AnalyseExistant />;
}
