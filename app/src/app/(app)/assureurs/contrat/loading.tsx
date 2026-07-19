import { PageShell } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

// Frontière Suspense : la navigation ouvre la fiche contrat immédiatement avec ce
// squelette pendant que le server component résout ses lectures Supabase (aperçu +
// profil assureur + historique fonds euros). Sans lui, Next.js bloque l'ouverture
// jusqu'au rendu complet — d'où la sensation de gel au clic sur un contrat.
export default function Loading() {
  return (
    <PageShell className="space-y-5">
      <Skeleton className="h-3 w-32" />

      <Card className="px-5 py-5 md:px-7 md:py-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-[52px] w-[52px] rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-8 w-64 mt-2" />
            <Skeleton className="h-4 w-52 mt-3" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="px-4 py-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16 mt-3" />
          </Card>
        ))}
      </div>

      <div>
        <Skeleton className="h-6 w-48 mb-4" />
        <Card className="px-5 py-5">
          <Skeleton className="h-4 w-full max-w-[50ch]" />
          <Skeleton className="h-4 w-full max-w-[40ch] mt-3" />
        </Card>
      </div>
    </PageShell>
  );
}
