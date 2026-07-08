"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "@/components/ui/icons";
import { RATE_LIMIT_EVENT } from "@/lib/rateLimitClient";

// Petit modal discret affiché quand les crédits IA du jour (ou de l'heure) sont
// épuisés. Sobre, concis, sans fioriture.
export function RateLimitDialog() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"day" | "hour">("day");

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail ?? {};
      setScope(detail.scope === "hour" ? "hour" : "day");
      setOpen(true);
    }
    window.addEventListener(RATE_LIMIT_EVENT, handler);
    return () => window.removeEventListener(RATE_LIMIT_EVENT, handler);
  }, []);

  if (!open) return null;

  const day = scope === "day";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/20" onClick={() => setOpen(false)} />

      <div className="c-pop relative w-full max-w-[320px] bg-paper border border-line rounded-2xl shadow-xl p-6 text-center">
        <button
          onClick={() => setOpen(false)}
          aria-label="Fermer"
          className="absolute top-3 right-3 text-muted hover:text-ink transition-colors"
        >
          <X size={15} />
        </button>

        <div className="mx-auto w-11 h-11 rounded-full bg-accent-soft flex items-center justify-center mb-3.5">
          <RefreshCw size={19} className="text-accent-ink" />
        </div>

        <h2 className="text-subhead font-semibold text-ink" style={{ fontFamily: "var(--font-sans)" }}>
          {day ? "Crédits du jour épuisés" : "Petite pause"}
        </h2>

        <p className="text-meta text-muted mt-2 leading-relaxed">
          {day
            ? "Vous avez utilisé vos crédits de découverte. Ils se réinitialisent sous 24 h, revenez demain pour continuer."
            : "Vous avez beaucoup exploré. Réessayez dans une heure."}
        </p>

        <button
          onClick={() => setOpen(false)}
          className="mt-5 w-full bg-ink text-paper rounded-lg py-2 text-meta font-medium hover:bg-ink-strong transition-colors active:translate-y-px"
        >
          Compris
        </button>
      </div>
    </div>
  );
}
