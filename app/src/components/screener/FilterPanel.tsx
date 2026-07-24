"use client";

import React, { useState, useEffect } from "react";
import { X, SlidersHorizontal, ChevronDown } from "@/components/ui/icons";
import { Btn } from "@/components/ui/Btn";
import type { ParsedFilters } from "@/lib/types";
import { OFFICIAL_LABELS } from "@/lib/sustainability";
import { loadStoredCabinet } from "@/lib/cabinet";
import { EntityMultiSelect } from "./EntityMultiSelect";

interface FilterPanelProps {
  filters: ParsedFilters;
  onChange: (f: ParsedFilters) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
  // Libellé du bouton primaire du pied. « Appliquer » dans le screener (on reste
  // sur place) ; « Lancer la recherche » depuis l'accueil (on navigue vers /recherche).
  applyLabel?: string;
  // Largeur du panneau sur ≥ md. 300px en colonne du screener ; élargi en tiroir
  // depuis l'accueil (où il s'ouvre par-dessus, avec plus de place à gauche).
  mdWidthClass?: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-3.5">
      <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold mb-3">
        {title}
      </p>
      {children}
    </div>
  );
}

// Famille de filtres repliable. On regroupe les ~24 réglages en 6 familles pour
// éviter le mur à scroller : on ouvre l'essentiel, on replie le reste. Le compteur
// signale les filtres actifs cachés dans une famille repliée.
function Group({
  title, count, defaultOpen, children,
}: { title: string; count: number; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-3.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-body font-semibold text-ink">{title}</span>
          {count > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-brown text-paper text-caption font-semibold leading-none">
              {count}
            </span>
          )}
        </span>
        <ChevronDown
          size={15}
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="pb-1">{children}</div>}
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

// Millésimes proposés pour le filtre « fonds à échéance ». Couverture réelle en base :
// 2024→2036 ; on étend jusqu'à 2040 pour absorber les nouveaux lancements.
const MATURITY_YEARS = Array.from({ length: 2040 - 2024 + 1 }, (_, i) => 2024 + i);

const normalizeName = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Ordonne la liste « Référencé chez » : les assureurs partenaires du cabinet
 * (onglet Mon cabinet) d'abord — pastille « Partenaire » —, les autres ensuite
 * sous un intitulé dédié. Contrairement à l'allocation (périmètre strict), la
 * RECHERCHE garde tout l'univers consultable. Exportée pour les tests.
 */
export function orderInsurersByPartners<T extends { company: string }>(
  options: T[],
  partners: string[],
): { partnerRows: T[]; otherRows: T[] } {
  const set = new Set(partners.map(normalizeName));
  return {
    partnerRows: options.filter((o) => set.has(normalizeName(o.company))),
    otherRows: options.filter((o) => !set.has(normalizeName(o.company))),
  };
}

const CONTRACTS_PREVIEW = 10;

export function FilterPanel({
  filters, onChange, onApply, onReset, onClose, applyLabel = "Appliquer",
  mdWidthClass = "md:w-[300px]",
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

  // Assureurs dont on montre TOUS les contrats (au-delà de l'aperçu).
  const [showAllContracts, setShowAllContracts] = useState<Record<string, boolean>>({});

  // Assureurs partenaires (onglet Mon cabinet, localStorage) : proposés d'emblée
  // dans le sélecteur « Référencement », le reste de l'univers passe par la frappe.
  const [partnerInsurers, setPartnerInsurers] = useState<string[]>([]);
  useEffect(() => { setPartnerInsurers(loadStoredCabinet().insurers); }, []);

  // Options pour les sélecteurs typeahead (assureurs + sociétés de gestion).
  const insurerOpts = insurerOptions.map((o) => ({ value: o.company, label: o.company, count: o.funds }));
  const managerOpts = managerOptions.map((o) => ({ value: o.company, label: o.company, count: o.funds }));
  const partnerSet = new Set(partnerInsurers.map(normalizeName));
  const partnerSuggest = insurerOpts.filter((o) => partnerSet.has(normalizeName(o.value)));

  // Contrats d'un assureur sélectionné, en sous-choix (aperçu + « voir plus »).
  function contractsFor(company: string) {
    const contracts = contractOptions.filter((c) => c.company === company);
    if (contracts.length === 0) return null;
    const showAll = showAllContracts[company];
    const shown = showAll ? contracts : contracts.slice(0, CONTRACTS_PREVIEW);
    return (
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
    );
  }

  // Compteurs de filtres actifs par famille (badge sur l'en-tête replié).
  const isSet = (v: unknown) =>
    Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "" && v !== false;
  const countOf = (...keys: (keyof ParsedFilters)[]) => keys.filter((k) => isSet(f[k])).length;
  const sriActive = isSet(f.sri_min) || isSet(f.sri_max) ? 1 : 0;

  const gType = countOf(
    "universe", "asset_class", "allocation_profile", "sector", "region",
    "management_style", "target_maturity", "aum_min", "track_record_min",
  );
  const gPerf = countOf(
    "perf_1y_min", "perf_3y_min", "perf_5y_min", "vol_max", "sharpe_min",
    "vol_3y_max", "sharpe_3y_min", "drawdown_max", "morningstar_min",
    "beats_benchmark", "has_kid",
  ) + sriActive;
  const gFees = countOf("ter_max", "no_entry_fee", "retrocession_min");
  const gDistrib = countOf("envelopes", "insurers", "contracts", "gestionnaires", "manager_search");
  const gEsg = countOf("sfdr", "labels");
  const gTax = countOf("tax_schemes");

  return (
    <div className={`c-slide-in-l flex flex-col shrink-0 bg-cream border border-line overflow-hidden fixed inset-0 z-[60] w-full rounded-none md:static md:z-auto md:inset-auto ${mdWidthClass} md:rounded-xl`}>
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

        {/* ── Type & univers ─────────────────────────────────────────── */}
        <Group title="Type & univers" count={gType} defaultOpen>
          <Section title="Univers (type de produit)">
            <div className="flex gap-2 flex-wrap">
              {[
                { val: "opcvm",       label: "OPCVM" },
                { val: "etf",         label: "ETF" },
                { val: "scpi",        label: "SCPI" },
                { val: "fps",         label: "FPS" },
                { val: "fonds_euros", label: "Fonds euros" },
                { val: "action",      label: "Actions" },
                { val: "crypto",      label: "Crypto" },
                { val: "structuré",   label: "Structurés" },
                { val: "fcpr",        label: "FCPR" },
                { val: "fcpi",        label: "FCPI" },
                { val: "fip",         label: "FIP" },
                { val: "fpci",        label: "FPCI" },
              ].map(({ val, label }) => (
                <SfdrPill
                  key={val}
                  label={label}
                  active={(f.universe ?? []).includes(val)}
                  onToggle={() => set("universe", toggleArr(f.universe, val))}
                />
              ))}
            </div>
          </Section>

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

          {/* Profil d'allocation — sous-classe des diversifiés (prudent → flexible).
              Affiché quand « Diversifié » est sélectionné. Heuristique partielle :
              filtre opt-in, n'écarte rien tant qu'il est vide. */}
          {(f.asset_class ?? []).includes("diversifie") && (
            <Section title="Profil d'allocation">
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { val: "prudent",   label: "Prudent" },
                  { val: "equilibre", label: "Équilibré" },
                  { val: "dynamique", label: "Dynamique" },
                  { val: "flexible",  label: "Flexible" },
                ].map(({ val, label }) => (
                  <SfdrPill
                    key={val}
                    label={label}
                    active={(f.allocation_profile ?? []).includes(val)}
                    onToggle={() => set("allocation_profile", toggleArr(f.allocation_profile, val))}
                  />
                ))}
              </div>
            </Section>
          )}

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

          <Section title="Style de gestion">
            <div className="flex gap-2 flex-wrap">
              {[
                { val: "passif",     label: "Passif (indiciel)" },
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

          {/* Fonds obligataires datés (à échéance) */}
          <Section title="Fonds à échéance">
            <button
              type="button"
              role="switch"
              aria-checked={!!f.target_maturity}
              onClick={() =>
                f.target_maturity
                  ? onChange({ ...f, target_maturity: undefined, maturity_year_min: undefined, maturity_year_max: undefined })
                  : set("target_maturity", true)
              }
              className="flex items-center gap-3 cursor-pointer group w-full text-left"
            >
              <div
                className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${f.target_maturity ? "bg-brown" : "bg-paper-3 border border-line"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-paper shadow-sm transition-transform ${f.target_maturity ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
              <span className="text-meta text-ink-2 group-hover:text-ink">Obligataires datés uniquement</span>
            </button>

            {f.target_maturity && (
              <div className="grid grid-cols-2 gap-2.5 mt-3">
                <div className="space-y-1.5">
                  <div className="text-caption text-muted uppercase tracking-wider font-semibold">Échéance de</div>
                  <select
                    value={f.maturity_year_min ?? ""}
                    onChange={(e) => set("maturity_year_min", e.target.value ? +e.target.value : undefined)}
                    className="w-full border border-line rounded-lg px-2.5 py-1.5 text-meta font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
                  >
                    <option value="">Toutes</option>
                    {MATURITY_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <div className="text-caption text-muted uppercase tracking-wider font-semibold">à</div>
                  <select
                    value={f.maturity_year_max ?? ""}
                    onChange={(e) => set("maturity_year_max", e.target.value ? +e.target.value : undefined)}
                    className="w-full border border-line rounded-lg px-2.5 py-1.5 text-meta font-mono text-ink bg-paper focus:outline-none focus:border-accent/50 transition-colors"
                  >
                    <option value="">Toutes</option>
                    {MATURITY_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            )}
          </Section>

          <Section title="Taille / Ancienneté">
            <NumPairInputs
              labelA="Encours ≥ (M€)" labelB="Ancienneté ≥"
              valueA={String(f.aum_min ?? "")} valueB={String(f.track_record_min ?? "")}
              onChangeA={(v) => set("aum_min", v ? +v : undefined)}
              onChangeB={(v) => set("track_record_min", v ? +v : undefined)}
              placeholderA="0" placeholderB="ans"
              suffix=""
            />
          </Section>
        </Group>

        {/* ── Performance & risque ────────────────────────────────────── */}
        <Group title="Performance & risque" count={gPerf} defaultOpen={gPerf > 0}>
          <Section title="Perf 1A / 3A / 5A min">
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
          </Section>

          <Section title={`SRI · ${f.sri_min ?? 1} → ${f.sri_max ?? 7}`}>
            <SriSlider
              min={f.sri_min ?? 1}
              max={f.sri_max ?? 7}
              onChangeMin={(v) => set("sri_min", v === 1 ? undefined : v)}
              onChangeMax={(v) => set("sri_max", v === 7 ? undefined : v)}
            />
          </Section>

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

          <Section title="Performance vs indice">
            <button
              type="button"
              role="switch"
              aria-checked={!!f.beats_benchmark}
              onClick={() => set("beats_benchmark", f.beats_benchmark ? undefined : true)}
              className="flex items-center gap-3 cursor-pointer group w-full text-left"
            >
              <div
                className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${f.beats_benchmark ? "bg-brown" : "bg-paper-3 border border-line"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-paper shadow-sm transition-transform ${f.beats_benchmark ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
              <span className="text-meta text-ink-2 group-hover:text-ink">Bat son indice (alpha 3 ans &gt; 0)</span>
            </button>
          </Section>

          <Section title="Document DICI">
            <button
              type="button"
              role="switch"
              aria-checked={!!f.has_kid}
              onClick={() => set("has_kid", f.has_kid ? undefined : true)}
              className="flex items-center gap-3 cursor-pointer group w-full text-left"
            >
              <div
                className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${f.has_kid ? "bg-brown" : "bg-paper-3 border border-line"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-paper shadow-sm transition-transform ${f.has_kid ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
              <span className="text-meta text-ink-2 group-hover:text-ink">DICI disponible uniquement</span>
            </button>
          </Section>
        </Group>

        {/* ── Frais & rémunération ────────────────────────────────────── */}
        <Group title="Frais & rémunération" count={gFees} defaultOpen={gFees > 0}>
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

          <Section title="Frais d'entrée">
            <button
              type="button"
              role="switch"
              aria-checked={!!f.no_entry_fee}
              onClick={() => set("no_entry_fee", f.no_entry_fee ? undefined : true)}
              className="flex items-center gap-3 cursor-pointer group w-full text-left"
            >
              <div
                className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${f.no_entry_fee ? "bg-brown" : "bg-paper-3 border border-line"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-paper shadow-sm transition-transform ${f.no_entry_fee ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
              <span className="text-meta text-ink-2 group-hover:text-ink">Sans frais d&apos;entrée</span>
            </button>
          </Section>

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
        </Group>

        {/* ── Distribution & référencement ────────────────────────────── */}
        <Group title="Distribution & référencement" count={gDistrib} defaultOpen={gDistrib > 0}>
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

          {/* Référencement : assureur au typeahead (partenaires proposés d'emblée),
              contrats en sous-choix sous l'assureur sélectionné. */}
          {insurerOpts.length > 0 && (
            <Section title="Référencement (assureur / contrat)">
              <EntityMultiSelect
                placeholder="Rechercher un assureur…"
                options={insurerOpts}
                selected={f.insurers ?? []}
                onToggle={(v) => set("insurers", toggleArr(f.insurers, v))}
                emptySuggestions={partnerSuggest}
                emptyHeader="Vos partenaires"
                renderChildren={contractsFor}
              />
            </Section>
          )}

          {/* Société de gestion : typeahead sur les principales, recherche libre en
              repli pour les sociétés hors liste (colonne manager_search). */}
          <Section title="Société de gestion">
            <EntityMultiSelect
              placeholder="Rechercher une société de gestion…"
              options={managerOpts}
              selected={f.gestionnaires ?? []}
              onToggle={(v) => set("gestionnaires", toggleArr(f.gestionnaires, v))}
              freeText={{
                value: f.manager_search,
                onChange: (v) => set("manager_search", v || undefined),
                suggestPrefix: "Rechercher partout :",
                chipSuffix: "recherche libre",
              }}
            />
          </Section>
        </Group>

        {/* ── Durabilité ──────────────────────────────────────────────── */}
        <Group title="Durabilité" count={gEsg} defaultOpen={gEsg > 0}>
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

          <Section title="Labels durabilité">
            <div className="flex gap-2 flex-wrap">
              {OFFICIAL_LABELS.map((l) => (
                <SfdrPill
                  key={l.key}
                  label={l.label}
                  active={(f.labels ?? []).includes(l.key)}
                  onToggle={() => set("labels", toggleArr(f.labels, l.key))}
                />
              ))}
            </div>
          </Section>
        </Group>

        {/* ── Fiscalité ───────────────────────────────────────────────── */}
        <Group title="Fiscalité" count={gTax} defaultOpen={gTax > 0}>
          {/* Défiscalisation (colonne tax_scheme). Scindée par NATURE de l'avantage
              fiscal : réduction d'IR à l'entrée (FIP/FCPI, régime ir_pme) vs report /
              exonération de plus-value (FPCI/FCPR, 150-0 B ter). Les deux alimentent
              le même filtre tax_schemes → tax_scheme. */}
          <Section title="Défiscalisation">
            <p className="text-meta text-muted mb-1.5">Réduction d’impôt (IR-PME)</p>
            <div className="flex gap-2 flex-wrap">
              {[
                { val: "fip",          label: "FIP" },
                { val: "fip_corse",    label: "FIP Corse" },
                { val: "fip_outremer", label: "FIP Outre-mer" },
                { val: "fcpi",         label: "FCPI" },
              ].map(({ val, label }) => (
                <SfdrPill
                  key={val}
                  label={label}
                  active={(f.tax_schemes ?? []).includes(val)}
                  onToggle={() => set("tax_schemes", toggleArr(f.tax_schemes, val))}
                />
              ))}
            </div>
            <p className="text-meta text-muted mb-1.5 mt-3">Report / exonération de plus-value</p>
            <div className="flex gap-2 flex-wrap">
              {[
                { val: "fpci", label: "FPCI" },
                { val: "fcpr", label: "FCPR" },
              ].map(({ val, label }) => (
                <SfdrPill
                  key={val}
                  label={label}
                  active={(f.tax_schemes ?? []).includes(val)}
                  onToggle={() => set("tax_schemes", toggleArr(f.tax_schemes, val))}
                />
              ))}
            </div>
          </Section>
        </Group>

      </div>

      {/* Sticky footer */}
      <div className="px-5 py-3.5 border-t border-line flex gap-2 shrink-0 bg-cream">
        <Btn variant="ghost" size="sm" onClick={onReset} className="flex-1">
          Réinitialiser
        </Btn>
        <Btn variant="primary" size="sm" onClick={onApply} className="flex-1">
          {applyLabel}
        </Btn>
      </div>
    </div>
  );
}
