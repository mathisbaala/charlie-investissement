import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/Page";
import { TrendingUp, FileSearch, ArrowRight } from "@/components/ui/icons";

export const metadata = { title: "Portefeuille · Charlie" };

// Carrefour de l'onglet Portefeuille : deux chemins pour travailler le
// portefeuille d'un client — le CONSTRUIRE de A à Z (profil + réglages →
// allocation optimisée) ou ANALYSER l'existant (import des relevés →
// diagnostic). Les deux parcours partagent les mêmes moteurs analytiques.
const PATHS = [
  {
    href: "/portefeuille/construire",
    icon: TrendingUp,
    title: "Créer un portefeuille",
    desc: "Construire une allocation optimisée à partir du profil client et d'un contrat : max-Sharpe ou HRP, back-test historique, proposition d'investissement (PDF / PowerPoint).",
    cta: "Partir du profil client",
  },
  {
    href: "/portefeuille/analyser",
    icon: FileSearch,
    title: "Analyser un portefeuille existant",
    desc: "Importer les relevés de situation du client (PDF, CSV, Excel) pour diagnostiquer l'existant : consolidation multi-contrats, corrélation, concentration, frais, recommandations ciblées.",
    cta: "Importer les relevés du client",
  },
];

export default function PortefeuillePage() {
  return (
    <PageShell className="space-y-6">
      <div className="max-w-[640px]">
        <h1 className="text-title text-ink font-semibold">Portefeuille</h1>
        <p className="mt-1.5 text-body text-muted">
          Deux chemins selon le besoin du client : construire un nouveau
          portefeuille de A à Z, ou analyser un portefeuille qu&apos;il détient déjà.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PATHS.map(({ href, icon: Icon, title, desc, cta }) => (
          <Link key={href} href={href} className="group block focus:outline-none">
            <Card className="h-full px-5 py-5 flex flex-col transition-colors group-hover:border-clay group-focus-visible:border-clay">
              <span className="flex items-center justify-center w-11 h-11 rounded-[10px] bg-accent-soft text-accent-ink transition-colors group-hover:bg-brown group-hover:text-paper">
                <Icon size={22} strokeWidth={1.9} />
              </span>
              <h2 className="mt-4 text-body-lg text-ink font-semibold">{title}</h2>
              <p className="mt-1.5 text-meta text-muted leading-relaxed flex-1">{desc}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-meta font-medium text-ink-2 group-hover:text-clay transition-colors">
                {cta}
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
