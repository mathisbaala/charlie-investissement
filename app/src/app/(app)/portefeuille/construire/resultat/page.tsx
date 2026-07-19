import { StudioResults } from "@/components/portfolio/StudioResults";

// Page entièrement dédiée au portefeuille généré : toutes les métriques
// (répartition, projets, projection, Markowitz interactif, corrélations,
// back-test, rapport détaillé, exports). L'état provient du contexte monté dans
// le layout /portefeuille/construire ; en accès direct sans portefeuille
// généré, la vue redirige vers /portefeuille/construire (réglages).
export default function ConstruireResultatPage() {
  return <StudioResults />;
}
