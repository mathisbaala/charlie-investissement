"use client";

import React, { useState } from "react";
import { Rail } from "@/components/chrome/Rail";
import { Topbar } from "@/components/chrome/Topbar";
import { GuidePanel } from "@/components/chrome/GuidePanel";
import { SelectionProvider } from "@/components/SelectionProvider";
import { RateLimitDialog } from "@/components/ui/RateLimitDialog";
import { WelcomeTour } from "@/components/chrome/WelcomeTour";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <SelectionProvider>
      <div className="flex h-full min-h-screen bg-cream overflow-x-hidden">
        {/* Rail 60px fixed left */}
        <Rail />

        {/* Main content area — min-w-0 indispensable : sans lui, la colonne flex
            ne se contraint pas à l'espace dispo (largeur min = contenu) et
            déborde de ~60px à droite sur mobile (sidebar fixe + marginLeft). */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ marginLeft: "60px" }}>
          <Topbar
            onGuideToggle={() => setGuideOpen((v) => !v)}
            guideOpen={guideOpen}
          />
          {/* Content below topbar */}
          <main className="flex-1 mt-14 overflow-hidden">
            {children}
          </main>
        </div>

        {/* Panneau Charlie (flottant) — explication de la page courante */}
        <GuidePanel open={guideOpen} onClose={() => setGuideOpen(false)} />

        {/* Modal « crédits du jour épuisés » (déclenché sur 429 des routes IA) */}
        <RateLimitDialog />

        {/* Visite guidée de première visite (5 onglets + Charlie), une seule fois */}
        <WelcomeTour />
      </div>
    </SelectionProvider>
  );
}
