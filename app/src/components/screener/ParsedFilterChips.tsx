"use client";

import { Tag } from "@/components/ui/Tag";
import type { ParsedFilters } from "@/lib/types";

interface ParsedFilterChipsProps {
  filters: ParsedFilters;
  onRemoveChip: (chip: string) => void;
}

export function ParsedFilterChips({ filters, onRemoveChip }: ParsedFilterChipsProps) {
  const chips = filters.chips ?? [];
  if (chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 pr-3 scrollbar-none">
      {chips.map((chip) => (
        <Tag key={chip} label={chip} onRemove={() => onRemoveChip(chip)} className="shrink-0" />
      ))}
    </div>
  );
}
