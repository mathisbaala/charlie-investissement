"use client";

import { usePathname } from "next/navigation";
import { X } from "@/components/ui/icons";
import { guideForPath } from "@/lib/pageGuide";

// Panneau « Charlie » : remplace l'ancien chatbot par une explication contextuelle
// de la page courante (ce qu'elle contient, comment l'exploiter pleinement). Le
// contenu suit la navigation via usePathname() ; la sélection vit dans lib/pageGuide.

interface GuidePanelProps {
  open: boolean;
  onClose: () => void;
}

export function GuidePanel({ open, onClose }: GuidePanelProps) {
  const pathname = usePathname();
  const guide = guideForPath(pathname ?? "/");

  if (!open) return null;

  return (
    <div
      className="c-pop fixed right-2 md:right-4 z-50 w-[360px] max-w-[calc(100vw-1rem)] bg-cream border border-line rounded-xl shadow-[0_12px_40px_oklch(0.22_0.012_60_/_0.18)] flex flex-col overflow-hidden"
      style={{ top: "62px", maxHeight: "min(78vh, 620px)" }}
      role="dialog"
      aria-label={`Guide de la page ${guide.title}`}
    >
      {/* Header — sans séparateur, aligné sur l'ancien panneau */}
      <div className="flex items-start justify-between px-5 pt-4 pb-2 shrink-0">
        <div>
          <span className="text-caption uppercase tracking-widest text-muted font-semibold">
            Charlie · Guide
          </span>
          <h2
            className="text-body-lg text-ink leading-tight mt-0.5"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {guide.title}
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer le guide"
          className="text-muted hover:text-ink transition-colors mt-0.5"
        >
          <X size={14} />
        </button>
      </div>

      {/* Contenu défilant */}
      <div className="flex-1 overflow-y-auto px-5 pb-5 pt-1 min-h-0">
        <p className="text-body text-ink-2 leading-relaxed">{guide.intro}</p>

        {guide.sections.map((section) => (
          <div key={section.heading} className="mt-5">
            <h3 className="text-caption uppercase tracking-widest text-muted font-semibold mb-2.5">
              {section.heading}
            </h3>
            <ul className="flex flex-col gap-2.5">
              {section.items.map((item, i) => (
                <li key={i} className="flex gap-2.5 text-body text-ink leading-relaxed">
                  <span
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
