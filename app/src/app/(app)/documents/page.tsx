"use client";

import React, { useState, useRef, useCallback } from "react";
import { Upload, X } from "@/components/ui/icons";
import { PageShell, PageHeader } from "@/components/ui/Page";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { handledRateLimit } from "@/lib/rateLimitClient";
import { DiciReport, type DiciFiche } from "./DiciReport";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fiche, setFiche] = useState<DiciFiche | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Doit rester aligné avec DICI_MAX_BYTES côté serveur (api/dici/parse).
  const MAX_PDF_BYTES = 3_000_000;

  async function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Seuls les fichiers PDF sont acceptés.");
      return;
    }
    // Pré-contrôle de taille côté client : évite d'uploader (et de facturer) un
    // gros fichier. Un DICI fait quelques pages ; au-delà de 3 Mo c'est anormal.
    if (file.size > MAX_PDF_BYTES) {
      setError(`Fichier trop volumineux (${Math.round(MAX_PDF_BYTES / 1_000_000)} Mo max). Un DICI ne fait que quelques pages.`);
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
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // On distingue une panne du service IA (clé/quota/réseau, code
        // "ai_unavailable" → 503) d'un document réellement illisible (422),
        // pour ne pas faire porter le chapeau au fichier de l'utilisateur.
        if (data?.code === "too_large") {
          setError(`Fichier trop volumineux (${data.max_mb ?? 3} Mo max). Un DICI ne fait que quelques pages.`);
        } else if (data?.code === "ai_unavailable" || res.status >= 500) {
          setError("Le service d'analyse est temporairement indisponible. Réessayez dans quelques minutes.");
        } else {
          setError("Impossible d'analyser ce document. Vérifiez qu'il s'agit d'un DICI valide.");
        }
        return;
      }
      setFiche(data);
    } catch {
      setError("Le service d'analyse est temporairement indisponible. Réessayez dans quelques minutes.");
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

  return (
    <PageShell>
      <PageHeader
        action={
          fiche && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label font-medium border border-line bg-paper text-ink-2 hover:bg-paper-2 transition-colors shrink-0"
            >
              <X size={12} />
              Nouvelle analyse
            </button>
          )
        }
      />


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

          {!fiche && !loading && (
            <PrivacyNote
              className="mt-3"
              text="Le document est analysé puis écarté. Aucun fichier n'est conservé sur nos serveurs."
            />
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

          {/* Result — rapport DICI */}
          {fiche && !loading && <DiciReport fiche={fiche} onReset={handleReset} />}

    </PageShell>
  );
}
