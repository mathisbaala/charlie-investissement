"use client";

import React, { useCallback, useRef, useState } from "react";
import { Upload, FileText, Search, Loader2 } from "@/components/ui/icons";
import { FundAdder } from "@/components/portfolio/FundAdder";
import { handledRateLimit } from "@/lib/rateLimitClient";
import type { ReleveApiPosition } from "@/lib/releve";

// ── Contrats de sortie : ce que SupportSources remonte au simulateur ────────────

/** Position d'un portefeuille déposé (relevé) : ISIN + libellé + montant en €. */
export interface DepositedHolding {
  isin: string;
  name: string;
  amount: number;
}

/** Support extrait d'une fiche/DICI : les FRAIS d'abord (le reste enrichi en base). */
export interface DiciSupport {
  isin: string;
  matchedIsin: string | null;
  name: string;
  ter: number | null;      // % (frais courants)
  entryFee: number | null; // %
  exitFee: number | null;  // %
}

interface Props {
  /** Ajout d'un fonds via recherche (l'appelant gère poids/dédup). */
  onAddFund: (isin: string, name: string) => void;
  /** ISIN déjà présents (recherche : « Ajouté » et non re-sélectionnable). */
  existingIsins: Set<string>;
  /** Portefeuille au complet (recherche désactivée). */
  full: boolean;
  /** Relevé déposé → positions valorisées (l'appelant fixe montant + poids). */
  onAddPortfolio: (holdings: DepositedHolding[]) => void;
  /** Fiche/DICI déposée → un support avec ses frais. */
  onAddDiciSupport: (support: DiciSupport) => void;
}

type Mode = "search" | "portfolio" | "document";

const MODES: { key: Mode; label: string }[] = [
  { key: "search", label: "Rechercher" },
  { key: "portfolio", label: "Déposer un relevé" },
  { key: "document", label: "Déposer une fiche" },
];

const PORTFOLIO_ACCEPT = ".pdf,.csv,.xlsx,.xls";
const DOCUMENT_ACCEPT = ".pdf";
const DOCUMENT_MAX_BYTES = 3_000_000; // aligné avec DICI_MAX_BYTES (api/dici/parse)

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Un taux de frais dans un DICI est souvent un texte (« 3 % », « jusqu'à 5 % »,
 * « Néant »). On en extrait le premier pourcentage ; « néant / aucun / sans
 * frais » valent 0 ; sinon null (inconnu, l'UI retombe sur ses défauts).
 */
export function parsePctString(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = String(s).replace(",", ".").toLowerCase();
  if (/n[ée]ant|aucun|sans\s+frais|pas\s+de\s+frais/.test(t)) return 0;
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return Number(m[1]);
  const only = t.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (only) return Number(only[1]);
  return null;
}

// Fiche minimale renvoyée par /api/dici/parse, telle qu'on la consomme ici.
interface DiciParseResult {
  name?: string | null;
  isin?: string | null;
  ongoing_charges?: number | null; // %
  entry_fees_max?: string | null;
  exit_fees_max?: string | null;
  matched_isin?: string | null;
  matched_name?: string | null;
}

/**
 * Bloc d'entrée autonome de l'onglet Frais : trois façons d'alimenter le calcul
 * qui convergent toutes vers la même liste de supports —
 *   • rechercher un fonds (ISIN/nom) ;
 *   • déposer un relevé de portefeuille (PDF/Excel/CSV) → positions valorisées ;
 *   • déposer une fiche / DICI (PDF) → un support et ses frais extraits.
 * On ne restitue ICI que ce qui sert au calcul de frais ; l'analyse
 * investissement complète reste l'affaire de l'onglet « Analyser ».
 */
export function SupportSources({
  onAddFund, existingIsins, full, onAddPortfolio, onAddDiciSupport,
}: Props) {
  const [mode, setMode] = useState<Mode>("search");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const portfolioInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  // ── Dépôt d'un relevé : un POST /api/releve par fichier, positions agrégées ──
  const onPortfolioFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    setBusy(true); setError(null); setNote(null);
    const holdings: DepositedHolding[] = [];
    let warned: string | null = null;
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/releve", { method: "POST", body: form });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(`${file.name} : ${json?.error ?? `erreur ${res.status}`}`);
          continue;
        }
        if (json?.warning) warned = json.warning;
        for (const p of (json?.positions ?? []) as ReleveApiPosition[]) {
          if (p.amount != null && p.amount > 0) {
            holdings.push({ isin: p.isin, name: p.name || p.label || p.isin, amount: p.amount });
          }
        }
      }
      if (holdings.length > 0) {
        onAddPortfolio(holdings);
        setNote(`${holdings.length} support${holdings.length > 1 ? "s" : ""} valorisé${holdings.length > 1 ? "s" : ""} importé${holdings.length > 1 ? "s" : ""}.`);
      } else {
        setError(warned ?? "Aucune position valorisée trouvée. Vérifiez qu'il s'agit d'un relevé de situation.");
      }
    } finally {
      setBusy(false);
      if (portfolioInput.current) portfolioInput.current.value = "";
    }
  }, [busy, onAddPortfolio]);

  // ── Dépôt d'une fiche / DICI : /api/dici/parse → frais du support ────────────
  const onDocumentFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    setBusy(true); setError(null); setNote(null);
    let added = 0;
    try {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
          setError("Seuls les fichiers PDF sont acceptés pour une fiche."); continue;
        }
        if (file.size > DOCUMENT_MAX_BYTES) {
          setError(`${file.name} : trop volumineux (${Math.round(DOCUMENT_MAX_BYTES / 1_000_000)} Mo max).`); continue;
        }
        const b64 = await readAsBase64(file);
        const res = await fetch("/api/dici/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // fields="fees" : ici on ne consomme que les FRAIS du support → la route
          // tente une lecture déterministe gratuite avant tout appel IA (coût).
          body: JSON.stringify({ file_base64: b64, fields: "fees" }),
        });
        if (await handledRateLimit(res)) return;
        const data = (await res.json().catch(() => null)) as DiciParseResult | null;
        if (!res.ok || !data) {
          setError("Impossible d'analyser cette fiche. Vérifiez qu'il s'agit d'un DICI valide.");
          continue;
        }
        const isin = data.matched_isin ?? data.isin ?? null;
        if (!isin) {
          setError(`${file.name} : aucun ISIN identifié sur la fiche.`); continue;
        }
        onAddDiciSupport({
          isin,
          matchedIsin: data.matched_isin ?? null,
          name: data.matched_name ?? data.name ?? isin,
          ter: data.ongoing_charges ?? null,
          entryFee: parsePctString(data.entry_fees_max),
          exitFee: parsePctString(data.exit_fees_max),
        });
        added += 1;
      }
      if (added > 0) setNote(`${added} support${added > 1 ? "s" : ""} importé${added > 1 ? "s" : ""} depuis ${added > 1 ? "les fiches" : "la fiche"}.`);
    } catch {
      setError("Le service d'analyse est temporairement indisponible. Réessayez dans quelques minutes.");
    } finally {
      setBusy(false);
      if (documentInput.current) documentInput.current.value = "";
    }
  }, [busy, onAddDiciSupport]);

  const dropZone = (kind: "portfolio" | "document") => {
    const ref = kind === "portfolio" ? portfolioInput : documentInput;
    const onFiles = kind === "portfolio" ? onPortfolioFiles : onDocumentFiles;
    const Icon = kind === "portfolio" ? Upload : FileText;
    const title = kind === "portfolio" ? "Déposer un relevé de portefeuille" : "Déposer une fiche de support";
    const hint = kind === "portfolio" ? "PDF, Excel ou CSV — plusieurs fichiers acceptés" : "DICI / fiche produit au format PDF";
    return (
      <div
        onClick={() => !busy && ref.current?.click()}
        onDrop={(e) => { e.preventDefault(); if (!busy) onFiles(e.dataTransfer.files); }}
        onDragOver={(e) => e.preventDefault()}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line py-6 px-4 text-center transition-colors ${busy ? "opacity-60 cursor-wait" : "cursor-pointer hover:border-accent/50 hover:bg-paper-2"}`}
      >
        {busy
          ? <Loader2 size={20} className="text-muted animate-spin" />
          : <Icon size={20} className="text-muted" />}
        <div>
          <p className="text-meta text-ink-2">{busy ? "Analyse en cours…" : title}</p>
          {!busy && <p className="text-caption text-muted mt-0.5">{hint}</p>}
        </div>
        <input
          ref={ref} type="file" multiple={kind === "portfolio"}
          accept={kind === "portfolio" ? PORTFOLIO_ACCEPT : DOCUMENT_ACCEPT}
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex rounded-md border border-line overflow-hidden">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => { setMode(m.key); setError(null); setNote(null); }}
            className={`flex-1 text-caption px-2 py-1.5 transition-colors ${mode === m.key ? "bg-brown text-paper" : "text-muted hover:bg-accent-soft"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "search" && (
        <FundAdder
          onAdd={onAddFund}
          existing={existingIsins}
          full={full}
          placeholder="Rechercher un fonds : ISIN ou nom"
        />
      )}
      {mode === "portfolio" && dropZone("portfolio")}
      {mode === "document" && dropZone("document")}

      {note && !error && <p className="text-caption text-ok">{note}</p>}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-warn/10 border border-warn/20 px-3 py-2">
          <Search size={13} className="text-warn shrink-0 mt-0.5" />
          <p className="text-caption text-ink-2">{error}</p>
        </div>
      )}
    </div>
  );
}
