"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, Search, FileText, LayoutGrid, Shield, TrendingUp } from "@/components/ui/icons";

const NAV = [
  { href: "/accueil",     icon: LayoutGrid, label: "Accueil" },
  { href: "/recherche",   icon: Search,     label: "Recherche" },
  { href: "/portefeuille", icon: TrendingUp, label: "Portefeuille" },
  { href: "/assureurs",   icon: Shield,     label: "Assurances vie" },
  { href: "/documents",   icon: FileText,   label: "Documents" },
];

export function Rail() {
  const pathname = usePathname();

  return (
    <aside className="fixed top-0 left-0 bottom-0 z-50 w-[60px] flex flex-col items-center py-3 border-r border-line bg-paper">
      {/* Logo top */}
      <Link href="/accueil" className="mb-4 mt-0.5">
        <Logo size={26} />
      </Link>

      {/* Nav items */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== "/accueil" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center justify-center w-11 h-11 rounded-[9px] transition-colors group ${
                active
                  ? "bg-brown text-paper"
                  : "text-muted hover:bg-accent-soft hover:text-accent-ink"
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2 : 1.7} />
              {/* Tooltip */}
              <span className="pointer-events-none absolute left-[52px] top-1/2 -translate-y-1/2 bg-ink text-paper text-label font-medium px-2 py-1 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
