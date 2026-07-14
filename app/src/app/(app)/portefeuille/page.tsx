import { StudioInputs } from "@/components/portfolio/StudioInputs";

export const metadata = { title: "Portefeuille · Charlie" };

// Atelier Portefeuille — page 1 : profil client + réglages du conseiller.
// « Générer le portefeuille » calcule l'allocation optimisée puis redirige vers
// /portefeuille/resultat, la page entièrement dédiée au portefeuille et à ses
// métriques (max-Sharpe / HRP / Markowitz interactif, back-test, exports).
export default function PortefeuillePage() {
  return <StudioInputs />;
}
