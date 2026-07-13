import { PageShell } from "@/components/ui/Page";
import { CabinetForm } from "@/components/cabinet/CabinetForm";

export const metadata = { title: "Mon cabinet · Charlie" };

// Onglet Cabinet : partenariats assureurs, contrats distribués et conventions
// de rétrocession du CGP — saisis une fois, réutilisés par l'allocation
// (sélecteur de contrat, rémunération estimée sur les vrais taux).
export default function CabinetPage() {
  return (
    <PageShell className="space-y-6">
      <div>
        <h1 className="text-heading text-ink font-semibold">Mon cabinet</h1>
        <p className="text-meta text-muted">
          Vos partenariats assureurs, vos contrats et vos conventions de rétrocession —
          renseignés une fois, réutilisés par toute la plateforme (allocation, rapports).
        </p>
      </div>
      <CabinetForm />
    </PageShell>
  );
}
