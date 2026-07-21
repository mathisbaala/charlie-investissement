"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  X, ArrowLeft, ArrowRight, Check,
  LayoutGrid, TrendingUp, Shield, Logo, UserCircle, Calculator,
} from "@/components/ui/icons";
import { TOUR_STEPS, isTourDone, markTourDone, type TourStep } from "@/lib/tour";

// Icône par étape — gardée hors du module de données (lib/tour) pour que
// celui-ci reste pur et testable. Une icône par pilier, alignée sur le rail.
function StepIcon({ stepKey, size = 20 }: { stepKey: TourStep["key"]; size?: number }) {
  switch (stepKey) {
    case "accueil":   return <LayoutGrid size={size} strokeWidth={1.7} />;
    case "partenaires": return <Shield size={size} strokeWidth={1.7} />;
    case "portefeuille": return <TrendingUp size={size} strokeWidth={1.7} />;
    case "frais": return <Calculator size={size} strokeWidth={1.7} />;
    case "cabinet":   return <UserCircle size={size} strokeWidth={1.7} />;
    case "guide":     return <Logo size={size + 4} />;
  }
}

// Petite visite de bienvenue affichée à la première visite. Présente chaque
// onglet en une phrase, se ferme à tout moment et ne réapparaît plus ensuite.
export function WelcomeTour() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const pathname = usePathname();

  // Ouverture différée d'un cran pour laisser l'app peindre derrière le voile.
  // Pas d'onboarding « Accueil » quand on atterrit directement sur le
  // portefeuille (typiquement via un lien partagé) : le tour n'y a pas de sens.
  useEffect(() => {
    if (isTourDone()) return;
    if (pathname?.startsWith("/portefeuille")) return;
    const t = setTimeout(() => setOpen(true), 450);
    return () => clearTimeout(t);
  }, [pathname]);

  function finish() {
    markTourDone();
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, TOUR_STEPS.length - 1));
      else if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const step = TOUR_STEPS[i];
  const first = i === 0;
  const last = i === TOUR_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Visite guidée"
    >
      <div className="absolute inset-0 bg-ink/20" onClick={finish} />

      <div className="c-pop relative w-full max-w-[380px] bg-paper border border-line rounded-2xl shadow-xl p-6">
        <button
          onClick={finish}
          aria-label="Fermer la visite"
          className="absolute top-3 right-3 text-muted hover:text-ink transition-colors"
        >
          <X size={15} />
        </button>

        {/* Étape : numéro discret + icône de l'onglet */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 shrink-0 rounded-[11px] bg-accent-soft text-accent-ink flex items-center justify-center">
            <StepIcon stepKey={step.key} />
          </div>
          <span
            className="text-caption text-muted-2 tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {i + 1} / {TOUR_STEPS.length}
          </span>
        </div>

        {first && (
          <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-1.5">
            Bienvenue
          </p>
        )}

        <h2
          className="text-subhead font-semibold text-ink"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {step.title}
        </h2>

        <p className="text-meta text-muted mt-2 leading-relaxed">{step.body}</p>

        {/* Pastilles de progression, cliquables pour sauter à une étape */}
        <div className="flex items-center gap-1.5 mt-5" role="tablist" aria-label="Étapes">
          {TOUR_STEPS.map((s, idx) => (
            <button
              key={s.key}
              onClick={() => setI(idx)}
              aria-label={`Étape ${idx + 1} : ${s.title}`}
              aria-selected={idx === i}
              role="tab"
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? "w-5 bg-accent-ink" : "w-1.5 bg-line hover:bg-muted-2"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-5">
          {last ? (
            <span />
          ) : (
            <button
              onClick={finish}
              className="text-meta text-muted hover:text-ink transition-colors"
            >
              Passer
            </button>
          )}

          <div className="flex items-center gap-2">
            {!first && (
              <button
                onClick={() => setI((v) => Math.max(v - 1, 0))}
                className="flex items-center gap-1 text-meta font-medium text-ink-2 hover:text-ink px-3 py-2 rounded-lg hover:bg-paper-2 transition-colors"
              >
                <ArrowLeft size={14} /> Précédent
              </button>
            )}

            {last ? (
              <button
                onClick={finish}
                className="flex items-center gap-1.5 bg-ink text-paper rounded-lg px-4 py-2 text-meta font-medium hover:bg-ink-strong transition-colors active:translate-y-px"
              >
                <Check size={14} /> Terminer
              </button>
            ) : (
              <button
                onClick={() => setI((v) => Math.min(v + 1, TOUR_STEPS.length - 1))}
                className="flex items-center gap-1.5 bg-ink text-paper rounded-lg px-4 py-2 text-meta font-medium hover:bg-ink-strong transition-colors active:translate-y-px"
              >
                Suivant <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
