"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { Btn } from "@/components/ui/Btn";

export default function LandingPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSubmit() {
    if (!query.trim()) return;
    document.cookie = "charlie_seen=1; path=/; max-age=31536000";
    router.push(`/recherche?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center relative overflow-hidden px-4">
      {/* Decorative circles */}
      <div className="absolute top-[-80px] right-[-80px] w-[340px] h-[340px] rounded-full bg-accent-soft opacity-60 pointer-events-none" />
      <div className="absolute bottom-[-60px] left-[-60px] w-[200px] h-[200px] rounded-full bg-accent-soft/40 pointer-events-none" />

      {/* Top-right link */}
      <div className="absolute top-4 right-5">
        <a
          href="/accueil"
          className="text-[11px] text-muted hover:text-ink transition-colors"
        >
          Déjà CGP ? → Accueil
        </a>
      </div>

      {/* Center block */}
      <div className="relative w-full max-w-[520px] c-slide-up">
        {/* Logo mark */}
        <div className="w-10 h-10 bg-brown rounded-full flex items-center justify-center mb-6">
          <span
            className="text-paper text-lg italic"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            C
          </span>
        </div>

        {/* H1 */}
        <h1
          className="text-[38px] leading-[1.15] text-ink"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Trouver le bon support,
          <br />
          <em className="text-accent not-italic">en quelques mots.</em>
        </h1>

        {/* Subtitle */}
        <p className="text-[14px] text-muted mt-3">
          Charlie analyse 35 988 fonds, ETF et SCPI pour vous recommander les
          supports adaptés à chaque client.
        </p>

        {/* Search bar */}
        <div className="mt-8 w-full bg-paper rounded-2xl border border-line shadow-sm px-5 py-4">
          <TypingPrompt
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            className="w-full"
          />
          <div className="mt-3 flex justify-end">
            <Btn variant="primary" size="lg" onClick={handleSubmit}>
              Rechercher →
            </Btn>
          </div>
        </div>

        {/* Handwritten note */}
        <p
          className="mt-3 text-[13px] text-muted"
          style={{ fontFamily: "var(--font-hand)" }}
        >
          Commencez par décrire ce que vous cherchez…
        </p>
      </div>
    </div>
  );
}
