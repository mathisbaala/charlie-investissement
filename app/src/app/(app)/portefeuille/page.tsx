import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/Page";
import { TrendingUp, FileSearch, ArrowRight } from "@/components/ui/icons";

export const metadata = { title: "Portefeuille · Charlie" };

// Carrefour de l'onglet Portefeuille : deux chemins symétriques — créer un
// portefeuille (profil client → allocation) ou analyser un portefeuille
// existant (relevés client → diagnostic). Titre porté par la Topbar, pas de
// texte décoratif : deux cartes, deux points de départ.
const PATHS = [
  {
    href: "/portefeuille/construire",
    icon: TrendingUp,
    title: "Créer un portefeuille",
    cta: "Commencer avec le profil client",
  },
  {
    href: "/portefeuille/analyser",
    icon: FileSearch,
    title: "Analyser un portefeuille",
    cta: "Commencer avec le portefeuille client",
  },
];

export default function PortefeuillePage() {
  return (
    <PageShell>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PATHS.map(({ href, icon: Icon, title, cta }) => (
          <Link key={href} href={href} className="group block focus:outline-none">
            <Card className="h-full px-5 py-5 flex flex-col transition-colors group-hover:border-clay group-focus-visible:border-clay">
              <span className="flex items-center justify-center w-11 h-11 rounded-[10px] bg-accent-soft text-accent-ink transition-colors group-hover:bg-brown group-hover:text-paper">
                <Icon size={22} strokeWidth={1.9} />
              </span>
              <h2 className="mt-4 text-body-lg text-ink font-semibold">{title}</h2>
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
