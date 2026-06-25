import { PortfolioBuilder } from "@/components/portfolio/PortfolioBuilder";

export const metadata = { title: "Portefeuille · Charlie" };

// Tout l'état du portefeuille vient de l'URL (lien partageable, sans compte).
export default async function PortefeuillePage({
  searchParams,
}: {
  searchParams: Promise<{ isins?: string; weights?: string; benchmark?: string; years?: string }>;
}) {
  const sp = await searchParams;
  return (
    <PortfolioBuilder
      initialIsins={sp.isins ?? ""}
      initialWeights={sp.weights ?? ""}
      initialBenchmark={sp.benchmark ?? ""}
      initialYears={sp.years ?? ""}
    />
  );
}
