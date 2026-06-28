"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { Btn } from "@/components/ui/Btn";
import { Search } from "@/components/ui/icons";
import { addSearch } from "@/lib/searches";
import { ClientProfileForm } from "@/components/profile/ClientProfileForm";

// Accueil épuré, façon landing : deux entrées seulement — la recherche en langage
// naturel, et le profil client (ci-dessous). Pas de tri par enveloppe/assureur ni
// de top performers.
export default function AccueilPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSearch() {
    if (!query.trim()) {
      router.push("/recherche");
      return;
    }
    addSearch({ query: query.trim(), chips: [], count: 0 });
    router.push("/recherche?q=" + encodeURIComponent(query.trim()));
  }

  return (
    <div className="h-full overflow-y-auto bg-cream px-4 sm:px-8 py-10">
      <div className="max-w-[1040px] mx-auto">

        {/* 1 — Recherche en langage naturel (le titre « Charlie » vit dans la Topbar) */}
        <div className="bg-paper rounded-xl border border-line shadow-sm px-5 py-3.5 flex items-center gap-3 focus-within:border-accent/50 transition-colors">
          <Search size={16} className="text-muted shrink-0" />
          <TypingPrompt value={query} onChange={setQuery} onSubmit={handleSearch} className="flex-1" />
          <Btn variant="primary" size="sm" onClick={handleSearch}>
            Rechercher
          </Btn>
        </div>

        {/* 2 — Profil client */}
        <div className="mt-10 mb-4 flex items-center gap-3">
          <span className="text-caption uppercase tracking-widest text-muted font-semibold shrink-0">
            Ou décrivez votre client
          </span>
          <span className="h-px flex-1 bg-line-soft" />
        </div>

        <ClientProfileForm />
      </div>
    </div>
  );
}
