"use client";

import React, { useEffect, useRef, useState } from "react";
import { Plus, Search, Loader2, Check } from "@/components/ui/icons";

interface Hit {
  isin: string;
  name: string;
  product_type?: string;
}

interface Props {
  /** Ajoute le fonds choisi au portefeuille (l'appelant gère poids/dédup). */
  onAdd: (isin: string, name: string) => void;
  /** ISIN déjà présents → affichés « Ajouté » et non re-sélectionnables. */
  existing: Set<string>;
  /** Vrai quand le portefeuille a atteint sa taille maximale. */
  full?: boolean;
  /** Textes du champ (défaut : ajout au portefeuille). */
  placeholder?: string;
  fullPlaceholder?: string;
}

// Libellés courts d'univers pour la pastille de résultat.
const TYPE_LABEL: Record<string, string> = {
  opcvm: "OPCVM", etf: "ETF", scpi: "SCPI", fonds_euros: "Fonds €",
  fcpr: "FCPR", fcpi: "FCPI", fip: "FIP", fpci: "FPCI", structuré: "Structuré",
};

/**
 * Champ d'ajout direct d'un fonds au portefeuille : on colle un ISIN ou on tape
 * un nom → recherche dans la base (`/api/funds?search=`, qui court-circuite déjà
 * l'ISIN exact) → on choisit dans la liste. Complète le parcours « je connais
 * déjà le fonds » sans repasser par le screener.
 */
export function FundAdder({ onAdd, existing, full, placeholder, fullPlaceholder }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Recherche débouncée. AbortController : une frappe rapide annule la requête
  // précédente (évite que la réponse d'un préfixe ancien écrase la plus récente).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); setLoading(false); return; }
    const ac = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/funds?search=${encodeURIComponent(q)}&per_page=6`, { signal: ac.signal });
        const json = await res.json();
        const data = (json?.data ?? []) as Hit[];
        setHits(data.map((d) => ({ isin: d.isin, name: d.name, product_type: d.product_type })));
        setOpen(true);
      } catch {
        if (!ac.signal.aborted) setHits([]);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => { ac.abort(); clearTimeout(t); };
  }, [query]);

  // Fermer la liste au clic extérieur.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (h: Hit) => {
    if (full || existing.has(h.isin)) return;
    onAdd(h.isin, h.name);
    setQuery("");
    setHits([]);
    setOpen(false);
  };

  // Entrée : choisit le 1er résultat sélectionnable (raccourci « je colle l'ISIN »).
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const first = hits.find((h) => !existing.has(h.isin));
      if (first) { e.preventDefault(); pick(first); }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <div className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 transition-colors ${full ? "border-line bg-line-soft/40" : "border-line bg-paper focus-within:border-accent"}`}>
        {loading ? <Loader2 size={14} className="text-muted shrink-0 animate-spin" /> : <Plus size={14} className="text-muted shrink-0" />}
        <input
          type="text"
          value={query}
          disabled={full}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={onKey}
          placeholder={full ? (fullPlaceholder ?? "Portefeuille au complet") : (placeholder ?? "Ajouter un fonds : ISIN ou nom")}
          className="flex-1 min-w-0 bg-transparent text-meta text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
        />
        <Search size={13} className="text-muted-2 shrink-0" />
      </div>

      {open && !full && (query.trim().length >= 2) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-paper border border-line rounded-lg shadow-lg overflow-hidden">
          {hits.length === 0 && !loading && (
            <p className="px-3 py-2.5 text-caption text-muted">Aucun fonds trouvé dans la base.</p>
          )}
          {hits.map((h) => {
            const added = existing.has(h.isin);
            return (
              <button
                key={h.isin}
                onClick={() => pick(h)}
                disabled={added}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b border-line-soft last:border-0 transition-colors ${added ? "opacity-60 cursor-default" : "hover:bg-accent-soft"}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-meta text-ink truncate">{h.name || h.isin}</p>
                  <p className="text-caption text-muted-2 font-mono">{h.isin}</p>
                </div>
                {h.product_type && TYPE_LABEL[h.product_type] && (
                  <span className="text-caption text-muted shrink-0">{TYPE_LABEL[h.product_type]}</span>
                )}
                {added && <Check size={13} className="text-ok shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
