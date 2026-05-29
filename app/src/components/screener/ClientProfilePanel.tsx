"use client";

import React, { useRef, useState } from "react";
import { Btn } from "@/components/ui/Btn";
import { X, Upload, Loader2 } from "@/components/ui/icons";
import {
  type RichClientProfile,
  type RiskProfile,
  type EsgPref,
  type Objectif,
  type Tmi,
  type PerteMax,
  EMPTY_PROFILE,
} from "@/lib/clientProfile";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  profile: RichClientProfile;
  onChange: (p: RichClientProfile) => void;
  onClose: () => void;
  onSearch: () => void;
}

// ─── Pill helpers ─────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-muted uppercase tracking-widest font-medium mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function Pills<T extends string>({
  options,
  value,
  onToggle,
  multi = false,
}: {
  options: { value: T; label: string }[];
  value: T | T[] | null;
  onToggle: (v: T) => void;
  multi?: boolean;
}) {
  const isActive = (v: T) => {
    if (multi) return Array.isArray(value) && value.includes(v);
    return value === v;
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          onClick={() => onToggle(v)}
          className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
            isActive(v)
              ? "bg-accent-soft text-accent-ink border-accent/20"
              : "bg-paper text-muted border-line hover:border-line-soft hover:text-ink-2"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── File parsing helpers ─────────────────────────────────────────────────────

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file, "UTF-8");
  });
}

async function readExcelAsText(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(sheet);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClientProfilePanel({ profile, onChange, onClose, onSearch }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting]     = useState(false);
  const [importSource, setImportSource] = useState<string | null>(null);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function set<K extends keyof RichClientProfile>(key: K, val: RichClientProfile[K]) {
    onChange({ ...profile, [key]: val });
  }

  function toggleArray<K extends "envelopes" | "exclusions" | "asset_classes">(
    key: K,
    val: string,
  ) {
    const prev = profile[key] as string[];
    set(key, (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]) as RichClientProfile[K]);
  }

  function toggleRisk(v: RiskProfile) {
    set("risk_profile", profile.risk_profile === v ? null : v);
  }
  function toggleObjectif(v: Objectif) {
    set("objectif", profile.objectif === v ? null : v);
  }
  function togglePerteMax(v: PerteMax) {
    set("perte_max", profile.perte_max === v ? null : v);
  }
  function toggleTmi(v: Tmi) {
    set("tmi", profile.tmi === v ? null : v);
  }
  function toggleEsg(v: EsgPref) {
    set("esg", v);
  }
  function toggleHorizon(years: number) {
    set("horizon_years", profile.horizon_years === years ? null : years);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportSource(file.name);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let body: Record<string, string>;

      if (ext === "pdf") {
        const base64 = await readAsBase64(file);
        body = { file_base64: base64, file_type: "application/pdf" };
      } else if (ext === "xlsx" || ext === "xls") {
        const text = await readExcelAsText(file);
        body = { text };
      } else {
        const text = await readAsText(file);
        body = { text };
      }

      const res = await fetch("/api/parse-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const extracted = (await res.json()) as Partial<RichClientProfile>;
        onChange({ ...profile, ...extracted });
      }
    } catch {
      // Silently ignore — user can fill form manually
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-paper-2 rounded-xl border border-line px-5 py-4 space-y-4 max-h-[80vh] overflow-y-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-semibold text-ink-2 uppercase tracking-wider">
            Profil client
          </p>
          {importSource && !importing && (
            <span className="text-[10px] text-muted bg-paper border border-line rounded-full px-2 py-0.5 flex items-center gap-1">
              Importé — {importSource.slice(0, 30)}
              <button
                type="button"
                onClick={() => setImportSource(null)}
                className="hover:text-ink-2"
              >
                <X size={9} />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-line bg-paper text-ink-2 hover:bg-paper-2 transition-colors disabled:opacity-50"
          >
            {importing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Upload size={12} />
            )}
            {importing ? "Analyse…" : "Importer un fichier"}
          </button>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink-2 transition-colors">
            <X size={14} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.csv,.xlsx,.xls,.txt"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* ── Grid layout ── */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3.5">

        {/* Âge */}
        <div>
          <p className="text-[10px] text-muted uppercase tracking-widest font-medium mb-1.5">Âge du client</p>
          <input
            type="number"
            min={18}
            max={100}
            value={profile.age ?? ""}
            onChange={(e) => set("age", e.target.value ? Number(e.target.value) : null)}
            placeholder="ex: 45"
            className="w-28 border border-line rounded-lg px-3 py-1.5 text-[12px] bg-paper text-ink focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>

        {/* Montant */}
        <div>
          <p className="text-[10px] text-muted uppercase tracking-widest font-medium mb-1.5">Montant à investir (€)</p>
          <input
            type="number"
            min={0}
            value={profile.amount_eur ?? ""}
            onChange={(e) => set("amount_eur", e.target.value ? Number(e.target.value) : null)}
            placeholder="ex: 50 000"
            className="w-36 border border-line rounded-lg px-3 py-1.5 text-[12px] bg-paper text-ink focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>

      </div>

      {/* Horizon */}
      <Section label="Horizon de placement">
        <div className="flex flex-wrap gap-1.5">
          {([2, 5, 10, 15, 20] as const).map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => toggleHorizon(y)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
                profile.horizon_years === y
                  ? "bg-accent-soft text-accent-ink border-accent/20"
                  : "bg-paper text-muted border-line hover:border-line-soft hover:text-ink-2"
              }`}
            >
              {y === 2 ? "< 3 ans" : y === 20 ? "20 ans+" : `${y} ans`}
            </button>
          ))}
        </div>
      </Section>

      {/* Objectif */}
      <Section label="Objectif principal">
        <Pills
          options={[
            { value: "capitalisation", label: "Capitalisation" },
            { value: "revenus",        label: "Revenus réguliers" },
            { value: "retraite",       label: "Retraite" },
            { value: "transmission",   label: "Transmission" },
            { value: "defiscalisation",label: "Défiscalisation" },
          ]}
          value={profile.objectif}
          onToggle={toggleObjectif}
        />
      </Section>

      {/* Profil de risque */}
      <Section label="Profil de risque MIF">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { value: "prudent",   label: "Prudent",   sub: "SRI 1-3" },
              { value: "modere",    label: "Modéré",    sub: "SRI 2-4" },
              { value: "equilibre", label: "Équilibré", sub: "SRI 3-5" },
              { value: "dynamique", label: "Dynamique", sub: "SRI 4-6" },
              { value: "offensif",  label: "Offensif",  sub: "SRI 5-7" },
            ] as { value: RiskProfile; label: string; sub: string }[]
          ).map(({ value, label, sub }) => (
            <button
              key={value}
              type="button"
              onClick={() => toggleRisk(value)}
              className={`flex flex-col items-center px-3 py-2 rounded-xl text-[11px] font-medium border transition-colors min-w-[72px] ${
                profile.risk_profile === value
                  ? "bg-accent-soft text-accent-ink border-accent/20"
                  : "bg-paper text-muted border-line hover:border-line-soft hover:text-ink-2"
              }`}
            >
              <span>{label}</span>
              <span className={`text-[9px] mt-0.5 font-mono ${profile.risk_profile === value ? "text-accent-ink/70" : "text-muted-2"}`}>
                {sub}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {/* Tolérance aux pertes */}
      <Section label="Tolérance maximale aux pertes">
        <Pills
          options={[
            { value: "5",         label: "< 5 %" },
            { value: "10",        label: "< 10 %" },
            { value: "20",        label: "< 20 %" },
            { value: "30",        label: "< 30 %" },
            { value: "illimitee", label: "Sans limite" },
          ]}
          value={profile.perte_max}
          onToggle={togglePerteMax}
        />
      </Section>

      {/* Enveloppes */}
      <Section label="Enveloppes disponibles">
        <Pills
          options={[
            { value: "PEA",     label: "PEA" },
            { value: "PEA-PME", label: "PEA-PME" },
            { value: "PER",     label: "PER" },
            { value: "AV-FR",   label: "AV France" },
            { value: "AV-LUX",  label: "AV Luxembourg" },
            { value: "CTO",     label: "CTO" },
          ]}
          value={profile.envelopes}
          onToggle={(v) => toggleArray("envelopes", v)}
          multi
        />
      </Section>

      {/* TMI + ESG sur la même ligne */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3.5">
        <Section label="Tranche marginale (TMI)">
          <Pills
            options={[
              { value: "0",  label: "0 %" },
              { value: "11", label: "11 %" },
              { value: "30", label: "30 %" },
              { value: "41", label: "41 %" },
              { value: "45", label: "45 %" },
            ]}
            value={profile.tmi}
            onToggle={toggleTmi}
          />
        </Section>

        <Section label="Préférence ESG">
          <Pills
            options={[
              { value: "indifferent", label: "Indifférent" },
              { value: "art8",        label: "Art. 8+" },
              { value: "art9",        label: "Art. 9 uniquement" },
            ]}
            value={profile.esg}
            onToggle={toggleEsg}
          />
        </Section>
      </div>

      {/* Exclusions sectorielles */}
      <Section label="Exclusions sectorielles">
        <Pills
          options={[
            { value: "tabac",    label: "Tabac" },
            { value: "armes",    label: "Armes" },
            { value: "fossiles", label: "Fossiles" },
            { value: "jeux",     label: "Jeux" },
            { value: "alcool",   label: "Alcool" },
          ]}
          value={profile.exclusions}
          onToggle={(v) => toggleArray("exclusions", v)}
          multi
        />
      </Section>

      {/* Classes d'actifs souhaitées */}
      <Section label="Classes d'actifs souhaitées">
        <Pills
          options={[
            { value: "actions",         label: "Actions" },
            { value: "obligations",     label: "Obligations" },
            { value: "scpi",            label: "SCPI / Immo" },
            { value: "private_equity",  label: "Private Equity" },
            { value: "monetaire",       label: "Monétaire" },
            { value: "multi_actifs",    label: "Multi-actifs" },
          ]}
          value={profile.asset_classes}
          onToggle={(v) => toggleArray("asset_classes", v)}
          multi
        />
      </Section>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-line-soft">
        <button
          type="button"
          onClick={() => { onChange(EMPTY_PROFILE); setImportSource(null); }}
          className="text-[11px] text-muted hover:text-ink-2 transition-colors"
        >
          Effacer le profil
        </button>
        <Btn variant="primary" size="sm" onClick={() => { onClose(); onSearch(); }}>
          Rechercher avec ce profil
        </Btn>
      </div>
    </div>
  );
}
