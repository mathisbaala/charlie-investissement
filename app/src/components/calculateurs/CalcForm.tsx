"use client";

// Formulaire dynamique d'un calculateur : rendu par type de champ, champs
// conditionnels (showIf), défauts appliqués au calcul. Les champs pré-remplis
// par l'IA sont marqués — le CGP garde la main sur chaque valeur.

import { useMemo } from "react";
import { Btn } from "@/components/ui/Btn";
import { Chip } from "@/components/ui/Chip";
import type { CalculatorDef, CalcResult, CalcValues, FieldDef } from "@/lib/calculators/types";
import { activeFields, missingFields, withDefaults } from "@/lib/calculators/types";

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: CalcValues[string];
  onChange: (v: CalcValues[string]) => void;
}) {
  const base =
    "w-full rounded-lg border border-line bg-paper px-3 py-2 text-body text-ink placeholder:text-muted focus:outline-none focus:border-brown/50";

  switch (field.type) {
    case "enum": {
      const opts = field.options ?? [];
      // Peu d'options → rangée de chips (canon de l'app) ; sinon un select.
      if (opts.length <= 4) {
        return (
          <div className="flex flex-wrap gap-2">
            {opts.map((o) => (
              <Chip key={o.value} active={value === o.value} onClick={() => onChange(o.value)}>
                {o.label}
              </Chip>
            ))}
          </div>
        );
      }
      return (
        <select
          className={base}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">— Choisir —</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "bool":
      return (
        <div className="flex gap-2">
          <Chip active={value === true} onClick={() => onChange(true)}>
            Oui
          </Chip>
          <Chip active={value === false || value === undefined} onClick={() => onChange(false)}>
            Non
          </Chip>
        </div>
      );
    case "date":
      return (
        <input
          type="date"
          className={base}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    default: {
      // eur / pct / int : champ numérique avec unité.
      const unit = field.type === "eur" ? "€" : field.type === "pct" ? "%" : null;
      return (
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            className={`${base} ${unit ? "pr-8" : ""}`}
            value={typeof value === "number" ? value : ""}
            min={field.min}
            max={field.max}
            placeholder={field.default !== undefined ? String(field.default) : undefined}
            onChange={(e) => {
              const n = e.target.value === "" ? undefined : Number(e.target.value);
              onChange(n !== undefined && Number.isFinite(n) ? n : undefined);
            }}
          />
          {unit && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-meta text-muted">{unit}</span>
          )}
        </div>
      );
    }
  }
}

export function CalcForm({
  def,
  values,
  aiKeys,
  onChange,
  onResult,
}: {
  def: CalculatorDef;
  values: CalcValues;
  aiKeys: Set<string>;
  onChange: (v: CalcValues) => void;
  onResult: (r: CalcResult) => void;
}) {
  const fields = useMemo(() => activeFields(def, values), [def, values]);
  const missing = useMemo(() => missingFields(def, values), [def, values]);

  const compute = () => {
    if (missing.length > 0) return;
    onResult(def.compute(withDefaults(def, values)));
  };

  return (
    <div>
      <div className="grid sm:grid-cols-2 gap-x-5 gap-y-4">
        {fields.map((f) => {
          const isMissing = missing.some((m) => m.key === f.key);
          return (
            <div key={f.key}>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-meta font-medium text-ink-2">{f.label}</label>
                {aiKeys.has(f.key) && values[f.key] !== undefined && (
                  <span className="text-caption uppercase tracking-widest text-brown font-semibold">
                    pré-rempli
                  </span>
                )}
                {isMissing && (
                  <span className="text-caption uppercase tracking-widest text-danger font-semibold">
                    requis
                  </span>
                )}
              </div>
              <FieldInput
                field={f}
                value={values[f.key]}
                onChange={(v) => onChange({ ...values, [f.key]: v })}
              />
              {f.help && <p className="text-caption text-muted mt-1">{f.help}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Btn variant="primary" size="lg" onClick={compute} disabled={missing.length > 0}>
          Calculer
        </Btn>
        {missing.length > 0 && (
          <p className="text-meta text-muted">
            {missing.length} champ{missing.length > 1 ? "s" : ""} à renseigner
          </p>
        )}
      </div>
    </div>
  );
}
