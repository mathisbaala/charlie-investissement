"use client";

// Onglet Calculateurs — parcours en TROIS ÉTAPES pleine page (choix produit du
// 22/07, exit la grille de cartes) :
//   1. « Décrivez la situation » : une seule zone de texte naturel.
//   2. Formulaire du calculateur identifié par l'IA, pré-rempli — le CGP
//      complète les champs manquants.
//   3. Résultat visuel (KPI, barème, graphiques).
// Une flèche retour en haut à gauche ramène à l'étape précédente (la demande et
// les valeurs saisies sont conservées). Le CALCUL reste 100 % déterministe
// (lib/calculators) — l'IA ne fait que router et pré-remplir.

import { useState } from "react";
import { PageShell } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { Chip } from "@/components/ui/Chip";
import { Sparkle, ArrowLeft } from "@/components/ui/icons";
import { CALCULATORS, CALCULATOR_BY_ID } from "@/lib/calculators/registry";
import type { CalcResult, CalcValues } from "@/lib/calculators/types";
import { CalcForm } from "./CalcForm";
import { CalcResultView } from "./CalcResultView";

type Step = "ask" | "form" | "result";

/** Flèche retour vers l'étape précédente — même geste à chaque étape. */
function BackArrow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-meta text-muted hover:text-ink mb-6"
    >
      <ArrowLeft size={15} /> {label}
    </button>
  );
}

export function CalculateursClient() {
  const [step, setStep] = useState<Step>("ask");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<CalcValues>({});
  const [aiKeys, setAiKeys] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CalcResult | null>(null);

  const openForm = (id: string, prefill: CalcValues = {}, fromAi = false) => {
    setSelectedId(id);
    setValues(prefill);
    setAiKeys(fromAi ? new Set(Object.keys(prefill)) : new Set());
    setResult(null);
    setCandidates([]);
    setStep("form");
  };

  const ask = async () => {
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true);
    setAiNote(null);
    setCandidates([]);
    try {
      const res = await fetch("/api/calculateurs/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setAiNote(j?.error ?? "Analyse indisponible — choisissez un calculateur ci-dessous.");
        return;
      }
      const j = (await res.json()) as { calculatorId: string | null; candidates: string[]; values: CalcValues };
      if (j.calculatorId) {
        openForm(j.calculatorId, j.values, true);
      } else if (j.candidates.length > 0) {
        setCandidates(j.candidates);
        setAiNote("Plusieurs calculateurs peuvent répondre — précisez :");
      } else {
        setAiNote("Demande non reconnue — reformulez, ou choisissez un calculateur :");
      }
    } catch {
      setAiNote("Analyse indisponible — choisissez un calculateur ci-dessous :");
    } finally {
      setBusy(false);
    }
  };

  const selected = selectedId ? CALCULATOR_BY_ID[selectedId] : null;

  // ── Étape 3 : résultat ──────────────────────────────────────────────────────
  if (step === "result" && selected && result) {
    return (
      <PageShell>
        <BackArrow label="Modifier les paramètres" onClick={() => setStep("form")} />
        <h2 className="text-title-lg text-ink mb-1">{selected.title}</h2>
        <p className="text-meta text-muted mb-5">{selected.description}</p>
        <CalcResultView result={result} />
        <div className="mt-8">
          <Btn
            variant="outline"
            onClick={() => {
              setStep("ask");
              setQuery("");
              setAiNote(null);
            }}
          >
            Nouveau calcul
          </Btn>
        </div>
      </PageShell>
    );
  }

  // ── Étape 2 : formulaire pré-rempli ────────────────────────────────────────
  if (step === "form" && selected) {
    return (
      <PageShell>
        <BackArrow label="Modifier ma demande" onClick={() => setStep("ask")} />
        <Card className="p-4 sm:p-6">
          <h2 className="text-title text-ink mb-1">{selected.title}</h2>
          <p className="text-meta text-muted mb-5">{selected.description}</p>
          <CalcForm
            def={selected}
            values={values}
            aiKeys={aiKeys}
            onChange={(v) => {
              setValues(v);
              setResult(null);
            }}
            onResult={(r) => {
              setResult(r);
              setStep("result");
            }}
          />
        </Card>
      </PageShell>
    );
  }

  // ── Étape 1 : la demande en langage naturel ────────────────────────────────
  return (
    <PageShell className="flex flex-col justify-center min-h-full" maxWidth="720px">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-3">
          <Sparkle size={18} className="text-brown" />
          <span className="text-caption uppercase tracking-widest text-muted font-semibold">
            Calculateurs patrimoniaux
          </span>
        </div>
        <h1 className="text-title-lg text-ink mb-2">Décrivez la situation de votre client.</h1>
        <p className="text-meta text-muted">
          Transmission, donation, succession, IFI… — le bon calculateur s&apos;ouvre, pré-rempli.
        </p>
      </div>

      <Card className="p-2 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          autoFocus
          placeholder="Ex. « Donation de 300 000 € à mon fils, que va-t-il payer ? »"
          className="flex-1 bg-transparent px-3.5 py-2.5 text-body text-ink placeholder:text-muted focus:outline-none"
        />
        <Btn variant="primary" onClick={ask} loading={busy}>
          Analyser
        </Btn>
      </Card>

      {aiNote && <p className="text-meta text-muted mt-4 text-center">{aiNote}</p>}

      {/* Ambiguïté : l'IA propose 2-3 calculateurs — un clic ouvre le formulaire vide. */}
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 justify-center">
          {candidates.map((id) => (
            <Chip key={id} active={false} onClick={() => openForm(id)}>
              {CALCULATOR_BY_ID[id]?.title ?? id}
            </Chip>
          ))}
        </div>
      )}

      {/* Repli sans IA (échec ou demande non reconnue) : sélecteur discret. */}
      {aiNote && candidates.length === 0 && (
        <div className="mt-3 flex justify-center">
          <select
            className="rounded-lg border border-line bg-paper px-3 py-2 text-meta text-ink-2 focus:outline-none focus:border-brown/50"
            value=""
            onChange={(e) => e.target.value && openForm(e.target.value)}
          >
            <option value="">— Choisir un calculateur —</option>
            {CALCULATORS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
    </PageShell>
  );
}
