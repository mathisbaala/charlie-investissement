import React from "react";

/**
 * Surface de carte standard de Charlie : fond paper, contour line, radius xl.
 * Le padding et les classes additionnelles passent par `className`.
 * Pour une surface élevée (modal, drawer flottant), ne pas utiliser Card —
 * garder rounded-2xl + shadow propres au tier « élevé ».
 */
export function Card({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bg-paper rounded-xl border border-line ${className}`} {...props}>
      {children}
    </div>
  );
}
