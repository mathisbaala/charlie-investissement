"use client";

import { X } from "@/components/ui/icons";

interface TagProps {
  label: string;
  onRemove?: () => void;
  className?: string;
}

export function Tag({ label, onRemove, className = "" }: TagProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-meta font-medium bg-accent-soft text-accent-ink border border-accent/20 whitespace-nowrap ${className}`}
    >
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          // Cible tactile élargie sur mobile (le × visuel reste petit) : 20px au
          // doigt au lieu de 14px, le -mr compense pour ne pas gonfler la puce.
          className="flex items-center justify-center w-5 h-5 -mr-1 md:w-3.5 md:h-3.5 md:mr-0 rounded-full hover:bg-accent/20 transition-colors"
          aria-label={`Supprimer ${label}`}
        >
          <X size={9} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}
