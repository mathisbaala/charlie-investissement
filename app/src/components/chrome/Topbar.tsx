"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, ChevronRight } from "@/components/ui/icons";

function breadcrumb(pathname: string): { label: string; href: string }[] {
  const map: Record<string, string> = {
    "/accueil":    "Accueil",
    "/recherche":  "Recherche",
    "/favoris":    "Favoris",
    "/documents":  "Documents",
  };
  if (pathname.startsWith("/fonds/")) {
    return [
      { label: "Recherche", href: "/recherche" },
      { label: "Fiche fonds", href: pathname },
    ];
  }
  const label = map[pathname];
  if (!label) return [];
  return [{ label, href: pathname }];
}

interface TopbarProps {
  onChatToggle: () => void;
  chatOpen: boolean;
}

export function Topbar({ onChatToggle, chatOpen }: TopbarProps) {
  const pathname = usePathname();
  const crumbs = breadcrumb(pathname);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center gap-4 px-5 border-b border-line bg-paper"
      style={{ marginLeft: "60px" }}
    >
      {/* Brand */}
      <Link href="/accueil" className="flex items-center gap-2.5 shrink-0">
        <Logo size={26} />
        <span
          className="text-ink text-[19px] leading-none"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          Charlie
        </span>
      </Link>

      {/* Breadcrumb */}
      {crumbs.length > 0 && (
        <nav className="flex items-center gap-1 text-muted" aria-label="breadcrumb">
          <ChevronRight size={12} strokeWidth={1.8} />
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} strokeWidth={1.8} />}
              <Link
                href={c.href}
                className="text-[12px] font-medium text-muted hover:text-ink-2 transition-colors"
              >
                {c.label}
              </Link>
            </span>
          ))}
        </nav>
      )}

      <div className="flex-1" />

      {/* Chat trigger */}
      <button
        onClick={onChatToggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors text-[15px] cursor-pointer ${
          chatOpen ? "bg-accent-soft text-accent-ink" : "bg-brown text-paper hover:bg-brown-2"
        }`}
        style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        aria-label="Ouvrir Charlie"
      >
        C
      </button>
    </header>
  );
}
