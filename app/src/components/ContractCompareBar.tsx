"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContractCompare, CONTRACT_COMPARE_MAX } from "@/components/ContractCompareProvider";
import { Btn } from "@/components/ui/Btn";
import { X } from "@/components/ui/icons";

// Barre flottante du panier de comparaison transversale. Se masque à vide,
// apparaît dès qu'un contrat est ajouté, persiste pendant la navigation entre
// assureurs. « Comparer » mène à la page côte à côte avec les clés en paramètres
// répétés (?key=…&key=…) — robuste aux « :: » et virgules des noms de contrats.

// Aligné sur SelectionBar (fonds) : fixe en bas, décalé du rail 60px.
export function ContractCompareBar() {
  const { items, remove, clear } = useContractCompare();
  const pathname = usePathname();
  // Sur la page comparateur elle-même, le panier flottant est redondant (les
  // mêmes contrats sont déjà côte à côte) et masquait le bas du tableau.
  if (items.length === 0 || pathname === "/assureurs/comparateur") return null;

  const compareHref =
    "/assureurs/comparateur?" + items.map((c) => `key=${encodeURIComponent(c.key)}`).join("&");

  return (
    <div className="c-slide-up fixed bottom-4 left-[60px] right-0 mx-auto z-30 flex flex-wrap items-center gap-2 sm:gap-3 bg-paper border border-line rounded-xl px-3 sm:px-4 py-2.5 shadow-[0_4px_16px_oklch(0.22_0.012_60_/_0.12)] max-w-[860px] w-[calc(100%-60px-1.5rem)]">
      <span className="text-body-lg text-accent shrink-0" style={{ fontFamily: "var(--font-sans)" }}>
        {items.length}
      </span>
      {/* Puces de contrats sélectionnés (retirables), masquées sur très petit écran */}
      <span className="hidden sm:flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
        {items.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 max-w-[220px] rounded-full bg-paper-2 border border-line px-2.5 py-0.5"
          >
            <span className="text-meta text-ink-2 truncate">{c.contract}</span>
            <button
              onClick={() => remove(c.key)}
              aria-label={`Retirer ${c.contract}`}
              className="text-muted-2 hover:text-ink shrink-0"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </span>
      <Btn variant="ghost" size="sm" onClick={clear} className="shrink-0 ml-auto sm:ml-0">
        <span className="hidden sm:inline-flex"><X size={13} /></span>
        Vider
      </Btn>
      {items.length < 2 ? (
        <Btn variant="primary" size="sm" disabled className="shrink-0" title="Ajoutez au moins 2 contrats">
          Comparer
        </Btn>
      ) : (
        <Link href={compareHref} prefetch={false} className="shrink-0">
          <Btn variant="primary" size="sm" title={`Comparer ${items.length} contrats (max ${CONTRACT_COMPARE_MAX})`}>
            Comparer
          </Btn>
        </Link>
      )}
    </div>
  );
}
