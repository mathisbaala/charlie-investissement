"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo, FileText, LayoutGrid, Shield, TrendingUp, UserCircle, Calculator } from "@/components/ui/icons";
import { loadStoredCabinet } from "@/lib/cabinet";

// La recherche n'a pas d'onglet dédié : c'est le prolongement de l'accueil, qu'on
// atteint en lançant une requête / un profil client (ou en partant d'un assureur).
// L'icône Accueil reste donc active sur /recherche. Cela allège le rail.
// Portefeuille fusionne l'ancienne allocation : profil client → allocation
// optimisée + back-test + proposition (un seul atelier, un seul onglet).
const NAV = [
  { href: "/accueil",      icon: LayoutGrid, label: "Accueil" },
  { href: "/assureurs",    icon: Shield,     label: "Partenaires" },
  { href: "/portefeuille", icon: TrendingUp, label: "Portefeuille" },
  { href: "/simulateur",   icon: Calculator, label: "Simulateur de frais" },
  { href: "/documents",    icon: FileText,   label: "Documents" },
];

// Mon cabinet vit en pied de rail, comme un réglage (paramétrage du cabinet :
// nom + assureurs partenaires), à l'écart des onglets de travail. Icône de
// profil, distincte des onglets, pour signaler « votre espace / réglages ».
const CABINET = { href: "/cabinet", icon: UserCircle, label: "Mon cabinet" };

// La recherche est une continuation de l'accueil → l'onglet Accueil reste allumé.
const ACCUEIL_PATHS = ["/accueil", "/recherche"];

function RailItem({
  href,
  icon: Icon,
  label,
  active,
  emphasis = false,
  dot = false,
}: {
  href: string;
  icon: typeof LayoutGrid;
  label: string;
  active: boolean;
  /** Repos teinté (au lieu de gris) : réservé à Mon cabinet, sinon il se perd en pied de rail. */
  emphasis?: boolean;
  /** Pastille « à configurer » (cabinet encore vide). */
  dot?: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center justify-center w-11 h-11 rounded-[9px] transition-colors group ${
        active
          ? "bg-brown text-paper"
          : emphasis
            ? "bg-accent-soft text-accent-ink hover:bg-brown hover:text-paper"
            : "text-muted hover:bg-accent-soft hover:text-accent-ink"
      }`}
    >
      <Icon size={18} strokeWidth={active || emphasis ? 2 : 1.7} />
      {dot && !active && (
        <span
          aria-hidden
          className="absolute top-1 right-1 w-2 h-2 rounded-full bg-brown ring-2 ring-paper"
        />
      )}
      {/* Tooltip */}
      <span className="pointer-events-none absolute left-[52px] top-1/2 -translate-y-1/2 bg-ink text-paper text-label font-medium px-2 py-1 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {label}
      </span>
    </Link>
  );
}

export function Rail() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/accueil"
      ? ACCUEIL_PATHS.includes(pathname)
      : pathname === href || pathname.startsWith(`${href}/`);

  // Pastille « à configurer » sur Mon cabinet tant qu'aucun assureur partenaire
  // n'est renseigné. Relu à chaque navigation (true par défaut côté serveur
  // pour ne pas afficher la pastille pendant l'hydratation).
  const [cabinetConfigured, setCabinetConfigured] = useState(true);
  useEffect(() => {
    setCabinetConfigured(loadStoredCabinet().insurers.length > 0);
  }, [pathname]);

  return (
    <aside className="fixed top-0 left-0 bottom-0 z-50 w-[60px] flex flex-col items-center py-3 border-r border-line bg-paper">
      {/* Logo top */}
      <Link href="/accueil" className="mb-4 mt-0.5">
        <Logo size={26} />
      </Link>

      {/* Onglets de travail */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map((item) => (
          <RailItem key={item.href} {...item} active={isActive(item.href)} />
        ))}
      </nav>

      {/* Réglages du cabinet, ancrés en pied de rail — mis en avant (fond teinté
          + pastille tant que rien n'est configuré) : l'œil s'arrête en haut du
          rail, sans accent cette entrée passait inaperçue. */}
      <div className="mt-2 pt-2 border-t border-line">
        <RailItem
          {...CABINET}
          active={isActive(CABINET.href)}
          emphasis
          dot={!cabinetConfigured}
        />
      </div>
    </aside>
  );
}
