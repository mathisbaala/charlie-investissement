"use client";

import React, { useState } from "react";
import { X, Search } from "@/components/ui/icons";

// Sélecteur d'entité unifié du screener (assureurs, contrats, sociétés de gestion).
// Un seul patron pour les trois, afin d'en finir avec les incohérences de placement :
// TITRE → champ « Rechercher… » → suggestions inline à la frappe → la sélection
// devient des jetons retirables. Rien n'est pré-affiché en masse : la densité vient
// de ce que l'utilisateur choisit, pas d'un mur de 30/64 boutons.

export type EntityOption = { value: string; label: string; count?: number };

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Filtre pur : options qui matchent la requête (sous-chaîne, insensible casse/accents),
 * en retirant celles déjà sélectionnées, plafonné à `max`. Exporté pour les tests.
 */
export function filterEntityOptions(
  options: EntityOption[],
  query: string,
  selected: string[],
  max = 8,
): EntityOption[] {
  const sel = new Set(selected);
  const q = norm(query.trim());
  const base = options.filter((o) => !sel.has(o.value));
  const matched = q ? base.filter((o) => norm(o.label).includes(q)) : base;
  return matched.slice(0, max);
}

function Token({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full text-meta font-medium bg-brown text-paper border border-brown">
      <span className="truncate max-w-[200px]">{label}</span>
      <button
        onClick={onRemove}
        aria-label={`Retirer ${label}`}
        className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-paper/20 transition-colors shrink-0"
      >
        <X size={11} />
      </button>
    </span>
  );
}

export function EntityMultiSelect({
  placeholder,
  options,
  selected,
  onToggle,
  emptySuggestions,
  emptyHeader,
  renderChildren,
  freeText,
  maxSuggestions = 8,
}: {
  placeholder: string;
  options: EntityOption[];
  selected: string[];
  onToggle: (value: string) => void;
  // Suggestions affichées champ vide (ex. les partenaires du cabinet) : visibles
  // d'emblée sans avoir à taper, sous l'intitulé `emptyHeader`.
  emptySuggestions?: EntityOption[];
  emptyHeader?: string;
  // Rendu optionnel sous un jeton sélectionné (ex. contrats sous l'assureur choisi).
  renderChildren?: (value: string) => React.ReactNode;
  // Repli « recherche libre » quand l'univers listé ne couvre pas tout (ex. les
  // sociétés de gestion : seul le top est listé, le reste passe en texte libre).
  freeText?: {
    value?: string;
    onChange: (v: string | undefined) => void;
    suggestPrefix: string;
    chipSuffix: string;
  };
  maxSuggestions?: number;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  const suggestions = q
    ? filterEntityOptions(options, q, selected, maxSuggestions)
    : emptySuggestions
      ? filterEntityOptions(emptySuggestions, "", selected, maxSuggestions)
      : [];

  const showFreeTextRow =
    !!freeText && q.length > 0 && !options.some((o) => norm(o.label) === norm(q));

  const hasSelection = selected.length > 0 || !!freeText?.value;

  return (
    <div>
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-2 pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-line rounded-lg pl-9 pr-3 py-2 text-meta text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
        />
      </div>

      {(suggestions.length > 0 || showFreeTextRow) && (
        <div className="mt-1.5 border border-line rounded-lg overflow-hidden bg-paper divide-y divide-line-soft max-h-56 overflow-y-auto">
          {!q && emptyHeader && suggestions.length > 0 && (
            <p className="text-caption uppercase tracking-[0.08em] text-muted-2 font-semibold px-3 pt-2 pb-1">
              {emptyHeader}
            </p>
          )}
          {suggestions.map((o) => (
            <button
              key={o.value}
              onClick={() => onToggle(o.value)}
              className="w-full text-left px-3 py-2 text-meta text-ink-2 hover:bg-paper-2 transition-colors flex items-center justify-between gap-3"
            >
              <span className="truncate">{o.label}</span>
              {typeof o.count === "number" && (
                <span className="text-muted-2 font-mono text-caption shrink-0">{o.count}</span>
              )}
            </button>
          ))}
          {showFreeTextRow && (
            <button
              onClick={() => {
                freeText!.onChange(q);
                setQuery("");
              }}
              className="w-full text-left px-3 py-2 text-meta text-accent hover:bg-paper-2 transition-colors"
            >
              {freeText!.suggestPrefix} « {q} »
            </button>
          )}
        </div>
      )}

      {hasSelection &&
        (renderChildren ? (
          // Assureurs : chaque sélection sur sa ligne, contrats en dessous.
          <div className="mt-2 space-y-2.5">
            {selected.map((v) => (
              <div key={v}>
                <Token label={labelOf(v)} onRemove={() => onToggle(v)} />
                {renderChildren(v)}
              </div>
            ))}
          </div>
        ) : (
          // Sociétés / listes plates : jetons en enfilade.
          <div className="mt-2 flex flex-wrap gap-1.5">
            {freeText?.value && (
              <Token
                label={`« ${freeText.value} » · ${freeText.chipSuffix}`}
                onRemove={() => freeText.onChange(undefined)}
              />
            )}
            {selected.map((v) => (
              <Token key={v} label={labelOf(v)} onRemove={() => onToggle(v)} />
            ))}
          </div>
        ))}
    </div>
  );
}
