"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface SelectedFund {
  isin: string;
  name: string;
  gestionnaire: string | null;
  sfdr_article: number | null;
  risk_score: number | null;
  performance_1y: number | null;
  performance_3y: number | null;
  performance_5y: number | null;
  ongoing_charges: number | null;
  volatility_1y: number | null;
  sharpe_1y: number | null;
  max_drawdown_3y: number | null;
  morningstar_rating: number | null;
  track_record_years: number | null;
  aum_eur: number | null;
  pea_eligible: boolean | null;
  per_eligible: boolean | null;
  av_lux_eligible: boolean | null;
}

interface SelectionContextValue {
  selected: SelectedFund[];
  isSelected: (isin: string) => boolean;
  toggle: (fund: SelectedFund) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);
const SESSION_KEY = "charlie_comparison";

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<SelectedFund[]>([]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) setSelected(JSON.parse(saved));
    } catch {}
  }, []);

  const persist = (list: SelectedFund[]) => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(list)); } catch {}
  };

  const toggle = useCallback((fund: SelectedFund) => {
    setSelected((prev) => {
      const exists = prev.some((f) => f.isin === fund.isin);
      let next: SelectedFund[];
      if (exists) {
        next = prev.filter((f) => f.isin !== fund.isin);
      } else if (prev.length < 4) {
        next = [...prev, fund];
      } else {
        next = prev; // max 4
      }
      persist(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected([]);
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }, []);

  const isSelected = useCallback(
    (isin: string) => selected.some((f) => f.isin === isin),
    [selected]
  );

  return (
    <SelectionContext.Provider value={{ selected, isSelected, toggle, clear }}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}
