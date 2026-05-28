"use client";

import React, { useState } from "react";
import { X } from "@/components/ui/icons";
import { Btn } from "@/components/ui/Btn";
import type { ParsedFilters } from "@/lib/types";

interface FilterPanelProps {
  filters: ParsedFilters;
  onChange: (f: ParsedFilters) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
  resultCount?: number;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line-soft py-4">
      <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-3">{title}</p>
      {children}
    </div>
  );
}

function CheckChip({
  label, active, onToggle,
}: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        active
          ? "bg-accent-soft text-accent-ink border-accent/30"
          : "bg-paper-2 text-ink-2 border-transparent hover:border-line"
      }`}
    >
      {label}
    </button>
  );
}

function NumInput({
  label, value, onChange, placeholder = "",
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[11px] text-ink-2 shrink-0">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-20 border border-line rounded px-2 py-1 text-[11px] font-mono text-ink bg-paper focus:outline-none focus:border-accent/50"
      />
    </div>
  );
}

function toggleArr<T>(arr: T[] | undefined, val: T): T[] {
  const a = arr ?? [];
  return a.includes(val) ? a.filter((x) => x !== val) : [...a, val];
}

export function FilterPanel({
  filters, onChange, onApply, onReset, onClose, resultCount,
}: FilterPanelProps) {
  const f = filters;

  function set<K extends keyof ParsedFilters>(key: K, val: ParsedFilters[K]) {
    onChange({ ...f, [key]: val });
  }

  return (
    <div className="c-slide-in-l flex flex-col h-full w-[260px] bg-paper border-r border-line">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-line shrink-0">
        <span className="text-[12px] font-semibold text-ink">Filtres</span>
        <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* Scrollable filters */}
      <div className="flex-1 overflow-y-auto px-4">
        {/* SFDR */}
        <Group title="SFDR">
          <div className="flex gap-2 flex-wrap">
            {[6, 8, 9].map((n) => (
              <CheckChip
                key={n}
                label={`Art. ${n}`}
                active={(f.sfdr ?? []).includes(n)}
                onToggle={() => set("sfdr", toggleArr(f.sfdr, n))}
              />
            ))}
          </div>
        </Group>

        {/* SRI */}
        <Group title="SRI (risque)">
          <div className="space-y-2">
            <NumInput label="Min" value={String(f.sri_min ?? "")} onChange={(v) => set("sri_min", v ? +v : undefined)} placeholder="1" />
            <NumInput label="Max" value={String(f.sri_max ?? "")} onChange={(v) => set("sri_max", v ? +v : undefined)} placeholder="7" />
          </div>
        </Group>

        {/* TER */}
        <Group title="TER max (%)">
          <NumInput label="TER ≤" value={String(f.ter_max ?? "")} onChange={(v) => set("ter_max", v ? +v : undefined)} placeholder="2.0" />
        </Group>

        {/* Performance */}
        <Group title="Performance min">
          <div className="space-y-2">
            <NumInput label="Perf 1A ≥" value={String(f.perf_1y_min ?? "")} onChange={(v) => set("perf_1y_min", v ? +v : undefined)} placeholder="0" />
            <NumInput label="Perf 3A ≥" value={String(f.perf_3y_min ?? "")} onChange={(v) => set("perf_3y_min", v ? +v : undefined)} placeholder="0" />
          </div>
        </Group>

        {/* Risque / Sharpe */}
        <Group title="Risque / Sharpe">
          <div className="space-y-2">
            <NumInput label="Vol max" value={String(f.vol_max ?? "")} onChange={(v) => set("vol_max", v ? +v : undefined)} placeholder="%" />
            <NumInput label="Sharpe ≥" value={String(f.sharpe_min ?? "")} onChange={(v) => set("sharpe_min", v ? +v : undefined)} placeholder="0" />
          </div>
        </Group>

        {/* AUM / Track record */}
        <Group title="Taille / Ancienneté">
          <div className="space-y-2">
            <NumInput label="AUM ≥ (M€)" value={String(f.aum_min ?? "")} onChange={(v) => set("aum_min", v ? +v : undefined)} placeholder="0" />
            <NumInput label="Track rec. ≥" value={String(f.track_record_min ?? "")} onChange={(v) => set("track_record_min", v ? +v : undefined)} placeholder="ans" />
          </div>
        </Group>

        {/* Enveloppes */}
        <Group title="Enveloppes">
          <div className="flex gap-2 flex-wrap">
            {["PEA", "PER", "AV-LUX"].map((env) => (
              <CheckChip
                key={env}
                label={env}
                active={(f.envelopes ?? []).includes(env)}
                onToggle={() => set("envelopes", toggleArr(f.envelopes, env))}
              />
            ))}
          </div>
        </Group>

        {/* Univers */}
        <Group title="Univers">
          <div className="flex gap-2 flex-wrap">
            {["opcvm", "etf", "scpi", "fps", "fonds_euros"].map((u) => (
              <CheckChip
                key={u}
                label={u.toUpperCase()}
                active={(f.universe ?? []).includes(u)}
                onToggle={() => set("universe", toggleArr(f.universe, u))}
              />
            ))}
          </div>
        </Group>

        {/* Morningstar */}
        <Group title="Morningstar min">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => set("morningstar_min", f.morningstar_min === n ? undefined : n)}
                className={`text-base leading-none transition-colors ${
                  (f.morningstar_min ?? 0) >= n ? "text-warn" : "text-muted-2"
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </Group>

        {/* Gestionnaire */}
        <Group title="Gestionnaire">
          <input
            type="text"
            value={f.manager_search ?? ""}
            onChange={(e) => set("manager_search", e.target.value || undefined)}
            placeholder="Amundi, BlackRock…"
            className="w-full border border-line rounded px-2.5 py-1.5 text-[11px] text-ink bg-paper focus:outline-none focus:border-accent/50"
          />
        </Group>
      </div>

      {/* Sticky footer */}
      <div className="px-4 py-3 border-t border-line flex gap-2 shrink-0 bg-paper">
        <Btn variant="ghost" size="sm" onClick={onReset} className="flex-1">
          Réinitialiser
        </Btn>
        <Btn variant="primary" size="sm" onClick={onApply} className="flex-1">
          Appliquer{resultCount != null ? ` · ${resultCount}` : ""}
        </Btn>
      </div>
    </div>
  );
}
