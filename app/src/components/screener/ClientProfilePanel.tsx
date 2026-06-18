"use client";

import React, { useRef, useState } from "react";
import { Btn } from "@/components/ui/Btn";
import { X, Upload, Loader2 } from "@/components/ui/icons";
import { handledRateLimit } from "@/lib/rateLimitClient";
import { fileToParseBody } from "@/lib/profileImport";
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

function Chip({
  label, active, onClick,
}: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-meta font-medium border transition-all ${
        active
          ? "bg-brown text-paper border-brown shadow-sm"
          : "bg-paper text-ink-2 border-line hover:border-brown/30 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-label font-medium text-muted uppercase tracking-widest">{label}</p>
      {children}
    </div>
  );
}

// ─── Risk profile options ─────────────────────────────────────────────────────

const RISK_OPTIONS: { value: RiskProfile; label: string; desc: string; color: string }[] = [
  { value: "prudent",   label: "Prudent",   desc: "SRI 1–3", color: "text-ok" },
  { value: "modere",    label: "Modéré",    desc: "SRI 2–4", color: "text-ok" },
  { value: "equilibre", label: "Équilibré", desc: "SRI 3–5", color: "text-warn" },
  { value: "dynamique", label: "Dynamique", desc: "SRI 4–6", color: "text-warn" },
  { value: "offensif",  label: "Offensif",  desc: "SRI 5–7", color: "text-warn-dark" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ClientProfilePanel({ profile, onChange, onClose, onSearch }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting]       = useState(false);
  const [importSource, setImportSource] = useState<string | null>(null);
  const [dragging, setDragging]         = useState(false);

  // ─── Setters ──────────────────────────────────────────────────────────────

  function set<K extends keyof RichClientProfile>(key: K, val: RichClientProfile[K]) {
    onChange({ ...profile, [key]: val });
  }

  function toggleArray<K extends "envelopes" | "exclusions" | "asset_classes">(key: K, val: string) {
    const prev = profile[key] as string[];
    set(key, (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]) as RichClientProfile[K]);
  }

  function toggleOne<T>(current: T | null, val: T, setter: (v: T | null) => void) {
    setter(current === val ? null : val);
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  async function processFile(file: File) {
    setImporting(true);
    setImportSource(file.name);
    try {
      const body = await fileToParseBody(file);
      const res = await fetch("/api/parse-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (await handledRateLimit(res)) return;
      if (res.ok) {
        const extracted = (await res.json()) as Partial<RichClientProfile>;
        onChange({ ...profile, ...extracted });
      }
    } catch {
      // Silent — user can fill manually
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="bg-paper rounded-2xl border border-line shadow-lg overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-line bg-paper-2">
        <div className="flex items-center gap-3">
          <p className="text-meta font-semibold text-ink tracking-wide">Profil client</p>
          {importSource && !importing && (
            <span className="inline-flex items-center gap-1.5 text-caption text-ok bg-ok-soft border border-ok/20 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ok inline-block" />
              {importSource.length > 28 ? importSource.slice(0, 28) + "…" : importSource}
              <button type="button" onClick={() => setImportSource(null)} className="hover:text-ok/70">
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label font-medium border border-line bg-paper text-ink-2 hover:bg-cream hover:border-brown/30 transition-colors disabled:opacity-50"
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {importing ? "Analyse…" : "Importer"}
          </button>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-ink transition-colors rounded">
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

      {/* Drop overlay — activated during drag */}
      {dragging && (
        <div
          className="fixed inset-0 z-50 bg-accent/10 border-2 border-accent border-dashed rounded-2xl flex items-center justify-center"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
        >
          <p className="text-subhead font-medium text-accent">Relâchez pour importer</p>
        </div>
      )}

      {/* Body */}
      <div
        className="px-5 py-5 space-y-5 max-h-[70vh] overflow-y-auto"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      >

        {/* Infos de base */}
        <div className="grid grid-cols-2 gap-4">
          <FieldGroup label="Âge du client">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={18}
                max={100}
                value={profile.age ?? ""}
                onChange={(e) => set("age", e.target.value ? Number(e.target.value) : null)}
                placeholder="ex: 45"
                className="w-full border border-line rounded-lg px-3 py-2 text-body bg-paper text-ink placeholder:text-muted focus:outline-none focus:border-brown/50 transition-colors"
              />
            </div>
          </FieldGroup>

          <FieldGroup label="Montant (€)">
            <input
              type="number"
              min={0}
              value={profile.amount_eur ?? ""}
              onChange={(e) => set("amount_eur", e.target.value ? Number(e.target.value) : null)}
              placeholder="ex: 50 000"
              className="w-full border border-line rounded-lg px-3 py-2 text-body bg-paper text-ink placeholder:text-muted focus:outline-none focus:border-brown/50 transition-colors"
            />
          </FieldGroup>
        </div>

        {/* Horizon */}
        <FieldGroup label="Horizon de placement">
          <div className="flex flex-wrap gap-2">
            {([2, 5, 10, 15, 20] as const).map((y) => (
              <Chip
                key={y}
                label={y === 2 ? "< 3 ans" : y === 20 ? "20 ans+" : `${y} ans`}
                active={profile.horizon_years === y}
                onClick={() => toggleOne(profile.horizon_years, y, (v) => set("horizon_years", v))}
              />
            ))}
          </div>
        </FieldGroup>

        {/* Objectif */}
        <FieldGroup label="Objectif principal">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "capitalisation",  label: "Capitalisation" },
                { value: "revenus",         label: "Revenus" },
                { value: "retraite",        label: "Retraite" },
                { value: "transmission",    label: "Transmission" },
                { value: "defiscalisation", label: "Défiscalisation" },
              ] as { value: Objectif; label: string }[]
            ).map(({ value, label }) => (
              <Chip
                key={value}
                label={label}
                active={profile.objectif === value}
                onClick={() => toggleOne(profile.objectif, value, (v) => set("objectif", v))}
              />
            ))}
          </div>
        </FieldGroup>

        {/* Profil de risque */}
        <FieldGroup label="Profil de risque MIF">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {RISK_OPTIONS.map(({ value, label, desc, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleOne(profile.risk_profile, value, (v) => set("risk_profile", v))}
                className={`flex flex-col items-center justify-center px-2 py-3 rounded-xl border text-center transition-all ${
                  profile.risk_profile === value
                    ? "bg-brown text-paper border-brown shadow-sm"
                    : "bg-paper text-ink-2 border-line hover:border-brown/30"
                }`}
              >
                <span className="text-meta font-medium">{label}</span>
                <span className={`text-caption font-mono mt-0.5 ${profile.risk_profile === value ? "text-paper/70" : color}`}>
                  {desc}
                </span>
              </button>
            ))}
          </div>
        </FieldGroup>

        {/* Tolérance pertes + ESG */}
        <div className="grid grid-cols-2 gap-5">
          <FieldGroup label="Tolérance aux pertes">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "5",         label: "< 5 %" },
                  { value: "10",        label: "< 10 %" },
                  { value: "20",        label: "< 20 %" },
                  { value: "30",        label: "< 30 %" },
                  { value: "illimitee", label: "Sans limite" },
                ] as { value: PerteMax; label: string }[]
              ).map(({ value, label }) => (
                <Chip
                  key={value}
                  label={label}
                  active={profile.perte_max === value}
                  onClick={() => toggleOne(profile.perte_max, value, (v) => set("perte_max", v))}
                />
              ))}
            </div>
          </FieldGroup>

          <FieldGroup label="Préférence ESG">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "indifferent", label: "Indifférent" },
                  { value: "art8",        label: "Art. 8+" },
                  { value: "art9",        label: "Art. 9" },
                ] as { value: EsgPref; label: string }[]
              ).map(({ value, label }) => (
                <Chip
                  key={value}
                  label={label}
                  active={profile.esg === value}
                  onClick={() => set("esg", value)}
                />
              ))}
            </div>
          </FieldGroup>
        </div>

        {/* Enveloppes */}
        <FieldGroup label="Enveloppes disponibles">
          <div className="flex flex-wrap gap-2">
            {[
              { value: "PEA",     label: "PEA" },
              { value: "PEA-PME", label: "PEA-PME" },
              { value: "PER",     label: "PER" },
              { value: "AV-FR",   label: "AV France" },
              { value: "AV-LUX",  label: "AV Luxembourg" },
              { value: "CTO",     label: "CTO" },
            ].map(({ value, label }) => (
              <Chip
                key={value}
                label={label}
                active={profile.envelopes.includes(value)}
                onClick={() => toggleArray("envelopes", value)}
              />
            ))}
          </div>
        </FieldGroup>

        {/* TMI + Exclusions + Classes actifs */}
        <div className="grid grid-cols-2 gap-5">
          <FieldGroup label="Tranche marginale (TMI)">
            <div className="flex flex-wrap gap-2">
              {(["0", "11", "30", "41", "45"] as Tmi[]).map((v) => (
                <Chip
                  key={v}
                  label={`${v} %`}
                  active={profile.tmi === v}
                  onClick={() => toggleOne(profile.tmi, v, (val) => set("tmi", val))}
                />
              ))}
            </div>
          </FieldGroup>

          <FieldGroup label="Exclusions sectorielles">
            <div className="flex flex-wrap gap-2">
              {[
                { value: "tabac",    label: "Tabac" },
                { value: "armes",    label: "Armes" },
                { value: "fossiles", label: "Fossiles" },
                { value: "jeux",     label: "Jeux" },
                { value: "alcool",   label: "Alcool" },
              ].map(({ value, label }) => (
                <Chip
                  key={value}
                  label={label}
                  active={profile.exclusions.includes(value)}
                  onClick={() => toggleArray("exclusions", value)}
                />
              ))}
            </div>
          </FieldGroup>
        </div>

        {/* Classes d'actifs */}
        <FieldGroup label="Classes d'actifs souhaitées">
          <div className="flex flex-wrap gap-2">
            {[
              { value: "actions",        label: "Actions" },
              { value: "obligations",    label: "Obligations" },
              { value: "scpi",           label: "SCPI / Immo" },
              { value: "private_equity", label: "Private Equity" },
              { value: "monetaire",      label: "Monétaire" },
              { value: "multi_actifs",   label: "Multi-actifs" },
            ].map(({ value, label }) => (
              <Chip
                key={value}
                label={label}
                active={profile.asset_classes.includes(value)}
                onClick={() => toggleArray("asset_classes", value)}
              />
            ))}
          </div>
        </FieldGroup>

      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3.5 border-t border-line bg-paper-2">
        <button
          type="button"
          onClick={() => { onChange(EMPTY_PROFILE); setImportSource(null); }}
          className="text-label text-muted hover:text-ink transition-colors"
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
