import { PageShell } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

// Frontière Suspense : la navigation ouvre la page immédiatement avec ce
// squelette pendant que le server component résout ses lectures Supabase
// (comparaison + profil). Sans lui, Next.js bloque l'ouverture jusqu'au rendu
// complet — c'était la lenteur perçue au clic sur un assureur.
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
            <Skeleton className="h-4 w-full max-w-[60ch] mt-4" />
          </div>
        </div>
      </Card>

      <div>
        <Skeleton className="h-6 w-48 mb-4" />
        <Card className="px-0 py-0 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-4 border-b border-line-soft last:border-0">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </Card>
      </div>
    </PageShell>
  );
}
