"use client";

import { useEffect } from "react";
import Link from "next/link";

// Error boundary du segment applicatif : un crash dans une page (fetch qui
// échoue, donnée inattendue) affiche cette page de récupération au lieu d'un
// écran blanc. L'utilisateur peut réessayer sans recharger toute l'app.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] erreur non gérée:", error);
  }, [error]);

  return (
    <div className="h-full flex items-center justify-center bg-cream px-6">
      <div className="max-w-md text-center">
        <p
          className="text-display text-ink mb-3"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Une erreur est survenue.
        </p>
        <p className="text-body text-muted mb-6">
          Quelque chose s'est mal passé en chargeant cette page. Tu peux
          réessayer.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-accent text-paper text-body font-medium hover:bg-accent/90 transition-colors"
          >
            Réessayer
          </button>
          <Link
            href="/accueil"
            className="px-4 py-2 rounded-lg border border-line text-ink-2 text-body font-medium hover:bg-paper-2 transition-colors"
          >
            Retour à l'accueil
          </Link>
        </div>
        {error.digest && (
          <p className="mt-6 text-caption text-muted-2" style={{ fontFamily: "var(--font-mono)" }}>
            ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
