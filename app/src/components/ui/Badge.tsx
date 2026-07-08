import React from "react";

// SFDR Article badge
export function SfdrBadge({ article }: { article: number | null | undefined }) {
  if (!article) return <span className="text-muted font-mono text-meta">—</span>;
  const cfg: Record<number, { label: string; cls: string }> = {
    6: { label: "Art. 6", cls: "bg-paper-2 text-ink-2" },
    8: { label: "Art. 8", cls: "bg-ok-soft text-ok" },
    9: { label: "Art. 9", cls: "bg-ok-soft text-ok font-semibold" },
  };
  const c = cfg[article] ?? { label: `Art. ${article}`, cls: "bg-paper-2 text-ink-2" };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-meta font-medium ${c.cls}`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {c.label}
    </span>
  );
}

// SRI badge (1-7)
export function SriBadge({ sri }: { sri: number | null | undefined }) {
  if (!sri) return <span className="text-muted font-mono text-meta">—</span>;
  const isHigh = sri >= 5;
  const isMed  = sri >= 3;
  const cls = isHigh
    ? "bg-warn-soft text-warn"
    : isMed
    ? "bg-accent-soft text-accent-ink"
    : "bg-ok-soft text-ok";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-meta font-medium ${cls}`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {sri}/7
    </span>
  );
}

// Morningstar stars
export function MorningstarBadge({ rating }: { rating: number | null | undefined }) {
  if (!rating) return <span className="text-muted text-meta">—</span>;
  return (
    <span className="text-warn text-meta" title={`Morningstar ${rating}/5`}>
      {"★".repeat(rating)}{"☆".repeat(5 - rating)}
    </span>
  );
}
