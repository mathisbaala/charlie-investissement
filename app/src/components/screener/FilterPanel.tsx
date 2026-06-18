"use client";

import React, { useState, useEffect } from "react";
import { X, SlidersHorizontal, ChevronDown } from "@/components/ui/icons";
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
      <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold mb-3">
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
      className={`px-3.5 py-1.5 rounded-full text-meta font-medium border transition-colors ${
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
          <span key={n} className="text-caption text-muted-2 font-mono">{n}</span>
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
  const cls = "w-full border border-line rounded-lg px-2.5 py-1.5 text-meta font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2.5 text-caption text-muted uppercase tracking-wider font-semibold">
        <span>{labelA}</span>
        <span>{labelB}</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex items-center gap-1">
          <input type="number" value={valueA} onChange={(e) => onChangeA(e.target.value)}
            placeholder={placeholderA} className={cls} />
          <span className="text-label text-muted shrink-0">{suffix}</span>
        </div>
        <div className="flex items-center gap-1">
          <input type="number" value={valueB} onChange={(e) => onChangeB(e.target.value)}
            placeholder={placeholderB} className={cls} />
          <span className="text-label text-muted shrink-0">{suffix}</span>
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

  // Listes assureurs (référencement) + sociétés de gestion, chargées à la volée.
  const [insurerOptions, setInsurerOptions] = useState<{ company: string; funds: number }[]>([]);
  const [managerOptions, setManagerOptions] = useState<{ company: string; funds: number }[]>([]);
  const [contractOptions, setContractOptions] =
    useState<{ company: string; contract: string; key: string; funds: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = <T,>(url: string, set: (v: T[]) => void) =>
      fetch(url)
        .then((r) => r.ok ? r.json() : { data: [] })
        .then((j) => { if (!cancelled) set(j.data ?? []); })
        .catch(() => {});
    load("/api/screener/insurers", setInsurerOptions);
    load("/api/screener/managers", setManagerOptions);
    load("/api/screener/contracts", setContractOptions);
    return () => { cancelled = true; };
  }, []);

  // Assureur déplié (sélection par contrat) + assureurs dont on montre TOUS les contrats.
  const [expandedInsurer, setExpandedInsurer] = useState<string | null>(null);
  const [showAllContracts, setShowAllContracts] = useState<Record<string, boolean>>({});
  const CONTRACTS_PREVIEW = 10;

  return (
    <div className="c-slide-in-l flex flex-col shrink-0 bg-cream border border-line overflow-hidden fixed inset-0 z-[60] w-full rounded-none md:static md:z-auto md:inset-auto md:w-[300px] md:rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-muted" strokeWidth={1.7} />
          <span className="text-body font-semibold text-ink">Ajuster les filtres</span>
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
              className="w-24 border border-line rounded-lg px-2.5 py-1.5 text-meta font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
            />
            <span className="text-meta text-muted">%</span>
          </div>
        </Section>

        <Divider />

        {/* Frais d'entrée */}
        <Section title="Frais d'entrée">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => set("no_entry_fee", f.no_entry_fee ? undefined : true)}
              className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${f.no_entry_fee ? "bg-brown" : "bg-paper-3 border border-line"}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-paper shadow-sm transition-transform ${f.no_entry_fee ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-meta text-ink-2 group-hover:text-ink">Sans frais d&apos;entrée</span>
          </label>
        </Section>

        <Divider />

        {/* Perf */}
        <Section title="Perf 1Y / 3Y / 5Y min">
          <div className="space-y-2.5">
            <NumPairInputs
              labelA="Perf 1A ≥" labelB="Perf 3A ≥"
              valueA={String(f.perf_1y_min ?? "")} valueB={String(f.perf_3y_min ?? "")}
              onChangeA={(v) => set("perf_1y_min", v ? +v : undefined)}
              onChangeB={(v) => set("perf_3y_min", v ? +v : undefined)}
              placeholderA="0" placeholderB="0"
            />
            <div className="space-y-2">
              <div className="text-caption text-muted uppercase tracking-wider font-semibold">Perf 5A ≥</div>
              <div className="flex items-center gap-1 w-1/2 pr-1.5">
                <input
                  type="number"
                  value={String(f.perf_5y_min ?? "")}
                  onChange={(e) => set("perf_5y_min", e.target.value ? +e.target.value : undefined)}
                  placeholder="0"
                  className="w-full border border-line rounded-lg px-2.5 py-1.5 text-meta font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
                />
                <span className="text-label text-muted shrink-0">%</span>
              </div>
            </div>
          </div>
        </Section>

        <Divider />

        {/* Volatilité / Sharpe (1A + 3A) */}
        <Section title="Volatilité / Sharpe">
          <div className="space-y-2.5">
            <NumPairInputs
              labelA="Vol 1A max" labelB="Sharpe 1A ≥"
              valueA={String(f.vol_max ?? "")} valueB={String(f.sharpe_min ?? "")}
              onChangeA={(v) => set("vol_max", v ? +v : undefined)}
              onChangeB={(v) => set("sharpe_min", v ? +v : undefined)}
              placeholderA="%" placeholderB="0"
              suffix=""
            />
            <NumPairInputs
              labelA="Vol 3A max" labelB="Sharpe 3A ≥"
              valueA={String(f.vol_3y_max ?? "")} valueB={String(f.sharpe_3y_min ?? "")}
              onChangeA={(v) => set("vol_3y_max", v ? +v : undefined)}
              onChangeB={(v) => set("sharpe_3y_min", v ? +v : undefined)}
              placeholderA="%" placeholderB="0"
              suffix=""
            />
          </div>
        </Section>

        <Divider />

        {/* Perte max (drawdown 3 ans) */}
        <Section title="Perte max (3 ans)">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={String(f.drawdown_max ?? "")}
              onChange={(e) => set("drawdown_max", e.target.value ? Math.abs(+e.target.value) : undefined)}
              placeholder="20"
              className="w-24 border border-line rounded-lg px-2.5 py-1.5 text-meta font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
            />
            <span className="text-meta text-muted">% max</span>
          </div>
          <p className="text-caption text-muted-2 mt-2 leading-snug">
            Chute maximale tolérée sur 3 ans (ex. 20 = fonds n&apos;ayant pas perdu plus de 20%).
          </p>
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

        {/* Assureur + contrat (référencement) */}
        {insurerOptions.length > 0 && (
          <>
            <Section title="Référencé chez (assureur / contrat)">
              <div className="space-y-1.5">
                {insurerOptions.map(({ company, funds }) => {
                  const contracts = contractOptions.filter((c) => c.company === company);
                  const expanded = expandedInsurer === company;
                  const selContracts = (f.contracts ?? []).filter((k) => k.startsWith(`${company}::`));
                  const showAll = showAllContracts[company];
                  const shown = showAll ? contracts : contracts.slice(0, CONTRACTS_PREVIEW);
                  return (
                    <div key={company}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => set("insurers", toggleArr(f.insurers, company))}
                          className={`px-3 py-1.5 rounded-full text-meta font-medium border transition-colors ${
                            (f.insurers ?? []).includes(company)
                              ? "bg-brown text-paper border-brown"
                              : "bg-paper-2 text-ink-2 border-line hover:border-accent/30"
                          }`}
                        >
                          {company} ({funds})
                          {selContracts.length > 0 && (
                            <span className="ml-1 opacity-70">
                              · {selContracts.length} contrat{selContracts.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </button>
                        {contracts.length > 0 && (
                          <button
                            onClick={() => setExpandedInsurer(expanded ? null : company)}
                            aria-label={`Contrats ${company}`}
                            className={`w-6 h-6 flex items-center justify-center rounded-md border transition-colors shrink-0 ${
                              expanded || selContracts.length > 0
                                ? "border-accent/40 text-accent"
                                : "border-line text-muted hover:text-ink"
                            }`}
                          >
                            <ChevronDown size={13} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
                          </button>
                        )}
                      </div>

                      {expanded && contracts.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap mt-1.5 pl-2 ml-1 border-l border-line-soft">
                          {shown.map((c) => (
                            <SfdrPill
                              key={c.key}
                              label={`${c.contract} (${c.funds})`}
                              active={(f.contracts ?? []).includes(c.key)}
                              onToggle={() => set("contracts", toggleArr(f.contracts, c.key))}
                            />
                          ))}
                          {contracts.length > CONTRACTS_PREVIEW && (
                            <button
                              onClick={() => setShowAllContracts((s) => ({ ...s, [company]: !showAll }))}
                              className="text-label px-2 py-1 text-accent hover:underline"
                            >
                              {showAll ? "Réduire" : `+${contracts.length - CONTRACTS_PREVIEW} contrats`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-caption text-muted-2 mt-2 leading-snug">
                Cliquez sur l&apos;assureur pour le sélectionner, ou sur le chevron pour filtrer par contrat
                précis. Donnée partielle — l&apos;absence ne signifie pas non-référencement.
              </p>
            </Section>

            <Divider />
          </>
        )}

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

        {/* Classe d'actif */}
        <Section title="Classe d'actif">
          <div className="flex gap-1.5 flex-wrap">
            {[
              { val: "action",            label: "Actions" },
              { val: "obligation",        label: "Obligataire" },
              { val: "diversifie",        label: "Diversifié" },
              { val: "monetaire",         label: "Monétaire" },
              { val: "immobilier",        label: "Immobilier" },
              { val: "matieres_premieres",label: "Matières prem." },
              { val: "alternatif",        label: "Alternatif" },
            ].map(({ val, label }) => (
              <SfdrPill
                key={val}
                label={label}
                active={(f.asset_class ?? []).includes(val)}
                onToggle={() => set("asset_class", toggleArr(f.asset_class, val))}
              />
            ))}
          </div>
        </Section>

        <Divider />

        {/* Univers */}
        <Section title="Univers (type de produit)">
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

        {/* Zone géographique */}
        <Section title="Zone géographique">
          <div className="flex gap-1.5 flex-wrap">
            {[
              { val: "world",       label: "Monde" },
              { val: "europe",      label: "Europe" },
              { val: "eurozone",    label: "Zone euro" },
              { val: "usa",         label: "USA" },
              { val: "france",      label: "France" },
              { val: "emerging",    label: "Émergents" },
              { val: "japan",       label: "Japon" },
              { val: "asia",        label: "Asie" },
              { val: "china",       label: "Chine" },
              { val: "uk",          label: "Royaume-Uni" },
              { val: "germany",     label: "Allemagne" },
              { val: "switzerland", label: "Suisse" },
              { val: "india",       label: "Inde" },
              { val: "brazil",      label: "Brésil" },
            ].map(({ val, label }) => (
              <SfdrPill
                key={val}
                label={label}
                active={(f.region ?? []).includes(val)}
                onToggle={() => set("region", toggleArr(f.region, val))}
              />
            ))}
          </div>
        </Section>

        <Divider />

        {/* Style de gestion */}
        <Section title="Style de gestion">
          <div className="flex gap-2 flex-wrap">
            {[
              { val: "passif",     label: "Passif (index)" },
              { val: "actif",      label: "Actif" },
              { val: "smart_beta", label: "Smart beta" },
              { val: "alternatif", label: "Alternatif" },
            ].map(({ val, label }) => (
              <SfdrPill
                key={val}
                label={label}
                active={(f.management_style ?? []).includes(val)}
                onToggle={() => set("management_style", toggleArr(f.management_style, val))}
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
                className={`text-title-lg leading-none transition-colors ${
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
              className="w-24 border border-line rounded-lg px-2.5 py-1.5 text-meta font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
            />
            <span className="text-meta text-muted">%</span>
          </div>
        </Section>

        <Divider />

        {/* DICI */}
        <Section title="Document DICI">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => set("has_kid", f.has_kid ? undefined : true)}
              className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${f.has_kid ? "bg-brown" : "bg-paper-3 border border-line"}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-paper shadow-sm transition-transform ${f.has_kid ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-meta text-ink-2 group-hover:text-ink">DICI disponible uniquement</span>
          </label>
        </Section>

        <Divider />

        {/* Société de gestion */}
        <Section title="Société de gestion">
          {managerOptions.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-2.5">
              {managerOptions.map(({ company, funds }) => (
                <SfdrPill
                  key={company}
                  label={`${company} (${funds})`}
                  active={(f.gestionnaires ?? []).includes(company)}
                  onToggle={() => set("gestionnaires", toggleArr(f.gestionnaires, company))}
                />
              ))}
            </div>
          )}
          <input
            type="text"
            value={f.manager_search ?? ""}
            onChange={(e) => set("manager_search", e.target.value || undefined)}
            placeholder="Autre société de gestion…"
            className="w-full border border-line rounded-lg px-3 py-2 text-meta text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
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
