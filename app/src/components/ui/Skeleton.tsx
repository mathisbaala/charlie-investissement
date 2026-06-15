/**
 * Barre de chargement (skeleton). L'animation pulse est neutralisée
 * automatiquement sous prefers-reduced-motion (garde globale dans globals.css).
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-paper-2 ${className}`}
      aria-hidden="true"
    />
  );
}
