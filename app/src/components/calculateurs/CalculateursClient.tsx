"use client";

// Onglet Calculateurs : le CGP décrit sa situation en langage naturel — l'IA
// identifie le calculateur et pré-remplit ce qu'elle peut — le reste se
// complète au formulaire, et le CALCUL est 100 % déterministe côté client
// (lib/calculators). La grille reste accessible sans IA (clic direct).

import { useRef, useState } from "react";
import { PageShell } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { Chip } from "@/components/ui/Chip";
import { Sparkle, ArrowLeft } from "@/components/ui/icons";
import { CALCULATORS, CALCULATOR_BY_ID } from "@/lib/calculators/registry";
import type { CalcResult, CalcValues } from "@/lib/calculators/types";
import { CalcForm } from "./CalcForm";
import { CalcResultView } from "./CalcResultView";

const CATEGORY_LABELS: Record<string, string> = {
  transmission: "Transmission & succession",
};

export function CalculateursClient() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<CalcValues>({});
  const [aiKeys, setAiKeys] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CalcResult | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const select = (id: string, prefill: CalcValues = {}, fromAi = false) => {
    setSelectedId(id);
    setValues(prefill);
    setAiKeys(fromAi ? new Set(Object.keys(prefill)) : new Set());
    setResult(null);
    setCandidates([]);
    // Laisse le rendu poser le formulaire avant d'y amener l'écran.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
        setAiNote(j?.error ?? "Analyse indisponible — choisissez un calculateur dans la liste.");
        return;
      }
      const j = (await res.json()) as { calculatorId: string | null; candidates: string[]; values: CalcValues };
      if (j.calculatorId) {
        select(j.calculatorId, j.values, true);
        const n = Object.keys(j.values).length;
        setAiNote(n > 0 ? `${n} champ${n > 1 ? "s" : ""} pré-rempli${n > 1 ? "s" : ""} depuis votre demande.` : null);
      } else if (j.candidates.length > 0) {
        setCandidates(j.candidates);
        setAiNote("Plusieurs calculateurs peuvent répondre — précisez :");
      } else {
        setAiNote("Demande non reconnue — choisissez un calculateur dans la liste.");
      }
    } catch {
      setAiNote("Analyse indisponible — choisissez un calculateur dans la liste.");
    } finally {
      setBusy(false);
    }
  };

  const selected = selectedId ? CALCULATOR_BY_ID[selectedId] : null;
  const categories = [...new Set(CALCULATORS.map((c) => c.category))];

  return (
    <PageShell>
      {/* Barre de demande en langage naturel */}
      <Card className="p-4 sm:p-5 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Sparkle size={16} className="text-brown" />
          <p className="text-meta font-medium text-ink">
            Décrivez la situation — le bon calculateur s&apos;ouvre, pré-rempli.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Ex. « Donation de 300 000 € à mon fils, que va-t-il payer ? »"
            className="flex-1 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-body text-ink placeholder:text-muted focus:outline-none focus:border-brown/50"
          />
          <Btn variant="primary" onClick={ask} loading={busy}>
            Analyser
          </Btn>
        </div>
        {aiNote && <p className="text-meta text-muted mt-3">{aiNote}</p>}
        {candidates.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {candidates.map((id) => (
              <Chip key={id} active={false} onClick={() => select(id, {}, false)}>
                {CALCULATOR_BY_ID[id]?.title ?? id}
              </Chip>
            ))}
          </div>
        )}
      </Card>

      {/* Calculateur sélectionné : formulaire + résultat */}
      {selected && (
        <div ref={formRef} className="mb-10 scroll-mt-6">
          <button
            onClick={() => {
              setSelectedId(null);
              setResult(null);
            }}
            className="inline-flex items-center gap-1.5 text-meta text-muted hover:text-ink mb-3"
          >
            <ArrowLeft size={14} /> Tous les calculateurs
          </button>
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
              onResult={setResult}
            />
          </Card>
          {result && <CalcResultView result={result} />}
        </div>
      )}

      {/* Grille des calculateurs par famille (accès direct, sans IA) */}
      {categories.map((cat) => {
        const list = CALCULATORS.filter((c) => c.category === cat);
        return (
          <section key={cat} className="mb-10">
            <div className="flex items-baseline gap-2 mb-4">
              <h2 className="text-title text-ink">{CATEGORY_LABELS[cat] ?? cat}</h2>
              <span className="text-meta text-muted">{list.length} calculateurs</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {list.map((c) => (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  className={`text-left rounded-xl border bg-paper px-4 py-3.5 transition-colors ${
                    selectedId === c.id ? "border-brown/50" : "border-line-soft hover:border-brown/30"
                  }`}
                >
                  <p className="text-body font-medium text-ink mb-0.5">{c.title}</p>
                  <p className="text-meta text-muted line-clamp-2">{c.description}</p>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </PageShell>
  );
}
