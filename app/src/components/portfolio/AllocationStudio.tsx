"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { PageShell } from "@/components/ui/Page";
import { ClientProfileForm } from "@/components/profile/ClientProfileForm";
import { AllocationReport } from "@/components/portfolio/AllocationReport";
import { MarkowitzChart } from "@/components/portfolio/MarkowitzChart";
import { covarianceMatrix } from "@/lib/correlation";
import { DEFAULT_CONSTRAINTS, optimizeAllocation, type AllocationResult } from "@/lib/optimizer";
import { buildPresentation, profileFromSri, type AllocationPresentation } from "@/lib/allocationRationale";
import { profileToConstraints, filterFundsByProfile } from "@/lib/profileToConstraints";
import { SAMPLE_UNIVERSE, sampleCorrelation, SAMPLE_CONTRACT } from "@/lib/sampleUniverse";
import { loadStoredProfile, type RichClientProfile } from "@/lib/clientProfile";

// Plateforme d'allocation : réutilise le PROFIL CLIENT saisi à l'accueil (même
// formulaire, mêmes données, partagées via le stockage local) → génère
// automatiquement l'allocation optimisée + la présentation. Pas de re-saisie.
// Version démo : univers d'exemple côté navigateur ; en production, on branche
// sur /api/portfolio/optimize (fonds réels du contrat).

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const RISK_LABEL: Record<string, string> = {
  prudent: "Prudent", modere: "Modéré", equilibre: "Équilibré",
  dynamique: "Dynamique", offensif: "Offensif",
};
const ESG_LABEL: Record<string, string> = {
  indifferent: "Indifférent", art8: "Art. 8+", art9: "Art. 9", labelise: "Labellisé",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-meta text-muted">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "border border-line rounded-lg px-3 py-2 text-meta text-ink bg-paper focus:outline-none focus:border-clay";

function profileSummary(p: RichClientProfile, dropped: number): string {
  const bits: string[] = [];
  bits.push(`Profil ${RISK_LABEL[p.risk_profile ?? "equilibre"] ?? "Équilibré"}`);
  if (p.asset_classes.length) bits.push(`classes : ${p.asset_classes.join(", ")}`);
  if (p.esg && p.esg !== "indifferent") bits.push(`ESG ${ESG_LABEL[p.esg]}`);
  if (p.max_ter != null) bits.push(`frais max ${p.max_ter} %`);
  if (p.perte_max && p.perte_max !== "illimitee") bits.push(`perte max ${p.perte_max} %`);
  if (dropped > 0) bits.push(`${dropped} fonds écartés par le filtre`);
  return bits.join("  ·  ");
}

export function AllocationStudio() {
  const [maxPerFund, setMaxPerFund] = useState("25");
  const [maxAssets, setMaxAssets] = useState("7");
  const [advisor, setAdvisor] = useState("");
  const [contract, setContract] = useState(SAMPLE_CONTRACT);

  const [presentation, setPresentation] = useState<AllocationPresentation | null>(null);
  const [result, setResult] = useState<AllocationResult | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [amountEur, setAmountEur] = useState<number | null>(null);
  const [horizon, setHorizon] = useState<number>(8);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pptBusy, setPptBusy] = useState(false);

  function generate() {
    // Lit le profil rempli à l'accueil (partagé via le stockage local).
    const profile = loadStoredProfile();
    setAmountEur(profile.amount_eur);
    setHorizon(profile.horizon_years ?? 8);

    // Filtre l'univers selon les préférences dures (frais max, ESG).
    const filtered = filterFundsByProfile(SAMPLE_UNIVERSE, profile);
    const tooStrict = filtered.funds.length < 4;
    const universe = tooStrict ? SAMPLE_UNIVERSE : filtered.funds;

    const base = profileToConstraints(profile);
    const res = optimizeAllocation(universe, sampleCorrelation, {
      ...base,
      minAssets: 4,
      maxAssets: Math.min(Math.max(Number(maxAssets) || 7, 4), 10),
      maxWeightPerFund: Math.min(Math.max(Number(maxPerFund) || 25, 10), 100) / 100,
    });
    if (tooStrict && filtered.dropped > 0) {
      res.notes.unshift("Filtre profil trop restrictif sur l'univers d'exemple : allocation calculée sur l'univers complet.");
    }

    const now = new Date();
    const contractName = contract.includes("::") ? contract.split("::")[1] : contract;
    const pres = buildPresentation(res, {
      contractName,
      universeSize: universe.length,
      advisorName: advisor.trim() || null,
      asOfLabel: `${MONTHS_FR[now.getMonth()]} ${now.getFullYear()}`,
      profileLabel: profile.risk_profile ? RISK_LABEL[profile.risk_profile] : profileFromSri(res.weightedSri),
    });
    setResult(res);
    setPresentation(pres);
    setSummary(profileSummary(profile, tooStrict ? 0 : filtered.dropped));
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
      triggerDownload(blob, `allocation-${presentation.headline.profileLabel.toLowerCase()}.pdf`);
    } catch {
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
      await buildAllocationDeck(presentation).writeFile({
        fileName: `allocation-${presentation.headline.profileLabel.toLowerCase()}.pptx`,
      });
    } catch {
      /* génération navigateur indisponible : le PDF reste dispo */
    } finally {
      setPptBusy(false);
    }
  }

  function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const projected =
    result && amountEur && amountEur > 0
      ? amountEur * Math.pow(1 + result.expectedReturn, Math.max(1, horizon))
      : null;

  // Covariance des lignes retenues (pour le plan de Markowitz interactif) —
  // reconstruite depuis les corrélations de l'univers de démo.
  const resultCov = useMemo(() => {
    if (!result || result.lines.length === 0) return null;
    const corr = result.lines.map((a, i) =>
      result.lines.map((b, j) => (i === j ? 1 : sampleCorrelation(a.isin, b.isin))),
    );
    return covarianceMatrix(result.lines.map((l) => l.volatility), corr, 0);
  }, [result]);

  return (
    <PageShell className="space-y-6">
      <div>
        <h1 className="text-heading text-ink font-semibold">Allocation optimisée</h1>
        <p className="text-meta text-muted">
          Le profil client saisi à l'accueil est réutilisé ici : renseignez-le (ou laissez celui déjà rempli),
          puis générez l'allocation.
        </p>
      </div>

      {/* Profil client — LE MÊME formulaire que l'accueil, données partagées */}
      <Card className="px-5 py-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-label text-ink font-semibold">Profil du client</h2>
          <span className="text-meta text-muted">Partagé avec l'accueil · enregistré automatiquement</span>
        </div>
        <ClientProfileForm />
      </Card>

      {/* Paramètres propres à l'allocation */}
      <Card className="px-5 py-5">
        <h2 className="text-label text-ink font-semibold mb-4">Paramètres de l'allocation</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Contrat">
            <input className={inputCls} value={contract} onChange={(e) => setContract(e.target.value)} />
          </Field>
          <Field label="Poids max. par fonds (%)">
            <input className={inputCls} type="number" min={10} max={100} value={maxPerFund} onChange={(e) => setMaxPerFund(e.target.value)} />
          </Field>
          <Field label="Nombre max. de supports">
            <input className={inputCls} type="number" min={4} max={10} value={maxAssets} onChange={(e) => setMaxAssets(e.target.value)} />
          </Field>
          <Field label="Cabinet / conseiller (optionnel)">
            <input className={inputCls} value={advisor} onChange={(e) => setAdvisor(e.target.value)} placeholder="Ex. Métagram Gestion Privée" />
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
          {summary && (
            <Card className="px-5 py-3 bg-paper-2">
              <span className="text-meta text-ink-2">Profil utilisé — {summary}</span>
            </Card>
          )}
          {projected != null && (
            <Card className="px-5 py-4 bg-paper-2">
              <span className="text-meta text-ink-2">
                Projection indicative : {amountEur!.toLocaleString("fr-FR")} € à ~{(result.expectedReturn * 100).toFixed(1)} %/an
                sur {horizon} ans ≈ <strong>{Math.round(projected).toLocaleString("fr-FR")} €</strong>
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
            <Btn variant="primary" size="sm" loading={pptBusy} onClick={downloadPptx}>Télécharger (PowerPoint)</Btn>
            <Btn variant="outline" size="sm" loading={pdfBusy} onClick={downloadPdf}>Télécharger (PDF)</Btn>
          </div>
          {resultCov && (
            <MarkowitzChart lines={result.lines} cov={resultCov} riskFree={DEFAULT_CONSTRAINTS.riskFree} />
          )}
          <AllocationReport presentation={presentation} />
        </>
      )}
    </PageShell>
  );
}
