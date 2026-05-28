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
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-soft text-accent-ink border border-accent/20 whitespace-nowrap ${className}`}
    >
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-accent/20 transition-colors"
          aria-label={`Supprimer ${label}`}
        >
          <X size={9} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}
