"use client";

import React from "react";

type BtnVariant = "primary" | "ghost" | "outline" | "accent-soft";
type BtnSize    = "sm" | "md" | "lg";

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
  as?: "button" | "a";
  href?: string;
}

const variants: Record<BtnVariant, string> = {
  primary:      "bg-ink text-paper hover:bg-ink-strong border-transparent",
  ghost:        "bg-transparent text-ink-2 hover:bg-paper-2 border-transparent",
  outline:      "bg-paper text-ink border-line hover:bg-paper-2",
  "accent-soft":"bg-accent-soft text-accent-ink border-accent/20 hover:bg-accent/20",
};

const sizes: Record<BtnSize, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5 rounded-md",
  md: "px-4 py-2 text-xs gap-2 rounded-lg",
  lg: "px-5 py-2.5 text-sm gap-2 rounded-lg",
};

export function Btn({
  variant = "outline",
  size = "md",
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: BtnProps) {
  const base =
    "inline-flex items-center justify-center font-medium border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none";
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : null}
      {children}
    </button>
  );
}
