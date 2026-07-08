"use client";

import { useEffect } from "react";

// Dernier filet de sécurité : capture une erreur survenue dans le layout racine
// lui-même (où error.tsx ne s'applique pas). global-error remplace le layout,
// donc on style en inline pour ne dépendre d'aucune feuille externe.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] erreur fatale:", error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#F5F3F0",
          color: "#1B1A18",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <p style={{ fontSize: "28px", margin: "0 0 0.75rem" }}>
            Une erreur inattendue est survenue.
          </p>
          <p style={{ fontSize: "14px", color: "#3B3A38", margin: "0 0 1.5rem" }}>
            Recharge la page pour continuer.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              backgroundColor: "#1B1A18",
              color: "#FCFCF9",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Recharger
          </button>
        </div>
      </body>
    </html>
  );
}
