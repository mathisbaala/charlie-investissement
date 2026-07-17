import { StudioInputs } from "@/components/portfolio/StudioInputs";

export const metadata = { title: "Créer un portefeuille · Charlie" };

// Atelier Portefeuille — chemin « construire » : profil client + réglages du
// conseiller. « Générer le portefeuille » calcule l'allocation optimisée puis
// redirige vers /portefeuille/construire/resultat, la page entièrement dédiée
// au portefeuille et à ses métriques (max-Sharpe / HRP / Markowitz interactif,
// back-test, exports).
export default function ConstruirePage() {
  return <StudioInputs />;
}
