"use client";

import React from "react";

// Pastille d'option (choix unique dans une rangée) — style canonique de l'app :
// terracotta pleine quand active, contour discret sinon. Source unique pour tous
// les sélecteurs (profil, horizon, objectif, moteur de pondération, durée…) afin
// que les mêmes choix aient le même bouton partout.
export function Chip({
  active,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      className={`shrink-0 whitespace-nowrap px-3.5 py-2 rounded-lg text-meta font-medium border transition-all ${
        active
          ? "bg-brown text-paper border-brown shadow-sm"
          : "bg-paper text-ink-2 border-line hover:border-brown/30 hover:text-ink"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
