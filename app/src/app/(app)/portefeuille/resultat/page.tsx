import { StudioResults } from "@/components/portfolio/StudioResults";

export const metadata = { title: "Portefeuille — résultat · Charlie" };

// Page entièrement dédiée au portefeuille généré : toutes les métriques
// (répartition, projets, projection, Markowitz interactif, corrélations,
// back-test, rapport détaillé, exports). L'état provient du contexte monté dans
// le layout /portefeuille ; en accès direct sans portefeuille généré, la vue
// redirige vers /portefeuille (réglages).
export default function PortefeuilleResultatPage() {
  return <StudioResults />;
}
