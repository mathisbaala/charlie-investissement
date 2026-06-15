import React from "react";

/**
 * Coquille de page standard — calquée sur l'accueil (la référence). Zone
 * scrollable sur fond crème, padding px-4/8 py-10, contenu centré à 1040px.
 * Toutes les pages « contenu » l'utilisent : même largeur, mêmes marges,
 * une seule source (pas une version par page).
 */
export function PageShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="h-full overflow-y-auto bg-cream px-4 sm:px-8 py-10">
      <div className={`max-w-[1040px] mx-auto ${className}`}>{children}</div>
    </div>
  );
}

/**
 * En-tête de page standard — même titre que l'accueil : serif italique 32px
 * (text-display-md), posé sur le fond, bloc mb-8. `action` se place à droite
 * (bouton), `backlink` au-dessus (lien retour discret).
 */
export function PageHeader({
  title,
  action,
  backlink,
  className = "",
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  backlink?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-8 ${className}`}>
      {backlink && <div className="mb-2">{backlink}</div>}
      <div className="flex items-start justify-between gap-4">
        <h1
          className="text-display-md text-ink italic"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {title}
        </h1>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
