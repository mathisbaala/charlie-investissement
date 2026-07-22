"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, ChevronRight } from "@/components/ui/icons";
import { useBrand } from "@/components/BrandProvider";


function breadcrumb(pathname: string): { label: string; href: string }[] {
  if (pathname.startsWith("/fonds/")) {
    return [
      { label: "Recherche", href: "/recherche" },
      { label: "Fiche fonds", href: pathname },
    ];
  }
  if (pathname.startsWith("/partenaires/contrat")) {
    return [
      { label: "Partenaires", href: "/partenaires" },
      { label: "Fiche contrat", href: pathname },
    ];
  }
  return [];
}

// Le titre de chaque onglet vit dans la Topbar (à la place du wordmark), plus
// dans le contenu de la page. Accueil et fiche fonds gardent le wordmark « Charlie ».
const TAB_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/recherche", title: "Recherche" },
  { prefix: "/portefeuille", title: "Portefeuille" },
  { prefix: "/frais", title: "Frais" },
  { prefix: "/partenaires", title: "Partenaires" },
  { prefix: "/cabinet", title: "Mon cabinet" },
];

function pageTitle(pathname: string): string {
  const hit = TAB_TITLES.find(
    (t) => pathname === t.prefix || pathname.startsWith(t.prefix + "/"),
  );
  return hit ? hit.title : "Charlie";
}

interface TopbarProps {
  onGuideToggle: () => void;
  guideOpen: boolean;
}

export function Topbar({ onGuideToggle, guideOpen }: TopbarProps) {
  const pathname = usePathname();
  const crumbs = breadcrumb(pathname);
  const title = pageTitle(pathname);
  const isBrand = title === "Charlie";
  // Marque du cabinet (si le CGP a personnalisé le screener avec l'URL de son site).
  const { logo: clientLogo, name: clientName } = useBrand();

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center gap-4 px-5 border-b border-line bg-paper"
      style={{ marginLeft: "60px" }}
    >
      {/* Marque : logo et/ou nom du cabinet s'il est personnalisé, sinon le
         wordmark « Charlie ». Cliquable, ramène à l'accueil, et coexiste avec le
         titre de la page courante. */}
      {clientLogo || clientName ? (
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <Link href="/accueil" className="flex items-center gap-2 shrink-0 min-w-0">
            {clientLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clientLogo}
                alt="Logo du cabinet"
                className="h-7 w-auto max-w-[160px] object-contain"
              />
            )}
            {/* Le nom fait office de marque quand la page est « brand » (accueil,
               fiche) ; sur les pages à titre, le titre prend le relais. */}
            {isBrand && clientName && (
              <span
                className="text-ink text-title leading-none truncate"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {clientName}
              </span>
            )}
          </Link>
          {!isBrand && (
            <h1
              className="text-ink text-title leading-none shrink-0 truncate"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {title}
            </h1>
          )}
        </div>
      ) : isBrand ? (
        <Link href="/accueil" className="flex items-center gap-1.5 shrink-0">
          <span
            className="text-ink text-title leading-none"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Charlie
          </span>
        </Link>
      ) : (
        <h1
          className="text-ink text-title leading-none shrink-0"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {title}
        </h1>
      )}

      {/* Breadcrumb — masqué sous md : sur mobile il déborde et fait doublon
         avec le bouton « Retour à la recherche » de la page. */}
      {crumbs.length > 0 && (
        <nav className="hidden md:flex items-center gap-1 text-muted" aria-label="breadcrumb">
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

      {/* Lien légal discret — toujours accessible */}
      <Link
        href="/confidentialite"
        className="text-meta text-muted hover:text-ink-2 transition-colors shrink-0"
      >
        Confidentialité
      </Link>

      {/* Déclencheur du guide — logo mark. Explique la page courante. */}
      <button
        onClick={onGuideToggle}
        title="Comprendre cette page"
        className={`w-9 h-9 flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
          guideOpen
            ? "border-accent/30 bg-paper-2"
            : "border-line bg-paper hover:bg-paper-2"
        }`}
        aria-label="Comprendre cette page"
      >
        <Logo size={24} />
      </button>
    </header>
  );
}
