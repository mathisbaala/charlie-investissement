"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { PageShell } from "@/components/ui/Page";
import { AllocationReport } from "@/components/portfolio/AllocationReport";
import { optimizeAllocation, type AllocationResult } from "@/lib/optimizer";
import { buildPresentation, type AllocationPresentation } from "@/lib/allocationRationale";
import { profileToConstraints } from "@/lib/profileToConstraints";
import { SAMPLE_UNIVERSE, sampleCorrelation, SAMPLE_CONTRACT } from "@/lib/sampleUniverse";
import type { RiskProfile } from "@/lib/clientProfile";

// Plateforme d'allocation : le conseiller saisit le profil du client → l'outil
// génère automatiquement l'allocation optimisée et sa présentation. Cette version
// tourne côté navigateur sur un UNIVERS D'EXEMPLE (démo sans base) ; en production
// on remplace la génération locale par un appel à /api/portfolio/optimize (mêmes
// types de retour). Aucune API payante, aucun LLM.

const RISK_OPTIONS: { value: RiskProfile; label: string }[] = [
  { value: "prudent", label: "Prudent" },
  { value: "modere", label: "Modéré" },
  { value: "equilibre", label: "Équilibré" },
  { value: "dynamique", label: "Dynamique" },
  { value: "offensif", label: "Offensif" },
];

const OBJECTIFS = [
  { value: "capitalisation", label: "Capitalisation" },
  { value: "revenus", label: "Revenus" },
  { value: "retraite", label: "Retraite" },
  { value: "transmission", label: "Transmission" },
];

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-meta text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "border border-line rounded-lg px-3 py-2 text-meta text-ink bg-paper focus:outline-none focus:border-clay";

export function AllocationStudio() {
  const [risk, setRisk] = useState<RiskProfile>("equilibre");
  const [amount, setAmount] = useState<string>("100000");
  const [horizon, setHorizon] = useState<string>("8");
  const [objectif, setObjectif] = useState<string>("capitalisation");
  const [maxPerFund, setMaxPerFund] = useState<string>("25");
  const [maxAssets, setMaxAssets] = useState<string>("7");
  const [advisor, setAdvisor] = useState<string>("");
  const [contract, setContract] = useState<string>(SAMPLE_CONTRACT);

  const [presentation, setPresentation] = useState<AllocationPresentation | null>(null);
  const [result, setResult] = useState<AllocationResult | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pptBusy, setPptBusy] = useState(false);

  function generate() {
    const base = profileToConstraints({
      risk_profile: risk,
      asset_classes: [],
      max_ter: null,
    });
    const res = optimizeAllocation(SAMPLE_UNIVERSE, sampleCorrelation, {
      ...base,
      minAssets: 4,
      maxAssets: Math.min(Math.max(Number(maxAssets) || 7, 4), 10),
      maxWeightPerFund: Math.min(Math.max(Number(maxPerFund) || 25, 10), 100) / 100,
    });
    const now = new Date();
    const contractName = contract.includes("::") ? contract.split("::")[1] : contract;
    const pres = buildPresentation(res, {
      contractName,
      universeSize: SAMPLE_UNIVERSE.length,
      advisorName: advisor.trim() || null,
      asOfLabel: `${MONTHS_FR[now.getMonth()]} ${now.getFullYear()}`,
    });
    setResult(res);
    setPresentation(pres);
  }

  async function downloadPdf() {
    if (!presentation) return;
    setPdfBusy(true);
    try {
      const [{ pdf }, { default: AllocationReportPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/AllocationReportPDF"),
      ]);
      const blob = await pdf(<AllocationReportPDF presentation={presentation} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `allocation-${presentation.headline.profileLabel.toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Rendu PDF navigateur indisponible : l'utilisateur peut imprimer la page.
      window.print();
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadPptx() {
    if (!presentation) return;
    setPptBusy(true);
    try {
      const { buildAllocationDeck } = await import("@/lib/allocationPptx");
      const deck = buildAllocationDeck(presentation);
      await deck.writeFile({ fileName: `allocation-${presentation.headline.profileLabel.toLowerCase()}.pptx` });
    } catch {
      // Génération indisponible côté navigateur : le PDF reste disponible.
    } finally {
      setPptBusy(false);
    }
  }

  const amountNum = Number(amount) || 0;
  const projected =
    result && amountNum > 0
      ? amountNum * Math.pow(1 + result.expectedReturn, Math.max(1, Number(horizon) || 1))
      : null;

  return (
    <PageShell className="space-y-6">
      <div>
        <h1 className="text-heading text-ink font-semibold">Allocation optimisée</h1>
        <p className="text-meta text-muted">
          Renseignez le profil du client — l'allocation et sa présentation sont générées automatiquement.
        </p>
      </div>

      {/* Formulaire profil client */}
      <Card className="px-5 py-5">
        <h2 className="text-label text-ink font-semibold mb-4">Profil du client</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Profil de risque (MIF)">
            <select className={inputCls} value={risk} onChange={(e) => setRisk(e.target.value as RiskProfile)}>
              {RISK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Montant à investir (€)">
            <input className={inputCls} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Horizon (années)">
            <input className={inputCls} type="number" min={1} value={horizon} onChange={(e) => setHorizon(e.target.value)} />
          </Field>
          <Field label="Objectif">
            <select className={inputCls} value={objectif} onChange={(e) => setObjectif(e.target.value)}>
              {OBJECTIFS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Poids max. par fonds (%)">
            <input className={inputCls} type="number" min={10} max={100} value={maxPerFund} onChange={(e) => setMaxPerFund(e.target.value)} />
          </Field>
          <Field label="Nombre max. de supports">
            <input className={inputCls} type="number" min={4} max={10} value={maxAssets} onChange={(e) => setMaxAssets(e.target.value)} />
          </Field>
          <Field label="Contrat">
            <input className={inputCls} type="text" value={contract} onChange={(e) => setContract(e.target.value)} />
          </Field>
          <Field label="Cabinet / conseiller (optionnel)">
            <input className={inputCls} type="text" value={advisor} onChange={(e) => setAdvisor(e.target.value)} placeholder="Ex. Métagram Gestion Privée" />
          </Field>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Btn variant="primary" size="md" onClick={generate}>Générer l'allocation</Btn>
          <span className="text-meta text-muted">
            Univers de démonstration ({SAMPLE_UNIVERSE.length} fonds). En production : les fonds réels du contrat.
          </span>
        </div>
      </Card>

      {/* Résultat */}
      {presentation && result && (
        <>
          {projected != null && (
            <Card className="px-5 py-4 bg-paper-2">
              <span className="text-meta text-ink-2">
                Projection indicative : {amountNum.toLocaleString("fr-FR")} € investis à ~{(result.expectedReturn * 100).toFixed(1)} %/an
                sur {Number(horizon) || 1} ans ≈ <strong>{Math.round(projected).toLocaleString("fr-FR")} €</strong>
                {" "}(hors frais et fiscalité, performances non garanties).
              </span>
            </Card>
          )}

          {result.notes.length > 0 && (
            <Card className="px-5 py-3">
              <ul className="space-y-1">
                {result.notes.map((n, i) => (
                  <li key={i} className="text-meta text-muted">ⓘ {n}</li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Btn variant="primary" size="sm" loading={pptBusy} onClick={downloadPptx}>
              Télécharger (PowerPoint)
            </Btn>
            <Btn variant="outline" size="sm" loading={pdfBusy} onClick={downloadPdf}>
              Télécharger (PDF)
            </Btn>
          </div>

          <AllocationReport presentation={presentation} />
        </>
      )}
    </PageShell>
  );
}
