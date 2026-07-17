"use client";

import { useState } from "react";
import { insurerLogoSrc, insurerInitials } from "@/lib/insurer-logos";

// Avatar de marque pour un assureur/distributeur.
// - Vrai logo si disponible (/public/insurers), encadré dans une pastille pour
//   homogénéiser des visuels hétérogènes (transparents, carrés colorés…).
// - Sinon (ou si l'image échoue), monogramme stylé — jamais de trou visuel.

export function InsurerLogo({
  company,
  size = 40,
  className = "",
}: {
  company: string;
  size?: number;
  className?: string;
}) {
  const src = insurerLogoSrc(company);
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size } as const;

  if (src && !failed) {
    return (
      <span
        className={`shrink-0 inline-flex items-center justify-center rounded-lg bg-paper border border-line overflow-hidden ${className}`}
        style={box}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={company}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: Math.max(2, Math.round(size * 0.14)),
          }}
        />
      </span>
    );
  }

  return (
    <span
      aria-label={company}
      title={company}
      className={`shrink-0 inline-flex items-center justify-center rounded-lg bg-accent-soft border border-accent/15 text-accent-ink font-semibold leading-none ${className}`}
      style={{ ...box, fontSize: Math.round(size * 0.38) }}
    >
      {insurerInitials(company)}
    </span>
  );
}
