import { PortfolioStudioProvider } from "@/components/portfolio/PortfolioStudioContext";

// Le contexte de l'atelier est monté ici, au niveau du layout partagé par
// /portefeuille (réglages) et /portefeuille/resultat (portefeuille dédié). App
// Router conserve le layout monté lors de la navigation entre ces deux pages :
// l'état du portefeuille généré survit donc au passage de l'une à l'autre.
export default function PortefeuilleLayout({ children }: { children: React.ReactNode }) {
  return <PortfolioStudioProvider>{children}</PortfolioStudioProvider>;
}
