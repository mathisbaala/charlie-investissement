import React from "react";

/**
 * État vide standard : icône optionnelle dans une pastille douce, message,
 * et indice facultatif. Centré, prend la hauteur dispo (flex-1) pour ne pas
 * laisser une carte étirée paraître creuse.
 */
export function EmptyState({
  icon,
  title,
  hint,
  className = "",
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center text-center gap-2 py-6 ${className}`}
    >
      {icon && (
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-paper-2 text-muted-2">
          {icon}
        </div>
      )}
      <p className="text-meta text-muted">{title}</p>
      {hint && (
        <p className="text-caption text-muted-2 max-w-[24ch] leading-snug">{hint}</p>
      )}
    </div>
  );
}
