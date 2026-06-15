import React from "react";

/**
 * État vide standard : icône optionnelle dans une pastille douce, message,
 * indice facultatif et action primaire facultative. Centré, prend la hauteur
 * dispo (flex-1) pour ne pas laisser une carte étirée paraître creuse.
 * Un état vide est une fonctionnalité : préférer toujours fournir une `action`
 * qui sort l'utilisateur du vide (rechercher, réinitialiser…).
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = "",
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
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
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
