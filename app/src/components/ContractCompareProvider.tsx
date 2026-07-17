"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// Panier de comparaison TRANSVERSALE de contrats d'assurance-vie. Contrairement
// au comparateur d'une fiche assureur (intra-assureur), ce panier accumule des
// contrats de N'IMPORTE quels assureurs, en survivant à la navigation (on ajoute
// un contrat de l'assureur A, on va chez l'assureur B, on en ajoute un autre).
// Persisté en sessionStorage, plafonné à 4 (au-delà la comparaison côte à côte
// devient illisible). Calqué sur SelectionProvider (fonds) pour la cohérence.

export interface CompareContract {
  key: string;       // repr_key « Assureur::Contrat »
  company: string;
  contract: string;
}

interface ContractCompareValue {
  items: CompareContract[];
  isCompared: (key: string) => boolean;
  toggle: (c: CompareContract) => void;
  remove: (key: string) => void;
  clear: () => void;
  atMax: boolean;
}

const Ctx = createContext<ContractCompareValue | null>(null);
const SESSION_KEY = "charlie_contract_compare";
export const CONTRACT_COMPARE_MAX = 4;

export function ContractCompareProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CompareContract[]>([]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {}
  }, []);

  const persist = (list: CompareContract[]) => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(list)); } catch {}
  };

  const toggle = useCallback((c: CompareContract) => {
    setItems((prev) => {
      const exists = prev.some((x) => x.key === c.key);
      let next: CompareContract[];
      if (exists) next = prev.filter((x) => x.key !== c.key);
      else if (prev.length < CONTRACT_COMPARE_MAX) next = [...prev, c];
      else next = prev; // plafond atteint : on ignore l'ajout (barre le signale)
      persist(next);
      return next;
    });
  }, []);

  const remove = useCallback((key: string) => {
    setItems((prev) => {
      const next = prev.filter((x) => x.key !== key);
      persist(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }, []);

  const isCompared = useCallback((key: string) => items.some((x) => x.key === key), [items]);

  return (
    <Ctx.Provider value={{ items, isCompared, toggle, remove, clear, atMax: items.length >= CONTRACT_COMPARE_MAX }}>
      {children}
    </Ctx.Provider>
  );
}

export function useContractCompare() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useContractCompare must be used within ContractCompareProvider");
  return ctx;
}
