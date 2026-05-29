"use client";

import Link from "next/link";
import { useSelection } from "@/components/SelectionProvider";
import { Btn } from "@/components/ui/Btn";
import { X, Download } from "@/components/ui/icons";

interface SelectionBarProps {
  onCompare: () => void;
}

export function SelectionBar({ onCompare }: SelectionBarProps) {
  const { selected, clear } = useSelection();

  if (selected.length === 0) return null;

  const pdfHref = `/api/rapport/pdf?isins=${selected.map((f) => f.isin).join(",")}`;

  return (
    <div className="c-slide-up fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-paper border border-line rounded-xl px-4 py-2.5 shadow-[0_4px_16px_oklch(0.22_0.012_60_/_0.12)] max-w-[860px] w-[calc(100%-2rem)]">
      <span
        className="text-[15px] text-accent shrink-0"
        style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
      >
        {selected.length}
      </span>
      <span className="text-[12px] text-ink-2 flex-1 min-w-0 truncate">
        {selected.map((f) => f.name).join(" · ")}
      </span>
      <Btn variant="ghost" size="sm" onClick={clear} className="shrink-0">
        <X size={13} />
        Vider
      </Btn>
      {selected.length >= 2 && (
        <Link href={pdfHref} target="_blank" className="shrink-0">
          <Btn variant="outline" size="sm">
            <Download size={13} />
            Rapport PDF
          </Btn>
        </Link>
      )}
      <Btn
        variant="primary"
        size="sm"
        disabled={selected.length < 2}
        onClick={onCompare}
        className="shrink-0"
      >
        Comparer
      </Btn>
    </div>
  );
}
