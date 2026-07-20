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
  maxWidth = "1040px",
}: {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}) {
  return (
    <div className="h-full overflow-y-auto bg-cream px-4 sm:px-8 py-10">
      <div className={`mx-auto ${className}`} style={{ maxWidth }}>{children}</div>
    </div>
  );
}

/**
 * En-tête de page standard. Le TITRE de page vit désormais dans la Topbar (à la
 * place du wordmark) et n'est plus rendu dans le contenu — la page ne porte que
 * son contenu. On conserve ici l'éventuel `backlink` (lien retour discret) et
 * `action` (bouton aligné à droite). Si ni l'un ni l'autre, rien n'est rendu.
 */
export function PageHeader({
  action,
  backlink,
  className = "",
}: {
  action?: React.ReactNode;
  backlink?: React.ReactNode;
  className?: string;
}) {
  if (!action && !backlink) return null;
  return (
    <div className={`mb-6 ${className}`}>
      {backlink && <div className="mb-2">{backlink}</div>}
      {action && <div className="flex justify-end">{action}</div>}
    </div>
  );
}
