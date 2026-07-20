"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, Check } from "@/components/ui/icons";
import { SAMPLE_CONTRACT } from "@/lib/sampleUniverse";

// Sélecteur du contrat de l'atelier Portefeuille, relié au référencement RÉEL
// (« Assureur::Contrat » de la base scrapée) au lieu d'une saisie libre.
// Périmètre STRICT : uniquement les assureurs renseignés par le conseiller
// (profil « Distribution du cabinet », pré-rempli depuis Mon cabinet) — le
// moteur d'allocation doit trier parmi des milliers de fonds, on le cantonne
// aux contrats où le CGP peut réellement loger le client. Pas de repli « autres
// assureurs » ici (il existe dans l'onglet recherche, pas dans l'allocation).
// Aucun assureur renseigné → tous les contrats de la base. Les contrats déjà
// déclarés dans Mon cabinet remontent en tête avec la pastille « Partenaire ».

export interface ContractOption {
  company: string;
  key: string;
  contract?: string;
  funds?: number;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Libellé affiché pour le contrat d'exemple : nom réaliste, présenté comme un
// exemple (préfixe « Ex. » + gris à l'affichage, cf. ContractPicker) — même
// registre que le placeholder « Ex. Charlie Gestion Privée » du champ Cabinet.
export const SAMPLE_CONTRACT_LABEL = "Ex. Charlie Vie Premium";

/** Libellé lisible d'une clé « Assureur::Contrat ». */
export function contractLabel(key: string): string {
  if (key === SAMPLE_CONTRACT) return SAMPLE_CONTRACT_LABEL;
  return key.includes("::") ? key.replace("::", " — ") : key;
}

/**
 * Classe puis filtre les contrats pour le menu : STRICTEMENT ceux des assureurs
 * du périmètre (tous les contrats si aucun assureur renseigné), les contrats
 * déclarés dans Mon cabinet en tête. Aucun repli hors périmètre : l'allocation
 * ne propose jamais un contrat où le CGP ne peut pas loger le client.
 * Exportée pour être testée isolément du composant.
 */
export function rankContracts(
  options: ContractOption[],
  query: string,
  scopeInsurers: string[],
  cabinetKeys: Set<string>,
  limit = 8,
): ContractOption[] {
  const q = norm(query.trim());
  const scope = new Set(scopeInsurers.map(norm));
  const matches = (o: ContractOption) =>
    q === "" || norm(o.key).includes(q) || norm(o.company).includes(q);
  const inScopeOf = (o: ContractOption) => scope.size === 0 || scope.has(norm(o.company));

  const rank = (o: ContractOption) => (cabinetKeys.has(o.key) ? 0 : 1);
  return options
    .filter((o) => matches(o) && inScopeOf(o))
    .sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key, "fr"))
    .slice(0, limit);
}

export function ContractPicker({
  value,
  onChange,
  scopeInsurers,
  cabinetKeys,
}: {
  /** Clé « Assureur::Contrat » sélectionnée (ou SAMPLE_CONTRACT). */
  value: string;
  onChange: (key: string) => void;
  /** Assureurs renseignés (profil + cabinet) : périmètre de recherche. */
  scopeInsurers: string[];
  /** Clés des contrats déclarés dans Mon cabinet (remontés en tête). */
  cabinetKeys: Set<string>;
}) {
  const [options, setOptions] = useState<ContractOption[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Même garde de montage que CabinetForm : en mode strict React (dev), le
  // composant est monté/démonté/remonté — sans remise à true, la réponse du
  // fetch serait ignorée pour toujours.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const load = React.useCallback((attempt = 0) => {
    setStatus("loading");
    fetch("/api/screener/contracts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http"))))
      .then((j: { data?: ContractOption[] }) => {
        if (!mountedRef.current) return;
        setOptions(j.data ?? []);
        setStatus("ready");
      })
      .catch(() => {
        if (!mountedRef.current) return;
        if (attempt < 2) setTimeout(() => load(attempt + 1), 800 * (attempt + 1));
        else setStatus("error");
      });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Fermer au clic extérieur.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const hits = useMemo(
    () => rankContracts(options, query, scopeInsurers, cabinetKeys),
    [options, query, scopeInsurers, cabinetKeys],
  );

  const pick = (key: string) => {
    onChange(key);
    setQuery("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (hits[0]) { e.preventDefault(); pick(hits[0].key); }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  const row = (o: ContractOption) => (
    <button
      key={o.key}
      type="button"
      onClick={() => pick(o.key)}
      className="w-full text-left px-3 py-2 flex items-center gap-2 border-b border-line-soft last:border-0 hover:bg-accent-soft/40 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-meta text-ink truncate">{o.contract ?? o.key.split("::")[1] ?? o.key}</p>
        <p className="text-caption text-muted-2 truncate">
          {o.company}
          {o.funds != null && ` · ${o.funds} fonds`}
        </p>
      </div>
      {cabinetKeys.has(o.key) && (
        <span className="text-caption text-brown shrink-0 border border-brown/30 rounded-full px-2 py-0.5">
          Partenaire
        </span>
      )}
      {o.key === value && <Check size={13} className="text-ok shrink-0" />}
    </button>
  );

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 focus-within:border-clay transition-colors">
        {status === "loading" ? (
          <Loader2 size={13} className="text-muted shrink-0 animate-spin" />
        ) : (
          <Search size={13} className="text-muted shrink-0" />
        )}
        <input
          type="text"
          aria-label="Rechercher un contrat"
          value={open ? query : contractLabel(value)}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery(""); if (status === "error") load(); }}
          onKeyDown={onKey}
          placeholder={
            scopeInsurers.length > 0
              ? "Rechercher chez vos assureurs…"
              : "Rechercher un contrat…"
          }
          autoComplete="off"
          className={`flex-1 min-w-0 bg-transparent text-meta placeholder:text-muted focus:outline-none truncate ${
            !open && value === SAMPLE_CONTRACT ? "text-muted" : "text-ink"
          }`}
        />
      </div>

      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-y-auto scrollbar-thin bg-paper border border-line rounded-lg shadow-lg">
          {status === "error" ? (
            <button type="button" onClick={() => load()}
              className="block w-full text-left px-3 py-2 text-meta text-warn hover:bg-accent-soft/40">
              Impossible de charger le référencement. Cliquez pour réessayer.
            </button>
          ) : status === "loading" ? (
            <p className="px-3 py-2 text-meta text-muted-2">Chargement du référencement…</p>
          ) : (
            <>
              {hits.length === 0 && (
                <p className="px-3 py-2 text-meta text-muted-2">
                  {scopeInsurers.length > 0
                    ? "Aucun contrat chez vos assureurs partenaires ne correspond."
                    : "Aucun contrat ne correspond."}
                </p>
              )}
              {hits.map(row)}
              <button
                type="button"
                onClick={() => pick(SAMPLE_CONTRACT)}
                className="w-full text-left px-3 py-2 text-meta text-muted hover:bg-accent-soft/40 border-t border-line-soft transition-colors"
              >
                {SAMPLE_CONTRACT_LABEL} · univers d&apos;exemple
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
