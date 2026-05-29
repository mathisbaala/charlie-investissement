"use client";

import React, { useState } from "react";
import { X, SlidersHorizontal } from "@/components/ui/icons";
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

function Divider() {
  return <div className="border-b border-dashed border-line-soft" />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-4">
      <p className="text-[10px] uppercase tracking-[0.08em] text-muted font-semibold mb-3">
        {title}
      </p>
      {children}
    </div>
  );
}

function SfdrPill({
  label, active, onToggle,
}: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
        active
          ? "bg-brown text-paper border-brown"
          : "bg-paper-2 text-ink-2 border-line hover:border-accent/30"
      }`}
    >
      {label}
    </button>
  );
}

function SriSlider({
  min, max,
  onChangeMin, onChangeMax,
}: {
  min: number; max: number;
  onChangeMin: (v: number) => void;
  onChangeMax: (v: number) => void;
}) {
  const pct = (v: number) => ((v - 1) / 6) * 100;

  return (
    <div>
      <div className="relative h-6 flex items-center">
        {/* Track bg */}
        <div className="absolute left-0 right-0 h-1 rounded-full bg-line-soft" />
        {/* Filled segment */}
        <div
          className="absolute h-1 rounded-full bg-brown"
          style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }}
        />
        {/* Min thumb */}
        <input
          type="range" min={1} max={7} step={1} value={min}
          onChange={(e) => onChangeMin(Math.min(+e.target.value, max))}
          className="absolute w-full appearance-none bg-transparent pointer-events-none
            [&::-webkit-slider-thumb]:pointer-events-auto
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-brown
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-paper
            [&::-webkit-slider-thumb]:shadow-sm
            [&::-webkit-slider-thumb]:cursor-pointer"
        />
        {/* Max thumb */}
        <input
          type="range" min={1} max={7} step={1} value={max}
          onChange={(e) => onChangeMax(Math.max(+e.target.value, min))}
          className="absolute w-full appearance-none bg-transparent pointer-events-none
            [&::-webkit-slider-thumb]:pointer-events-auto
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-brown
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-paper
            [&::-webkit-slider-thumb]:shadow-sm
            [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>
      <div className="flex justify-between mt-1.5 px-0.5">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <span key={n} className="text-[10px] text-muted-2 font-mono">{n}</span>
        ))}
      </div>
    </div>
  );
}

function NumPairInputs({
  labelA, labelB,
  valueA, valueB,
  onChangeA, onChangeB,
  placeholderA, placeholderB,
  suffix = "%",
}: {
  labelA: string; labelB: string;
  valueA: string; valueB: string;
  onChangeA: (v: string) => void; onChangeB: (v: string) => void;
  placeholderA?: string; placeholderB?: string;
  suffix?: string;
}) {
  const cls = "w-full border border-line rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2.5 text-[10px] text-muted uppercase tracking-wider font-semibold">
        <span>{labelA}</span>
        <span>{labelB}</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex items-center gap-1">
          <input type="number" value={valueA} onChange={(e) => onChangeA(e.target.value)}
            placeholder={placeholderA} className={cls} />
          <span className="text-[11px] text-muted shrink-0">{suffix}</span>
        </div>
        <div className="flex items-center gap-1">
          <input type="number" value={valueB} onChange={(e) => onChangeB(e.target.value)}
            placeholder={placeholderB} className={cls} />
          <span className="text-[11px] text-muted shrink-0">{suffix}</span>
        </div>
      </div>
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
    <div className="c-slide-in-l flex flex-col w-[300px] shrink-0 bg-cream border border-line rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-muted" strokeWidth={1.7} />
          <span className="text-[13px] font-semibold text-ink">Ajuster les filtres</span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-line text-muted hover:text-ink hover:bg-paper-2 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5">

        {/* SFDR */}
        <Section title="Classification SFDR">
          <div className="flex gap-2 flex-wrap">
            {[6, 8, 9].map((n) => (
              <SfdrPill
                key={n}
                label={`Art. ${n}`}
                active={(f.sfdr ?? []).includes(n)}
                onToggle={() => set("sfdr", toggleArr(f.sfdr, n))}
              />
            ))}
          </div>
        </Section>

        <Divider />

        {/* SRI */}
        <Section title={`SRI · ${f.sri_min ?? 1} → ${f.sri_max ?? 7}`}>
          <SriSlider
            min={f.sri_min ?? 1}
            max={f.sri_max ?? 7}
            onChangeMin={(v) => set("sri_min", v === 1 ? undefined : v)}
            onChangeMax={(v) => set("sri_max", v === 7 ? undefined : v)}
          />
        </Section>

        <Divider />

        {/* TER */}
        <Section title="TER max">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={String(f.ter_max ?? "")}
              onChange={(e) => set("ter_max", e.target.value ? +e.target.value : undefined)}
              placeholder="2,0"
              className="w-24 border border-line rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
            />
            <span className="text-[12px] text-muted">%</span>
          </div>
        </Section>

        <Divider />

        {/* Perf */}
        <Section title="Perf 1Y / 3Y min">
          <NumPairInputs
            labelA="Perf 1A ≥" labelB="Perf 3A ≥"
            valueA={String(f.perf_1y_min ?? "")} valueB={String(f.perf_3y_min ?? "")}
            onChangeA={(v) => set("perf_1y_min", v ? +v : undefined)}
            onChangeB={(v) => set("perf_3y_min", v ? +v : undefined)}
            placeholderA="0" placeholderB="0"
          />
        </Section>

        <Divider />

        {/* Volatilité / Sharpe */}
        <Section title="Volatilité / Sharpe">
          <NumPairInputs
            labelA="Vol max" labelB="Sharpe ≥"
            valueA={String(f.vol_max ?? "")} valueB={String(f.sharpe_min ?? "")}
            onChangeA={(v) => set("vol_max", v ? +v : undefined)}
            onChangeB={(v) => set("sharpe_min", v ? +v : undefined)}
            placeholderA="%" placeholderB="0"
            suffix=""
          />
        </Section>

        <Divider />

        {/* Taille / Track record */}
        <Section title="Taille / Ancienneté">
          <NumPairInputs
            labelA="AUM ≥ (M€)" labelB="Track rec. ≥"
            valueA={String(f.aum_min ?? "")} valueB={String(f.track_record_min ?? "")}
            onChangeA={(v) => set("aum_min", v ? +v : undefined)}
            onChangeB={(v) => set("track_record_min", v ? +v : undefined)}
            placeholderA="0" placeholderB="ans"
            suffix=""
          />
        </Section>

        <Divider />

        {/* Enveloppes */}
        <Section title="Enveloppes">
          <div className="flex gap-2 flex-wrap">
            {["PEA", "PEA-PME", "PER", "AV-FR", "AV-LUX", "CTO"].map((env) => (
              <SfdrPill
                key={env}
                label={env}
                active={(f.envelopes ?? []).includes(env)}
                onToggle={() => set("envelopes", toggleArr(f.envelopes, env))}
              />
            ))}
          </div>
        </Section>

        <Divider />

        {/* Secteur */}
        <Section title="Secteur">
          <div className="flex gap-1.5 flex-wrap">
            {[
              "Technologie", "Santé", "Finance", "Consommation",
              "Industrie", "Énergie", "Immobilier", "Environnement",
              "Communication", "Matériaux",
            ].map((s) => (
              <SfdrPill
                key={s}
                label={s}
                active={(f.sector ?? []).includes(s)}
                onToggle={() => set("sector", toggleArr(f.sector, s))}
              />
            ))}
          </div>
        </Section>

        <Divider />

        {/* Univers */}
        <Section title="Univers">
          <div className="flex gap-2 flex-wrap">
            {["opcvm", "etf", "scpi", "fps", "fonds_euros"].map((u) => (
              <SfdrPill
                key={u}
                label={u.toUpperCase()}
                active={(f.universe ?? []).includes(u)}
                onToggle={() => set("universe", toggleArr(f.universe, u))}
              />
            ))}
          </div>
        </Section>

        <Divider />

        {/* Morningstar */}
        <Section title="Notation Morningstar">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => set("morningstar_min", f.morningstar_min === n ? undefined : n)}
                className={`text-xl leading-none transition-colors ${
                  (f.morningstar_min ?? 0) >= n ? "text-warn" : "text-muted-2"
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </Section>

        <Divider />

        {/* Rétrocession CGP */}
        <Section title="Rétrocession CGP min">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              value={String(f.retrocession_min ?? "")}
              onChange={(e) => set("retrocession_min", e.target.value ? +e.target.value : undefined)}
              placeholder="0,5"
              className="w-24 border border-line rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
            />
            <span className="text-[12px] text-muted">%</span>
          </div>
        </Section>

        <Divider />

        {/* Gestionnaire */}
        <Section title="Gestionnaire">
          <input
            type="text"
            value={f.manager_search ?? ""}
            onChange={(e) => set("manager_search", e.target.value || undefined)}
            placeholder="Amundi, BlackRock…"
            className="w-full border border-line rounded-lg px-3 py-2 text-[12px] text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
          />
        </Section>

      </div>

      {/* Sticky footer */}
      <div className="px-5 py-3.5 border-t border-line flex gap-2 shrink-0 bg-cream">
        <Btn variant="ghost" size="sm" onClick={onReset} className="flex-1">
          Réinitialiser
        </Btn>
        <Btn variant="primary" size="sm" onClick={onApply} className="flex-1">
          Appliquer{resultCount != null ? ` · ${resultCount.toLocaleString("fr-FR")}` : ""}
        </Btn>
      </div>
    </div>
  );
}
