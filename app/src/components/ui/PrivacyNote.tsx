import React from "react";
import Link from "next/link";
import { Shield } from "@/components/ui/icons";

/**
 * Note RGPD discrète à placer sous une zone de dépôt / collecte de données.
 * Rassure l'utilisateur (CGP) sur le sort du fichier client déposé et renvoie
 * vers la politique de confidentialité complète. `text` décrit le traitement
 * spécifique à la zone (les fichiers ne sont pas conservés, etc.).
 */
export function PrivacyNote({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <p
      className={`flex items-start gap-1.5 text-caption text-muted leading-snug ${className}`}
    >
      <Shield size={12} strokeWidth={1.7} className="shrink-0 mt-0.5" />
      <span>
        {text}{" "}
        <Link
          href="/confidentialite"
          className="text-muted-2 underline underline-offset-2 hover:text-ink-2 transition-colors"
        >
          Politique de confidentialité
        </Link>
      </span>
    </p>
  );
}
