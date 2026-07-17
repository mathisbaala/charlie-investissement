import { PortfolioStudioProvider } from "@/components/portfolio/PortfolioStudioContext";

// Le contexte de l'atelier est monté ici, au niveau du layout partagé par
// /portefeuille/construire (réglages) et /portefeuille/construire/resultat
// (portefeuille dédié). App Router conserve le layout monté lors de la
// navigation entre ces deux pages : l'état du portefeuille généré survit donc
// au passage de l'une à l'autre. Le carrefour /portefeuille et l'analyse de
// l'existant /portefeuille/analyser n'ont pas besoin de ce contexte.
export default function ConstruireLayout({ children }: { children: React.ReactNode }) {
  return <PortfolioStudioProvider>{children}</PortfolioStudioProvider>;
}
