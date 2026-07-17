"use client";

import { useEffect } from "react";
import { useContractCompare, type CompareContract } from "@/components/ContractCompareProvider";

// Aligne le panier (barre flottante, sessionStorage) sur les contrats réellement
// affichés — utile quand on arrive par un lien PARTAGÉ : la page est pilotée par
// l'URL, on recopie donc sa sélection dans le panier pour que la barre soit
// cohérente (retrait, ajout d'un 5e refusé, etc.).
export function ComparatorSync({ items }: { items: CompareContract[] }) {
  const { toggle, isCompared, items: current } = useContractCompare();

  useEffect(() => {
    // N'ajoute que ce qui manque ; ne retire rien (l'utilisateur peut avoir
    // d'autres contrats en attente qu'on ne veut pas effacer).
    for (const it of items) {
      if (!isCompared(it.key) && current.length < 4) toggle(it);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
