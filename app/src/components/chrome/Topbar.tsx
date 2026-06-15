"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkle, ChevronRight } from "@/components/ui/icons";


function breadcrumb(pathname: string): { label: string; href: string }[] {
  if (pathname.startsWith("/fonds/")) {
    return [
      { label: "Recherche", href: "/recherche" },
      { label: "Fiche fonds", href: pathname },
    ];
  }
  return [];
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
      {/* Brand — no logo mark here, just wordmark */}
      <Link href="/accueil" className="flex items-center gap-1.5 shrink-0">
        <span
          className="text-ink text-title leading-none"
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
                className="text-meta font-medium text-muted hover:text-ink-2 transition-colors"
              >
                {c.label}
              </Link>
            </span>
          ))}
        </nav>
      )}

      <div className="flex-1" />

      {/* Chat trigger — action explicite vers l'assistant Charlie */}
      <button
        onClick={onChatToggle}
        title="Demander à Charlie"
        className={`h-9 flex items-center gap-1.5 pl-2.5 pr-3 rounded-lg border transition-colors cursor-pointer ${
          chatOpen
            ? "border-accent/30 bg-accent-soft text-accent-ink"
            : "border-line bg-paper text-ink-2 hover:bg-paper-2"
        }`}
        aria-label="Demander à Charlie"
      >
        <Sparkle size={14} className="text-accent" />
        <span className="hidden sm:inline text-meta font-medium">Demander à Charlie</span>
      </button>
    </header>
  );
}
