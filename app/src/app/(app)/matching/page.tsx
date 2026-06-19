"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { PageShell, PageHeader } from "@/components/ui/Page";
import { Btn } from "@/components/ui/Btn";
import { Upload, Loader2, X, ArrowRight, Check } from "@/components/ui/icons";
import { handledRateLimit } from "@/lib/rateLimitClient";
import { parseProfileFromFile } from "@/lib/profileImport";
import { buildParams, describeScreenerFilters } from "@/lib/screenerParams";
import {
  type RichClientProfile,
  type RiskProfile,
  type EsgPref,
  type Objectif,
  type Tmi,
  type PerteMax,
  type Experience,
  type ManagementPref,
  EMPTY_PROFILE,
  loadStoredProfile,
  saveStoredProfile,
  isProfileActive,
  profileToScreenerFilters,
} from "@/lib/clientProfile";

// ─── Petits composants de formulaire ──────────────────────────────────────────

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-2 rounded-lg text-meta font-medium border transition-all ${
        active
          ? "bg-brown text-paper border-brown shadow-sm"
          : "bg-paper text-ink-2 border-line hover:border-brown/30 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-label font-medium text-muted uppercase tracking-widest">{label}</p>
      {children}
      {hint && <p className="text-caption text-muted-2 leading-snug">{hint}</p>}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 space-y-5">
      <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold">{title}</p>
      {children}
    </Card>
  );
}

const RISK_OPTIONS: { value: RiskProfile; label: string; desc: string; color: string }[] = [
  { value: "prudent",   label: "Prudent",   desc: "SRI 1–3", color: "text-ok" },
  { value: "modere",    label: "Modéré",    desc: "SRI 2–4", color: "text-ok" },
  { value: "equilibre", label: "Équilibré", desc: "SRI 3–5", color: "text-warn" },
  { value: "dynamique", label: "Dynamique", desc: "SRI 4–6", color: "text-warn" },
  { value: "offensif",  label: "Offensif",  desc: "SRI 5–7", color: "text-warn-dark" },
];

const OBJ_OPTIONS: { value: Objectif; label: string }[] = [
  { value: "capitalisation",  label: "Capitalisation" },
  { value: "revenus",         label: "Revenus" },
  { value: "retraite",        label: "Retraite" },
  { value: "transmission",    label: "Transmission" },
  { value: "defiscalisation", label: "Défiscalisation" },
];

const ESG_OPTIONS: { value: EsgPref; label: string }[] = [
  { value: "indifferent", label: "Indifférent" },
  { value: "art8",        label: "Art. 8+" },
  { value: "art9",        label: "Art. 9" },
  { value: "labelise",    label: "Labellisé" },
];

const EXP_OPTIONS: { value: Experience; label: string }[] = [
  { value: "novice",      label: "Novice" },
  { value: "informe",     label: "Informé" },
  { value: "experimente", label: "Expérimenté" },
];

const MGMT_OPTIONS: { value: ManagementPref; label: string }[] = [
  { value: "actif",  label: "Gestion active" },
  { value: "passif", label: "Indicielle (ETF)" },
];

const TER_OPTIONS: { value: number; label: string }[] = [
  { value: 0.5, label: "< 0,5 %" },
  { value: 1,   label: "< 1 %" },
  { value: 1.5, label: "< 1,5 %" },
  { value: 2,   label: "< 2 %" },
];

const ENVELOPE_OPTIONS = [
  { value: "PEA",     label: "PEA" },
  { value: "PEA-PME", label: "PEA-PME" },
  { value: "PER",     label: "PER" },
  { value: "AV-FR",   label: "AV France" },
  { value: "AV-LUX",  label: "AV Luxembourg" },
  { value: "CTO",     label: "CTO" },
];

const ASSET_OPTIONS = [
  { value: "actions",        label: "Actions" },
  { value: "obligations",    label: "Obligations" },
  { value: "scpi",           label: "SCPI / Immo" },
  { value: "private_equity", label: "Private Equity" },
  { value: "monetaire",      label: "Monétaire" },
  { value: "multi_actifs",   label: "Multi-actifs" },
];

const EXCLUSION_OPTIONS = [
  { value: "tabac",    label: "Tabac" },
  { value: "armes",    label: "Armes" },
  { value: "fossiles", label: "Fossiles" },
  { value: "jeux",     label: "Jeux" },
  { value: "alcool",   label: "Alcool" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilClientPage() {
  const router = useRouter();

  // Profil PARTAGÉ (localStorage) : même objet que la pastille « Profil actif »
  // du screener et de l'accueil. Le renseigner ici l'active partout.
  const [profile, setProfile] = useState<RichClientProfile>(EMPTY_PROFILE);
  const [initialized, setInitialized] = useState(false);

  // Import de document
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting]       = useState(false);
  const [importSource, setImportSource] = useState<string | null>(null);
  const [importError, setImportError]   = useState<string | null>(null);
  const [dragging, setDragging]         = useState(false);

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    setProfile(loadStoredProfile());
  }, [initialized]);

  // Persiste chaque modification dans le profil partagé.
  useEffect(() => { if (initialized) saveStoredProfile(profile); }, [profile, initialized]);

  // ─── Setters ────────────────────────────────────────────────────────────────

  function set<K extends keyof RichClientProfile>(key: K, val: RichClientProfile[K]) {
    setProfile((p) => ({ ...p, [key]: val }));
  }
  function toggleArray<K extends "envelopes" | "exclusions" | "asset_classes">(key: K, val: string) {
    setProfile((p) => {
      const prev = p[key] as string[];
      return { ...p, [key]: prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val] };
    });
  }
  function toggleOne<T>(current: T | null, val: T, key: keyof RichClientProfile) {
    set(key, (current === val ? null : val) as RichClientProfile[typeof key]);
  }

  // ─── Import ───────────────────────────────────────────────────────────────────

  async function processFile(file: File) {
    setImporting(true);
    setImportSource(file.name);
    setImportError(null);
    try {
      const { res, extracted } = await parseProfileFromFile(file);
      if (await handledRateLimit(res)) return;
      if (extracted) {
        setProfile((p) => ({ ...p, ...extracted }));
      } else {
        setImportError("Lecture impossible — renseignez les champs manuellement.");
        setImportSource(null);
      }
    } catch {
      setImportError("Lecture impossible — renseignez les champs manuellement.");
      setImportSource(null);
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

  // ─── Lancer la recherche ──────────────────────────────────────────────────────

  function findFunds() {
    saveStoredProfile(profile);
    const f = profileToScreenerFilters(profile);
    const sp = buildParams(f, 1, "data_completeness", "desc");
    sp.set("from", "profile"); // force l'état « recherché » même si profil sans filtre dur
    router.push(`/recherche?${sp.toString()}`);
  }

  const active = isProfileActive(profile);
  const filterChips = describeScreenerFilters(profileToScreenerFilters(profile));
  const inputCls =
    "w-full border border-line rounded-lg px-3 py-2 text-body bg-paper text-ink placeholder:text-muted focus:outline-none focus:border-brown/50 transition-colors";

  return (
    <PageShell>
      <PageHeader title="Profil client" />

      {/* ── Import de document ── */}
      <Card
        className={`p-5 mb-5 border-dashed transition-colors ${dragging ? "border-accent bg-accent-soft/30" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 shrink-0 rounded-[10px] border border-line bg-paper-2 flex items-center justify-center text-muted">
            {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} strokeWidth={1.7} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-meta font-semibold text-ink">Importer un document client</p>
          </div>
          <Btn
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="shrink-0"
          >
            {importing ? "Analyse…" : "Parcourir"}
          </Btn>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.csv,.xlsx,.xls,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        {importSource && !importing && (
          <div className="mt-3 inline-flex items-center gap-1.5 text-caption text-ok bg-ok-soft border border-ok/20 rounded-full px-2.5 py-1">
            <Check size={11} />
            <span>{importSource.length > 40 ? importSource.slice(0, 40) + "…" : importSource} — champs pré-remplis</span>
            <button type="button" onClick={() => setImportSource(null)} className="hover:text-ok/70">
              <X size={10} />
            </button>
          </div>
        )}
        {importError && <p className="mt-3 text-caption text-danger">{importError}</p>}
      </Card>

      {/* ── Formulaire ── */}
      {/* items-start : chaque carte épouse son contenu plutôt que de s'étirer à
          la hauteur de sa voisine (sinon vide en bas des cartes courtes). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        {/* Le client */}
        <SectionCard title="Le client">
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Âge">
              <input
                type="number" min={18} max={100} value={profile.age ?? ""}
                onChange={(e) => set("age", e.target.value ? Number(e.target.value) : null)}
                placeholder="ex : 45" className={inputCls}
              />
            </FieldGroup>
            <FieldGroup label="Montant à investir (€)">
              <input
                type="number" min={0} value={profile.amount_eur ?? ""}
                onChange={(e) => set("amount_eur", e.target.value ? Number(e.target.value) : null)}
                placeholder="ex : 50 000" className={inputCls}
              />
            </FieldGroup>
          </div>
          <FieldGroup label="Horizon de placement">
            <div className="flex flex-wrap gap-2">
              {([2, 5, 10, 15, 20] as const).map((y) => (
                <Chip
                  key={y}
                  label={y === 2 ? "< 3 ans" : y === 20 ? "20 ans+" : `${y} ans`}
                  active={profile.horizon_years === y}
                  onClick={() => toggleOne(profile.horizon_years, y, "horizon_years")}
                />
              ))}
            </div>
          </FieldGroup>
          <FieldGroup label="Objectif principal">
            <div className="flex flex-wrap gap-2">
              {OBJ_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.objectif === value}
                  onClick={() => toggleOne(profile.objectif, value, "objectif")} />
              ))}
            </div>
          </FieldGroup>
          <FieldGroup label="Expérience des marchés">
            <div className="flex flex-wrap gap-2">
              {EXP_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.experience === value}
                  onClick={() => toggleOne(profile.experience, value, "experience")} />
              ))}
            </div>
          </FieldGroup>
        </SectionCard>

        {/* Tolérance au risque */}
        <SectionCard title="Tolérance au risque">
          <FieldGroup label="Profil de risque MIF">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {RISK_OPTIONS.map(({ value, label, desc, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleOne(profile.risk_profile, value, "risk_profile")}
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
          <FieldGroup label="Tolérance aux pertes" hint="Plafonne la perte maximale tolérée sur 3 ans (drawdown).">
            <div className="flex flex-wrap gap-2">
              {([
                { value: "5",  label: "< 5 %" }, { value: "10", label: "< 10 %" },
                { value: "20", label: "< 20 %" }, { value: "30", label: "< 30 %" },
                { value: "illimitee", label: "Sans limite" },
              ] as { value: PerteMax; label: string }[]).map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.perte_max === value}
                  onClick={() => toggleOne(profile.perte_max, value, "perte_max")} />
              ))}
            </div>
          </FieldGroup>
        </SectionCard>

        {/* Préférences d'investissement */}
        <SectionCard title="Préférences d'investissement">
          <FieldGroup label="Préférence ESG">
            <div className="flex flex-wrap gap-2">
              {ESG_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.esg === value}
                  onClick={() => set("esg", value)} />
              ))}
            </div>
          </FieldGroup>
          <FieldGroup label="Classes d'actifs souhaitées">
            <div className="flex flex-wrap gap-2">
              {ASSET_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.asset_classes.includes(value)}
                  onClick={() => toggleArray("asset_classes", value)} />
              ))}
            </div>
          </FieldGroup>
          <FieldGroup label="Style de gestion">
            <div className="flex flex-wrap gap-2">
              {MGMT_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.management === value}
                  onClick={() => toggleOne(profile.management, value, "management")} />
              ))}
            </div>
          </FieldGroup>
          <FieldGroup label="Exclusions sectorielles" hint="Indicatif — affine les recherches en langage naturel.">
            <div className="flex flex-wrap gap-2">
              {EXCLUSION_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.exclusions.includes(value)}
                  onClick={() => toggleArray("exclusions", value)} />
              ))}
            </div>
          </FieldGroup>
        </SectionCard>

        {/* Frais, fiscalité & enveloppes */}
        <SectionCard title="Frais & fiscalité">
          <FieldGroup label="Enveloppes disponibles">
            <div className="flex flex-wrap gap-2">
              {ENVELOPE_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.envelopes.includes(value)}
                  onClick={() => toggleArray("envelopes", value)} />
              ))}
            </div>
          </FieldGroup>
          <FieldGroup label="Frais courants maximum" hint="Plafonne le TER (frais de gestion annuels).">
            <div className="flex flex-wrap gap-2">
              {TER_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.max_ter === value}
                  onClick={() => toggleOne(profile.max_ter, value, "max_ter")} />
              ))}
              <Chip label="Sans frais d'entrée" active={profile.no_entry_fee}
                onClick={() => set("no_entry_fee", !profile.no_entry_fee)} />
            </div>
          </FieldGroup>
          <FieldGroup label="Tranche marginale d'imposition (TMI)">
            <div className="flex flex-wrap gap-2">
              {(["0", "11", "30", "41", "45"] as Tmi[]).map((v) => (
                <Chip key={v} label={`${v} %`} active={profile.tmi === v}
                  onClick={() => toggleOne(profile.tmi, v, "tmi")} />
              ))}
            </div>
          </FieldGroup>
        </SectionCard>
      </div>

      {/* ── Barre d'action ── flottante, surface « élevée » (contour + ombre) pour
          qu'elle se détache nettement du fond et ne paraisse pas inachevée. */}
      <div className="sticky bottom-4 z-10 mt-8">
        <div className="rounded-2xl border border-line bg-paper/92 backdrop-blur-md px-5 py-4 shadow-[0_12px_40px_-14px_rgba(43,39,34,0.30),0_2px_8px_-3px_rgba(43,39,34,0.10)]">
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
            <div className="min-w-0 flex-1">
              {filterChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-label text-muted uppercase tracking-widest font-semibold mr-1">Filtres screener</span>
                  {filterChips.map((c) => (
                    <span key={c} className="inline-block px-2.5 py-1 rounded-md text-caption font-medium bg-accent-soft text-accent-ink border border-accent/20">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 shrink-0">
              {active && (
                <button
                  type="button"
                  onClick={() => setProfile(EMPTY_PROFILE)}
                  className="text-label font-medium text-muted hover:text-ink transition-colors"
                >
                  Effacer
                </button>
              )}
              <Btn variant="primary" size="lg" onClick={findFunds} className="shadow-sm">
                Trouver les fonds adaptés
                <ArrowRight size={15} />
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
