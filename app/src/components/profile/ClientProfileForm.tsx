"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { Upload, Loader2, X, ArrowRight, Check } from "@/components/ui/icons";
import { handledRateLimit } from "@/lib/rateLimitClient";
import { parseProfileFromFile } from "@/lib/profileImport";
import { buildParams } from "@/lib/screenerParams";
import {
  type RichClientProfile,
  type RiskProfile,
  type EsgPref,
  type Objectif,
  type Tmi,
  type PerteMax,
  type Experience,
  type ManagementPref,
  type IncomeNeed,
  type ReactionBaisse,
  type Versements,
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
      className={`shrink-0 whitespace-nowrap px-3.5 py-2 rounded-lg text-meta font-medium border transition-all ${
        active
          ? "bg-brown text-paper border-brown shadow-sm"
          : "bg-paper text-ink-2 border-line hover:border-brown/30 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

// Rangée de chips sur UNE seule ligne, scrollable horizontalement. On ne revient
// jamais à la ligne (sinon « Défiscalisation » se retrouve seul sur sa ligne et
// les blocs deviennent inégaux). Un dégradé de bord droit signale qu'il reste des
// options à faire défiler ; il s'efface visuellement quand tout tient à l'écran.
function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5 pr-2">
        {children}
      </div>
      <div className="pointer-events-none absolute -right-5 top-0 bottom-0 w-12 bg-gradient-to-l from-paper via-paper/70 to-transparent" />
    </div>
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

const HORIZON_OPTIONS: { value: number; label: string }[] = [
  { value: 1,  label: "< 2 ans" },
  { value: 3,  label: "2–4 ans" },
  { value: 5,  label: "5 ans" },
  { value: 8,  label: "8 ans" },
  { value: 10, label: "10 ans" },
  { value: 15, label: "15 ans" },
  { value: 20, label: "20 ans+" },
];

const OBJ_OPTIONS: { value: Objectif; label: string }[] = [
  { value: "capitalisation",  label: "Capitalisation" },
  { value: "revenus",         label: "Revenus" },
  { value: "retraite",        label: "Retraite" },
  { value: "transmission",    label: "Transmission" },
  { value: "defiscalisation", label: "Défiscalisation" },
];

const INCOME_OPTIONS: { value: IncomeNeed; label: string }[] = [
  { value: "non",      label: "Aucun (capitalisation)" },
  { value: "ponctuel", label: "Ponctuel" },
  { value: "regulier", label: "Régulier" },
];

const VERSEMENTS_OPTIONS: { value: Versements; label: string }[] = [
  { value: "non",         label: "Versement unique" },
  { value: "mensuel",     label: "Mensuels" },
  { value: "trimestriel", label: "Trimestriels" },
  { value: "annuel",      label: "Annuels" },
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

const REACTION_OPTIONS: { value: ReactionBaisse; label: string }[] = [
  { value: "vendre",    label: "Je vends" },
  { value: "conserver", label: "Je conserve" },
  { value: "renforcer", label: "Je renforce" },
];

const MGMT_OPTIONS: { value: ManagementPref; label: string }[] = [
  { value: "actif",  label: "Gestion active" },
  { value: "passif", label: "Indicielle (ETF)" },
];

const TER_OPTIONS: { value: number; label: string }[] = [
  { value: 0.3, label: "< 0,3 %" },
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

const GEO_OPTIONS = [
  { value: "monde",         label: "Monde" },
  { value: "europe",        label: "Europe" },
  { value: "zone_euro",     label: "Zone euro" },
  { value: "amerique_nord", label: "Amérique du Nord" },
  { value: "emergents",     label: "Émergents" },
  { value: "asie",          label: "Asie" },
  { value: "france",        label: "France" },
];

const EXCLUSION_OPTIONS = [
  { value: "tabac",    label: "Tabac" },
  { value: "armes",    label: "Armes" },
  { value: "fossiles", label: "Fossiles" },
  { value: "jeux",     label: "Jeux" },
  { value: "alcool",   label: "Alcool" },
];

const PERTE_OPTIONS: { value: PerteMax; label: string }[] = [
  { value: "5",  label: "< 5 %" },
  { value: "10", label: "< 10 %" },
  { value: "20", label: "< 20 %" },
  { value: "30", label: "< 30 %" },
  { value: "illimitee", label: "Sans limite" },
];

const TMI_OPTIONS: Tmi[] = ["0", "11", "30", "41", "45"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ClientProfileForm() {
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

  // Assureurs référencés (distribution du cabinet), chargés à la volée. Sert le
  // bloc « Distribution » : le CGP coche les assureurs dont il dispose.
  const [insurerOptions, setInsurerOptions] = useState<{ company: string; funds: number }[]>([]);
  const [insurerQuery, setInsurerQuery]     = useState("");
  // "loading" tant que le fetch tourne, "error" si le réseau/RPC échoue, "ready"
  // sinon. Distinct pour ne pas laisser « Chargement… » à l'écran indéfiniment.
  const [insurerStatus, setInsurerStatus]   = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    setProfile(loadStoredProfile());
  }, [initialized]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/screener/insurers")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http"))))
      .then((j) => { if (!cancelled) { setInsurerOptions(j.data ?? []); setInsurerStatus("ready"); } })
      .catch(() => { if (!cancelled) setInsurerStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  const normalizeStr = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Suggestions du typeahead : assureurs correspondant à la saisie, hors ceux déjà
  // sélectionnés, plafonnées (liste déroulante légère, on n'affiche pas tout le
  // catalogue). Vide tant que rien n'est tapé → aucune liste dense à l'écran.
  const insurerMatches = insurerQuery.trim()
    ? insurerOptions
        .filter((o) => !profile.insurers.includes(o.company))
        .filter((o) => normalizeStr(o.company).includes(normalizeStr(insurerQuery)))
        .slice(0, 8)
    : [];

  // Persiste chaque modification dans le profil partagé.
  useEffect(() => { if (initialized) saveStoredProfile(profile); }, [profile, initialized]);

  // ─── Setters ────────────────────────────────────────────────────────────────

  function set<K extends keyof RichClientProfile>(key: K, val: RichClientProfile[K]) {
    setProfile((p) => ({ ...p, [key]: val }));
  }
  function toggleArray<K extends "envelopes" | "exclusions" | "asset_classes" | "geographies" | "insurers">(key: K, val: string) {
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
        setImportError("Lecture impossible, renseignez les champs manuellement.");
        setImportSource(null);
      }
    } catch {
      setImportError("Lecture impossible, renseignez les champs manuellement.");
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
  const inputCls =
    "w-full border border-line rounded-lg px-3 py-2 text-body bg-paper text-ink placeholder:text-muted focus:outline-none focus:border-brown/50 transition-colors";

  return (
    <div>
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
            <span>{importSource.length > 40 ? importSource.slice(0, 40) + "…" : importSource} · champs pré-remplis</span>
            <button type="button" onClick={() => setImportSource(null)} className="hover:text-ok/70">
              <X size={10} />
            </button>
          </div>
        )}
        {importError && <p className="mt-3 text-caption text-danger">{importError}</p>}
      </Card>

      {/* ── Formulaire ──
          Grille 2 colonnes, cartes étirées à la même hauteur par rangée (pas de
          items-start). Chaque carte porte 4 critères → blocs harmonieux et alignés.
          Toutes les rangées de réponses sont sur une seule ligne, scrollables
          horizontalement (ChipRow) : on ne déborde jamais sur plusieurs lignes. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* 1 — Le client */}
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
            <ChipRow>
              {HORIZON_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.horizon_years === value}
                  onClick={() => toggleOne(profile.horizon_years, value, "horizon_years")} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Objectif principal">
            <ChipRow>
              {OBJ_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.objectif === value}
                  onClick={() => toggleOne(profile.objectif, value, "objectif")} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Besoin de revenus">
            <ChipRow>
              {INCOME_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.income_need === value}
                  onClick={() => toggleOne(profile.income_need, value, "income_need")} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Versements programmés">
            <ChipRow>
              {VERSEMENTS_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.versements === value}
                  onClick={() => toggleOne(profile.versements, value, "versements")} />
              ))}
            </ChipRow>
          </FieldGroup>
        </SectionCard>

        {/* 2 — Profil de risque */}
        <SectionCard title="Profil de risque">
          <FieldGroup label="Profil de risque MIF">
            <ChipRow>
              {RISK_OPTIONS.map(({ value, label, desc, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleOne(profile.risk_profile, value, "risk_profile")}
                  className={`shrink-0 w-[92px] flex flex-col items-center justify-center px-2 py-3 rounded-xl border text-center transition-all ${
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
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Expérience des marchés">
            <ChipRow>
              {EXP_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.experience === value}
                  onClick={() => toggleOne(profile.experience, value, "experience")} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Réaction à une forte baisse">
            <ChipRow>
              {REACTION_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.reaction_baisse === value}
                  onClick={() => toggleOne(profile.reaction_baisse, value, "reaction_baisse")} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Tolérance aux pertes">
            <ChipRow>
              {PERTE_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.perte_max === value}
                  onClick={() => toggleOne(profile.perte_max, value, "perte_max")} />
              ))}
            </ChipRow>
          </FieldGroup>
        </SectionCard>

        {/* 3 — Préférences d'investissement */}
        <SectionCard title="Préférences d'investissement">
          <FieldGroup label="Classes d'actifs souhaitées">
            <ChipRow>
              {ASSET_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.asset_classes.includes(value)}
                  onClick={() => toggleArray("asset_classes", value)} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Zones géographiques">
            <ChipRow>
              {GEO_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.geographies.includes(value)}
                  onClick={() => toggleArray("geographies", value)} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Style de gestion">
            <ChipRow>
              {MGMT_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.management === value}
                  onClick={() => toggleOne(profile.management, value, "management")} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Préférence ESG">
            <ChipRow>
              {ESG_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.esg === value}
                  onClick={() => set("esg", value)} />
              ))}
            </ChipRow>
          </FieldGroup>
        </SectionCard>

        {/* 4 — Frais, fiscalité & enveloppes */}
        <SectionCard title="Frais, fiscalité & enveloppes">
          <FieldGroup label="Enveloppes disponibles">
            <ChipRow>
              {ENVELOPE_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.envelopes.includes(value)}
                  onClick={() => toggleArray("envelopes", value)} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Exclusions sectorielles">
            <ChipRow>
              {EXCLUSION_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.exclusions.includes(value)}
                  onClick={() => toggleArray("exclusions", value)} />
              ))}
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Frais courants maximum">
            <ChipRow>
              {TER_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={profile.max_ter === value}
                  onClick={() => toggleOne(profile.max_ter, value, "max_ter")} />
              ))}
              <Chip label="Sans frais d'entrée" active={profile.no_entry_fee}
                onClick={() => set("no_entry_fee", !profile.no_entry_fee)} />
            </ChipRow>
          </FieldGroup>
          <FieldGroup label="Tranche marginale d'imposition (TMI)">
            <ChipRow>
              {TMI_OPTIONS.map((v) => (
                <Chip key={v} label={`${v} %`} active={profile.tmi === v}
                  onClick={() => toggleOne(profile.tmi, v, "tmi")} />
              ))}
            </ChipRow>
          </FieldGroup>
        </SectionCard>

        {/* 5 — Distribution du cabinet (pleine largeur) : les assureurs dont le CGP
            dispose. Un fonds n'est recommandable que s'il est référencé chez l'un
            d'eux ; sinon le CGP ne peut pas le loger au client. Vide = pas de
            contrainte (tout l'univers reste consultable). */}
        <div className="lg:col-span-2">
          <SectionCard title="Distribution du cabinet">
            <FieldGroup label="Assureurs dont vous disposez">
              {/* Typeahead : on tape, une liste des assureurs correspondants
                  s'affiche, on sélectionne. On n'affiche jamais tout le catalogue
                  (trop dense + long à charger). Les sélectionnés partent en rangée
                  horizontale scrollable juste en dessous. */}
              <div className="relative">
                <input
                  type="text"
                  aria-label="Rechercher un assureur"
                  value={insurerQuery}
                  onChange={(e) => setInsurerQuery(e.target.value)}
                  placeholder="Rechercher un assureur…"
                  autoComplete="off"
                  className={inputCls}
                />
                {insurerQuery.trim() && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-60 overflow-y-auto scrollbar-thin rounded-lg border border-line bg-paper shadow-lg">
                    {insurerStatus === "loading" ? (
                      <p className="px-3 py-2 text-meta text-muted-2">Chargement des assureurs…</p>
                    ) : insurerStatus === "error" ? (
                      <p className="px-3 py-2 text-meta text-warn">Impossible de charger les assureurs.</p>
                    ) : insurerMatches.length === 0 ? (
                      <p className="px-3 py-2 text-meta text-muted-2">Aucun assureur ne correspond.</p>
                    ) : (
                      insurerMatches.map(({ company }) => (
                        <button
                          key={company}
                          type="button"
                          onClick={() => { toggleArray("insurers", company); setInsurerQuery(""); }}
                          className="block w-full text-left px-3 py-2 text-meta text-ink-2 hover:bg-accent-soft/40 transition-colors"
                        >
                          {company}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {/* Assureurs sélectionnés : rangée sur UNE ligne, scrollable vers la
                  droite (ChipRow) — jamais une liste de courses verticale. Clic = retire. */}
              {profile.insurers.length > 0 && (
                <ChipRow>
                  {profile.insurers.map((company) => (
                    <button
                      key={company}
                      type="button"
                      onClick={() => toggleArray("insurers", company)}
                      aria-label={`Retirer ${company}`}
                      className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-meta font-medium bg-brown text-paper border border-brown"
                    >
                      {company}
                      <X size={11} className="opacity-80" />
                    </button>
                  ))}
                </ChipRow>
              )}
            </FieldGroup>
          </SectionCard>
        </div>
      </div>

      {/* ── Action ── plus de barre : le seul élément utile est le bouton
          principal, aligné à droite (+ lien « Effacer » si un profil est actif). */}
      <div className="mt-8 flex items-center justify-end gap-4">
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
          Trouver le support adapté
          <ArrowRight size={15} />
        </Btn>
      </div>
    </div>
  );
}
