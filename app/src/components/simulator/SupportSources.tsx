"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Upload, Search, Loader2, Wallet, ArrowRight } from "@/components/ui/icons";
import { FundAdder } from "@/components/portfolio/FundAdder";
import { loadLastPortfolio, type StoredPortfolio } from "@/lib/lastPortfolio";
import type { ReleveApiPosition, ReleveContractMatch } from "@/lib/releve";

// ── Contrats de sortie : ce que SupportSources remonte au simulateur ────────────

/** Position d'un portefeuille déposé (relevé) : ISIN + libellé + montant en €. */
export interface DepositedHolding {
  isin: string;
  name: string;
  amount: number;
}

/** Ligne d'un portefeuille importé de l'onglet « Portefeuille » : ISIN + poids %. */
export interface ImportedLine {
  isin: string;
  name: string;
  weight: number;
}

interface Props {
  /** Ajout d'un fonds via recherche (l'appelant gère poids/dédup). */
  onAddFund: (isin: string, name: string) => void;
  /** ISIN déjà présents (recherche : « Ajouté » et non re-sélectionnable). */
  existingIsins: Set<string>;
  /** Portefeuille au complet (recherche désactivée). */
  full: boolean;
  /**
   * Relevé déposé → positions valorisées (l'appelant fixe montant + poids).
   * `matches` = contrats d'AV reconnus depuis les ISIN (triés par couverture),
   * uniquement quand UN seul relevé est déposé — sert à l'auto-remplissage du
   * contrat côté simulateur. Vide si plusieurs fichiers (contrats mélangés).
   */
  onAddPortfolio: (holdings: DepositedHolding[], matches: ReleveContractMatch[]) => void;
  /** Portefeuille construit dans l'onglet « Portefeuille » → lignes pondérées. */
  onImportPortfolio: (lines: ImportedLine[], montant: number | null) => void;
}

type Mode = "create" | "deposit" | "import";

const MODES: { key: Mode; label: string }[] = [
  { key: "create", label: "Créer" },
  { key: "deposit", label: "Déposer" },
  { key: "import", label: "Importer" },
];

const PORTFOLIO_ACCEPT = ".pdf,.csv,.xlsx,.xls";

/**
 * Cadre commun aux zones « Déposer » et « Importer » : même empreinte (taille
 * strictement identique quel que soit le mode ou l'état), pour une entrée de
 * portefeuille homogène. Chaque zone ajoute ensuite son propre style de bordure.
 */
const ZONE_FRAME =
  "flex flex-col justify-center gap-2 rounded-lg min-h-[148px] px-4 py-6";

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

/**
 * Bloc d'entrée autonome de l'onglet Frais : trois façons d'alimenter le calcul
 * qui convergent toutes vers le même portefeuille de supports —
 *   • CRÉER un portefeuille de toutes pièces (recherche ISIN/nom) ;
 *   • DÉPOSER un portefeuille déjà constitué (relevé PDF/Excel/CSV) ;
 *   • IMPORTER le portefeuille construit dans l'onglet « Portefeuille ».
 * On ne restitue ICI que ce qui sert au calcul de frais ; l'analyse
 * investissement complète reste l'affaire de l'onglet « Analyser ».
 */
export function SupportSources({
  onAddFund, existingIsins, full, onAddPortfolio, onImportPortfolio,
}: Props) {
  const [mode, setMode] = useState<Mode>("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const portfolioInput = useRef<HTMLInputElement>(null);

  // ── Dépôt d'un relevé : un POST /api/releve par fichier, positions agrégées ──
  const onPortfolioFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    setBusy(true); setError(null); setNote(null);
    const holdings: DepositedHolding[] = [];
    const fileList = Array.from(files);
    let warned: string | null = null;
    // Contrats reconnus : ne servent à l'auto-remplissage QUE pour un relevé
    // unique — plusieurs fichiers = enveloppes mélangées, aucun contrat unique.
    let matches: ReleveContractMatch[] = [];
    try {
      for (const file of fileList) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/releve", { method: "POST", body: form });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(`${file.name} : ${json?.error ?? `erreur ${res.status}`}`);
          continue;
        }
        if (json?.warning) warned = json.warning;
        if (fileList.length === 1) matches = (json?.matches ?? []) as ReleveContractMatch[];
        for (const p of (json?.positions ?? []) as ReleveApiPosition[]) {
          if (p.amount != null && p.amount > 0) {
            holdings.push({ isin: p.isin, name: p.name || p.label || p.isin, amount: p.amount });
          }
        }
      }
      if (holdings.length > 0) {
        onAddPortfolio(holdings, matches);
        setNote(`${holdings.length} support${holdings.length > 1 ? "s" : ""} importé${holdings.length > 1 ? "s" : ""}.`);
      } else {
        setError(warned ?? "Aucune position valorisée trouvée. Vérifiez qu'il s'agit d'un relevé de situation.");
      }
    } finally {
      setBusy(false);
      if (portfolioInput.current) portfolioInput.current.value = "";
    }
  }, [busy, onAddPortfolio]);

  const dropZone = () => (
    <div
      onClick={() => !busy && portfolioInput.current?.click()}
      onDrop={(e) => { e.preventDefault(); if (!busy) onPortfolioFiles(e.dataTransfer.files); }}
      onDragOver={(e) => e.preventDefault()}
      className={`${ZONE_FRAME} items-center text-center border border-dashed border-line transition-colors ${busy ? "opacity-60 cursor-wait" : "cursor-pointer hover:border-accent/50 hover:bg-paper-2"}`}
    >
      {busy
        ? <Loader2 size={20} className="text-muted animate-spin" />
        : <Upload size={20} className="text-muted" />}
      <div>
        <p className="text-meta text-ink-2">{busy ? "Analyse en cours…" : "Déposer un relevé de portefeuille"}</p>
        {!busy && <p className="text-caption text-muted mt-0.5">PDF, Excel ou CSV — plusieurs fichiers acceptés</p>}
      </div>
      <input
        ref={portfolioInput} type="file" multiple accept={PORTFOLIO_ACCEPT}
        className="hidden"
        onChange={(e) => onPortfolioFiles(e.target.files)}
      />
    </div>
  );

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

      {mode === "create" && (
        <FundAdder
          onAdd={onAddFund}
          existing={existingIsins}
          full={full}
          placeholder="Rechercher un fonds : ISIN ou nom"
        />
      )}
      {mode === "deposit" && dropZone()}
      {mode === "import" && (
        <ImportPanel
          onImport={(lines, montant) => {
            onImportPortfolio(lines, montant);
            setError(null);
            setNote(`${lines.length} support${lines.length > 1 ? "s" : ""} importé${lines.length > 1 ? "s" : ""} du portefeuille.`);
          }}
        />
      )}

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

/**
 * Panneau « Importer » : récupère le dernier portefeuille construit dans l'onglet
 * « Portefeuille » (mémorisé en localStorage) et l'injecte tel quel. Si aucun
 * portefeuille n'a encore été construit, renvoie vers l'atelier.
 */
function ImportPanel({ onImport }: { onImport: (lines: ImportedLine[], montant: number | null) => void }) {
  const [stored, setStored] = useState<StoredPortfolio | null>(null);
  // localStorage n'est lisible qu'au montage client (évite l'hydratation SSR).
  useEffect(() => { setStored(loadLastPortfolio()); }, []);

  if (!stored) {
    return (
      <div className={`${ZONE_FRAME} items-center text-center border border-dashed border-line`}>
        <Wallet size={20} className="text-muted" />
        <div>
          <p className="text-meta text-ink-2">Aucun portefeuille à importer</p>
          <p className="text-caption text-muted mt-0.5">Construisez-en un dans l'onglet Portefeuille.</p>
        </div>
        <Link
          href="/portefeuille/construire"
          className="inline-flex items-center gap-1 text-caption text-accent-ink hover:underline"
        >
          Aller au portefeuille <ArrowRight size={12} />
        </Link>
      </div>
    );
  }

  const count = stored.lines.length;
  return (
    <div className={`${ZONE_FRAME} border border-line bg-paper`}>
      <div className="flex items-center gap-2">
        <Wallet size={15} className="text-accent-ink shrink-0" />
        <p className="text-meta text-ink font-medium">Portefeuille construit</p>
      </div>
      <p className="text-caption text-muted">
        {count} support{count > 1 ? "s" : ""}
        {stored.montant != null && <> · {stored.montant.toLocaleString("fr-FR")} €</>}
        {stored.contract && <> · {stored.contract.split("::")[1]}</>}
      </p>
      <button
        type="button"
        onClick={() => onImport(stored.lines, stored.montant)}
        className="mt-1 w-full rounded-md bg-brown text-paper text-meta font-medium px-3 py-1.5 transition-colors hover:bg-brown/90"
      >
        Importer ce portefeuille
      </button>
    </div>
  );
}
