import { PageShell } from "@/components/ui/Page";
import { CabinetForm } from "@/components/cabinet/CabinetForm";

export const metadata = { title: "Mon cabinet · Charlie" };

// Onglet Cabinet : partenariats assureurs, contrats distribués et conventions
// de rétrocession du CGP — saisis une fois, réutilisés par l'allocation
// (sélecteur de contrat, rémunération estimée sur les vrais taux).
export default function CabinetPage() {
  return (
    <PageShell className="space-y-6">
      <CabinetForm />
    </PageShell>
  );
}
