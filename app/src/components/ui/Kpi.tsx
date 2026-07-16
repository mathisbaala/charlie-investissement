import React from "react";

/**
 * Tuile KPI standard (bandeau de résultats) : libellé en petites capitales,
 * valeur en gros, teinte ok/bad optionnelle. Partagée entre le portefeuille
 * et le simulateur de frais — une seule source, pas une copie par page.
 */
export function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" | null }) {
  return (
    <div className="md:flex-1 rounded-xl border border-line bg-paper px-3 py-3 md:px-5 md:py-4 text-center min-w-0">
      <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-1.5 truncate">{label}</p>
      <p
        className={`text-title md:text-title-lg leading-none ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-danger" : "text-ink"}`}
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {value}
      </p>
    </div>
  );
}
