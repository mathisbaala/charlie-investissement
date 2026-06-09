"use client";

import React, { useState } from "react";
import { Rail } from "@/components/chrome/Rail";
import { Topbar } from "@/components/chrome/Topbar";
import { ChatPanel } from "@/components/chrome/ChatPanel";
import { ToastProvider } from "@/components/ui/Toast";
import { SelectionProvider } from "@/components/SelectionProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <ToastProvider>
      <SelectionProvider>
        <div className="flex h-full min-h-screen bg-cream overflow-x-hidden">
          {/* Rail 60px fixed left */}
          <Rail />

          {/* Main content area — min-w-0 indispensable : sans lui, la colonne flex
              ne se contraint pas à l'espace dispo (largeur min = contenu) et
              déborde de ~60px à droite sur mobile (sidebar fixe + marginLeft). */}
          <div className="flex-1 min-w-0 flex flex-col" style={{ marginLeft: "60px" }}>
            <Topbar
              onChatToggle={() => setChatOpen((v) => !v)}
              chatOpen={chatOpen}
            />
            {/* Content below topbar */}
            <main className="flex-1 mt-14 overflow-hidden">
              {children}
            </main>
          </div>

          {/* Chat panel (floating) */}
          <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        </div>
      </SelectionProvider>
    </ToastProvider>
  );
}
