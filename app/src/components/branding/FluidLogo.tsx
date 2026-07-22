"use client";

// ─── Logo du cabinet en fond de la page d'accueil ─────────────────────────────
//
// Simple filigrane statique : un vrai <img>, donc net (un SVG reste net à toute
// taille). Aucun effet au survol (retiré à la demande). Taille modeste, posé un
// peu plus bas que le centre.

interface FluidLogoProps {
  /** Source du logo (data URL du cabinet, ou logo Charlie par défaut). */
  src: string;
  /** Opacité du logo en fond (0-1). */
  opacity?: number;
  className?: string;
}

export function FluidLogo({ src, opacity = 0.95, className }: FluidLogoProps) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        top: "60%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(22%, 174px)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          objectFit: "contain",
          opacity,
        }}
      />
    </div>
  );
}
