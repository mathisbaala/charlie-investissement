"use client";

import React, { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, X, Search, FileText } from "@/components/ui/icons";
import { dt } from "@/lib/format";
import { handledRateLimit } from "@/lib/rateLimitClient";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DiciFiche {
  name: string;
  isin: string | null;
  gestionnaire: string | null;
  product_type: string | null;
  sfdr_article: number | null;
  sri: number | null;
  investment_objective: string | null;
  recommended_holding_period: string | null;
  entry_fees_max: string | null;
  exit_fees_max: string | null;
  ongoing_charges: number | null;
  performance_fees: string | null;
  target_investor: string | null;
  key_risks: string[] | null;
  benchmark: string | null;
  currency: string | null;
  domicile: string | null;
  inception_date: string | null;
  // Reliure base de données : ISIN/nom du fonds retrouvé en base (null si introuvable).
  matched_isin: string | null;
  matched_name: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function TypeTag({ type }: { type: string | null }) {
  if (!type) return null;
  const map: Record<string, string> = {
    etf: "ETF",
    opcvm: "OPCVM",
    scpi: "SCPI",
    fonds_euros: "Fonds euros",
    structured: "Structuré",
    autre: "Autre",
  };
  const label = map[type] ?? type.toUpperCase();
  const cls =
    type === "etf" ? "bg-accent-soft text-accent-ink" :
    type === "opcvm" ? "bg-paper-2 text-ink-2" :
    type === "scpi" ? "bg-ok-soft text-ok" :
    "bg-paper-2 text-ink-2";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-label font-semibold uppercase tracking-wide border border-transparent ${cls}`}>
      {label}
    </span>
  );
}

function SfdrTag({ article }: { article: number | null }) {
  if (!article) return null;
  const cls =
    article === 9 ? "bg-ok-soft text-ok border-ok/20" :
    article === 8 ? "bg-accent-soft text-accent-ink border-accent/20" :
    "bg-paper-2 text-muted border-line";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-label font-medium border ${cls}`}>
      Art. {article}
    </span>
  );
}

function SriBar({ sri }: { sri: number | null }) {
  if (!sri) return null;
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className={`w-4 h-2.5 rounded-sm transition-colors ${
              i < sri
                ? sri <= 2 ? "bg-ok" : sri <= 4 ? "bg-warn" : "bg-warn-dark"
                : "bg-line"
            }`}
          />
        ))}
      </div>
      <span className="text-meta font-mono font-medium text-ink-2">{sri}/7</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-line-soft last:border-0">
      <span className="text-label text-muted w-36 shrink-0 pt-0.5">{label}</span>
      <span className="text-meta text-ink-2 flex-1 leading-relaxed">{value}</span>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fiche, setFiche] = useState<DiciFiche | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Seuls les fichiers PDF sont acceptés.");
      return;
    }
    setLoading(true);
    setError(null);
    setFiche(null);
    setFileName(file.name);
    try {
      const b64 = await readAsBase64(file);
      const res = await fetch("/api/dici/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_base64: b64 }),
      });
      if (await handledRateLimit(res)) return;
      if (!res.ok) throw new Error("Erreur serveur");
      const data = await res.json();
      setFiche(data);
    } catch {
      setError("Impossible d'analyser ce document. Vérifiez qu'il s'agit d'un DICI valide.");
    } finally {
      setLoading(false);
    }
  }

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  function handleReset() {
    setFiche(null);
    setFileName(null);
    setError(null);
  }

  function handleSearchFund() {
    if (!fiche) return;
    const q = fiche.isin ?? fiche.name;
    router.push(`/recherche?q=${encodeURIComponent(q)}`);
  }

  function handleViewFund() {
    if (fiche?.matched_isin) router.push(`/fonds/${fiche.matched_isin}`);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-cream">

      {/* Header */}
      <div className="shrink-0 border-b border-line bg-paper px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-title-lg text-ink" style={{ fontFamily: "var(--font-serif)" }}>
              Documents
            </h1>
          </div>
          {fiche && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label font-medium border border-line bg-paper text-ink-2 hover:bg-paper-2 transition-colors"
            >
              <X size={12} />
              Nouvelle analyse
            </button>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-[740px] mx-auto">

          {/* Drop zone — always shown, collapsed after upload */}
          {!fiche && !loading && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed transition-colors cursor-pointer py-16 px-8 text-center ${
                dragging
                  ? "border-accent bg-accent-soft/30"
                  : "border-line bg-paper hover:border-accent/40 hover:bg-paper-2"
              }`}
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${
                dragging ? "bg-accent/20" : "bg-paper-2 border border-line"
              }`}>
                <Upload size={24} className={dragging ? "text-accent" : "text-muted"} />
              </div>
              <div>
                <p className="text-body-lg font-medium text-ink-2">
                  {dragging ? "Relâchez pour analyser" : "Glissez votre DICI ici"}
                </p>
                <p className="text-meta text-muted mt-1">
                  ou <span className="text-accent-ink underline underline-offset-2">cliquez pour sélectionner</span> un fichier PDF
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <div className="w-12 h-12 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              <div className="text-center">
                <p className="text-body font-medium text-ink-2">Analyse en cours…</p>
                <p className="text-label text-muted mt-1">
                  {fileName && <span className="font-mono">{fileName}</span>}
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="mt-4 flex items-start gap-3 bg-warn/10 border border-warn/20 rounded-xl px-4 py-3">
              <span className="text-warn text-body-lg shrink-0">⚠</span>
              <div>
                <p className="text-meta font-medium text-ink-2">{error}</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-label text-accent-ink hover:underline mt-1"
                >
                  Essayer un autre fichier
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileInput} />
            </div>
          )}

          {/* Result — fiche produit */}
          {fiche && !loading && (
            <div className="space-y-4">

              {/* Banner */}
              <div className="bg-paper rounded-xl border border-line px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <TypeTag type={fiche.product_type} />
                      <SfdrTag article={fiche.sfdr_article} />
                      {fiche.currency && (
                        <span className="text-caption font-mono bg-paper-2 border border-line rounded px-1.5 py-0.5 text-ink-2">
                          {fiche.currency}
                        </span>
                      )}
                    </div>
                    <h2
                      className="text-title-lg leading-tight text-ink font-normal"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      {fiche.name}
                    </h2>
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-meta text-muted">
                      {fiche.gestionnaire && <span>{fiche.gestionnaire}</span>}
                      {fiche.isin && <span className="font-mono text-muted-2">{fiche.isin}</span>}
                      {fiche.domicile && <span>{fiche.domicile}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {fiche.sri && (
                      <div className="mb-2">
                        <p className="text-caption text-muted mb-1">Risque (SRI)</p>
                        <SriBar sri={fiche.sri} />
                      </div>
                    )}
                    {fiche.ongoing_charges != null && (
                      <div>
                        <p className="text-caption text-muted">Frais courants</p>
                        <p className="text-title font-mono font-medium text-ink-2">
                          {fiche.ongoing_charges.toFixed(2)} %
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Détails */}
              <div className="bg-paper rounded-xl border border-line px-6 py-5">
                <h3 className="text-label uppercase tracking-widest font-semibold text-muted mb-3">Informations clés</h3>
                <InfoRow label="Objectif" value={fiche.investment_objective} />
                <InfoRow label="Durée recommandée" value={fiche.recommended_holding_period} />
                <InfoRow label="Benchmark" value={fiche.benchmark} />
                <InfoRow label="Investisseur cible" value={fiche.target_investor} />
                {fiche.inception_date && (
                  <InfoRow label="Date de création" value={dt(fiche.inception_date)} />
                )}
              </div>

              {/* Frais */}
              <div className="bg-paper rounded-xl border border-line px-6 py-5">
                <h3 className="text-label uppercase tracking-widest font-semibold text-muted mb-3">Frais</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {fiche.entry_fees_max && (
                    <div>
                      <p className="text-caption text-muted mb-0.5">Entrée (max)</p>
                      <p className="text-subhead font-mono font-medium text-ink-2">{fiche.entry_fees_max}</p>
                    </div>
                  )}
                  {fiche.ongoing_charges != null && (
                    <div>
                      <p className="text-caption text-muted mb-0.5">Frais courants</p>
                      <p className="text-subhead font-mono font-medium text-ink-2">{fiche.ongoing_charges.toFixed(2)} %</p>
                    </div>
                  )}
                  {fiche.exit_fees_max && (
                    <div>
                      <p className="text-caption text-muted mb-0.5">Sortie (max)</p>
                      <p className="text-subhead font-mono font-medium text-ink-2">{fiche.exit_fees_max}</p>
                    </div>
                  )}
                </div>
                {fiche.performance_fees && (
                  <div className="mt-3 pt-3 border-t border-line-soft">
                    <p className="text-caption text-muted mb-0.5">Commissions de performance</p>
                    <p className="text-meta text-ink-2">{fiche.performance_fees}</p>
                  </div>
                )}
              </div>

              {/* Risques */}
              {fiche.key_risks && fiche.key_risks.length > 0 && (
                <div className="bg-paper rounded-xl border border-line px-6 py-5">
                  <h3 className="text-label uppercase tracking-widest font-semibold text-muted mb-3">Principaux risques</h3>
                  <div className="flex flex-wrap gap-2">
                    {fiche.key_risks.map((r, i) => (
                      <span key={i} className="text-label bg-warn/8 border border-warn/15 text-warn-dark rounded-lg px-3 py-1.5">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Reliure base de données */}
              {fiche.matched_isin ? (
                <div className="flex items-start gap-2.5 bg-ok-soft border border-ok/20 rounded-xl px-4 py-3">
                  <span className="text-ok text-body-lg shrink-0 leading-5">✓</span>
                  <p className="text-meta text-ink-2 leading-relaxed">
                    Fonds identifié dans la base&nbsp;:{" "}
                    <span className="font-medium">{fiche.matched_name}</span>{" "}
                    <span className="font-mono text-muted">{fiche.matched_isin}</span>.
                    Ouvrez sa fiche produit complète pour toutes les métriques disponibles.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 bg-paper-2 border border-line rounded-xl px-4 py-3">
                  <span className="text-muted text-body-lg shrink-0 leading-5">○</span>
                  <p className="text-meta text-muted leading-relaxed">
                    Ce fonds n'a pas été retrouvé automatiquement dans la base. Vous pouvez le
                    rechercher manuellement dans le screener.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3">
                {fiche.matched_isin ? (
                  <button
                    onClick={handleViewFund}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-meta font-medium bg-brown text-paper hover:bg-brown-2 transition-colors"
                  >
                    <Search size={13} />
                    Voir la fiche produit complète
                  </button>
                ) : (
                  <button
                    onClick={handleSearchFund}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-meta font-medium bg-brown text-paper hover:bg-brown-2 transition-colors"
                  >
                    <Search size={13} />
                    Rechercher ce fonds dans le screener
                  </button>
                )}
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-meta font-medium border border-line bg-paper text-ink-2 hover:bg-paper-2 transition-colors"
                >
                  <FileText size={13} />
                  Analyser un autre DICI
                </button>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
