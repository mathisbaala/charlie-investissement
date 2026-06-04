"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { ArrowRight, Upload } from "@/components/ui/icons";
import { Sparkle } from "@/components/ui/icons";

export default function LandingPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit() {
    if (!query.trim()) return;
    document.cookie = "charlie_seen=1; path=/; max-age=31536000";
    router.push(`/recherche?q=${encodeURIComponent(query.trim())}`);
  }

  function handleBrowse() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    document.cookie = "charlie_seen=1; path=/; max-age=31536000";
    router.push("/recherche");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-6"
      style={{ background: "oklch(0.968 0.022 76)" }}>

      {/* Radial bloom top-right */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: "-120px", right: "-120px",
          width: "520px", height: "520px",
          borderRadius: "50%",
          background: "radial-gradient(circle, oklch(0.90 0.07 48 / 0.45) 0%, transparent 70%)",
        }}
      />
      {/* Radial bloom bottom-left */}
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: "-80px", left: "-80px",
          width: "340px", height: "340px",
          borderRadius: "50%",
          background: "radial-gradient(circle, oklch(0.90 0.07 48 / 0.30) 0%, transparent 70%)",
        }}
      />

      {/* Top-right corner link */}
      <div className="absolute top-5 right-6">
        <a
          href="/accueil"
          className="text-[11px] text-muted hover:text-ink transition-colors"
        >
          Déjà CGP ? →
        </a>
      </div>

      {/* Center content */}
      <div className="relative w-full max-w-[680px] c-slide-up flex flex-col items-center text-center">

        {/* H1 */}
        <h1
          className="text-[58px] leading-[1.06] tracking-[-0.025em] text-ink mb-10"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Trouver{" "}
          <em className="not-italic" style={{ color: "oklch(0.62 0.13 45)" }}>
            le bon support
          </em>
          <br />
          en une phrase.
        </h1>

        {/* Search card */}
        <div className="w-full bg-paper rounded-2xl border border-line shadow-[0_4px_24px_oklch(0.22_0.012_60_/_0.07)] px-5 py-4 flex items-center gap-3">
          <TypingPrompt
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            className="flex-1 text-[15px]"
          />
          <button
            onClick={handleSubmit}
            className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-paper transition-colors"
            style={{ background: "oklch(0.53 0.135 45)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "oklch(0.48 0.135 45)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "oklch(0.53 0.135 45)")}
          >
            Chercher
            <ArrowRight size={14} />
          </button>
        </div>

        {/* Ou divider */}
        <div className="w-full flex items-center gap-4 my-5">
          <div className="flex-1 h-px bg-line-soft" />
          <span
            className="text-[17px] text-muted-2 leading-none"
            style={{ fontFamily: "var(--font-hand)" }}
          >
            ou
          </span>
          <div className="flex-1 h-px bg-line-soft" />
        </div>

        {/* Drop zone */}
        <button
          onClick={handleBrowse}
          className="w-full flex items-center gap-4 bg-paper border border-dashed border-line rounded-2xl px-5 py-4 hover:border-accent/40 hover:bg-accent-soft/20 transition-colors text-left"
        >
          <div className="w-10 h-10 shrink-0 rounded-[10px] border border-line bg-paper-2 flex items-center justify-center text-muted">
            <Upload size={18} strokeWidth={1.6} />
          </div>
          <span
            className="flex-1 text-[14px] text-muted"
            style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
          >
            Glisser un profil client
          </span>
          <span className="shrink-0 text-[12px] font-medium text-ink-2 border border-line rounded-lg px-3 py-1.5 bg-paper-2 hover:bg-paper transition-colors">
            Parcourir…
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

    </div>
  );
}
