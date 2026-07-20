"use client";

import { Check, Plus } from "@/components/ui/icons";
import { useContractCompare, type CompareContract } from "@/components/ContractCompareProvider";

// Petit carré de sélection d'un contrat pour le comparateur transversal.
// Coché = dans le panier (accent + ✓), vide = à ajouter (+). Désactivé quand le
// plafond de 4 est atteint (la barre flottante le signale). Réutilisé par la
// liste des assureurs et par le comparateur intra-assureur : quand il est posé
// à l'intérieur d'un <Link>, il coupe la navigation (preventDefault) pour ne
// faire que basculer la sélection.
export function ContractCompareToggle({ c }: { c: CompareContract }) {
  const { isCompared, toggle, atMax } = useContractCompare();
  const on = isCompared(c.key);
  const disabled = !on && atMax;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle({ key: c.key, company: c.company, contract: c.contract });
      }}
      title={on ? "Retirer du comparateur" : disabled ? "Maximum de 4 contrats atteint" : "Ajouter au comparateur"}
      aria-pressed={on}
      aria-label={on ? `Retirer ${c.contract} du comparateur` : `Ajouter ${c.contract} au comparateur`}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md border transition-colors shrink-0 ${
        on
          ? "bg-accent border-accent text-paper"
          : "bg-paper border-line text-muted-2 hover:border-accent/50 hover:text-accent-ink"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {on ? <Check size={13} /> : <Plus size={13} />}
    </button>
  );
}
