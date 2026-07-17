"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { X, ChevronDown, ChevronRight, ArrowLeft } from "@/components/ui/icons";
import { PageShell } from "@/components/ui/Page";
import { ClientProfileForm } from "@/components/profile/ClientProfileForm";
import { FundAdder } from "@/components/portfolio/FundAdder";
import { ContractPicker } from "@/components/portfolio/ContractPicker";
import { SAMPLE_UNIVERSE } from "@/lib/sampleUniverse";
import { usePortfolioStudio, shortName } from "@/components/portfolio/PortfolioStudioContext";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-meta text-muted">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "border border-line rounded-lg px-3 py-2 text-meta text-ink bg-paper focus:outline-none focus:border-clay";

// Chemin « construire » de l'atelier : profil client (étape 1) + réglages du
// conseiller (étape 2). « Générer le portefeuille » lance le calcul puis
// redirige vers la page dédiée /portefeuille/construire/resultat (état conservé
// par le contexte du layout /portefeuille/construire).
export function StudioInputs() {
  const router = useRouter();
  const {
    maxPerFund, setMaxPerFund, maxAssets, setMaxAssets, advisor, setAdvisor,
    contract, setContract, method, setMethod, showAdvanced, setShowAdvanced,
    retroTilt, setRetroTilt, cabinet, sriOverride, setSriOverride, effectiveSri,
    included, setIncluded, includeFund, source, linesIsins,
    profile, onProfileChange, busy, errorMsg, compute,
  } = usePortfolioStudio();

  // Périmètre du sélecteur de contrat : les assureurs renseignés (distribution
  // du profil, pré-remplie depuis Mon cabinet) + les partenaires du cabinet.
  // Vide → recherche dans tous les contrats de la base.
  const scopeInsurers = [...new Set([...profile.insurers, ...cabinet.insurers])];
  const cabinetKeys = new Set(cabinet.contracts.map((c) => c.key));

  async function generate() {
    const ok = await compute();
    if (ok) router.push("/portefeuille/construire/resultat");
  }

  return (
    <PageShell className="space-y-5">
      <Link
        href="/portefeuille"
        className="inline-flex items-center gap-1 text-meta text-muted hover:text-ink transition-colors w-fit"
      >
        <ArrowLeft size={14} /> Portefeuille
      </Link>

      {/* Étape 1 — Profil du client (données CLIENT). Depuis la refonte de nav,
          le profil ne se saisit plus qu'ici (retiré de l'accueil). */}
      <Card className="px-5 py-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-brown text-paper text-caption font-semibold shrink-0">1</span>
          <h2 className="text-body-lg text-ink font-semibold">Profil du client</h2>
        </div>
        <ClientProfileForm showSearchCta={false} onChange={onProfileChange} />
      </Card>

      {/* Étape 2 — Portefeuille : réglages du CONSEILLER puis génération. */}
      <Card className="px-5 py-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-brown text-paper text-caption font-semibold shrink-0">2</span>
          <h2 className="text-body-lg text-ink font-semibold">Portefeuille</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Contrat">
              <ContractPicker
                value={contract}
                onChange={setContract}
                scopeInsurers={scopeInsurers}
                cabinetKeys={cabinetKeys}
              />
            </Field>
            <Field label="Poids max. par fonds (%)">
              <input className={inputCls} type="number" min={10} max={100} value={maxPerFund} onChange={(e) => setMaxPerFund(e.target.value)} />
            </Field>
            <Field label="Nombre max. de supports">
              <input className={inputCls} type="number" min={4} max={10} value={maxAssets} onChange={(e) => setMaxAssets(e.target.value)} />
            </Field>
            <Field label="Cabinet / conseiller (optionnel)">
              <input className={inputCls} value={advisor} onChange={(e) => setAdvisor(e.target.value)} placeholder="Ex. Charlie Gestion Privée" />
            </Field>
          </div>

          {/* Risque : plafond SRI jouable par le conseiller */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-meta text-muted">
                Risque maximal (SRI par fonds) : <strong className="text-ink">{effectiveSri} / 7</strong>
              </span>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={7}
                  step={1}
                  value={effectiveSri}
                  aria-label="Plafond SRI par fonds"
                  onChange={(e) => setSriOverride(Number(e.target.value))}
                  className="w-56"
                  style={{ accentColor: "var(--color-accent)" }}
                />
                {sriOverride != null && (
                  <button
                    className="text-meta text-muted hover:text-ink underline underline-offset-2"
                    onClick={() => setSriOverride(null)}
                  >
                    Revenir au profil
                  </button>
                )}
              </div>
            </div>

            {/* Ajout d'un fonds imposé, dès le départ */}
            <div className="flex flex-col gap-1">
              <span className="text-meta text-muted">Imposer un fonds dans le portefeuille</span>
              {source === "demo" ? (
                <select
                  className={inputCls}
                  value=""
                  aria-label="Imposer un fonds (univers d'exemple)"
                  onChange={(e) => {
                    const f = SAMPLE_UNIVERSE.find((x) => x.isin === e.target.value);
                    if (f) includeFund(f.isin, f.name);
                  }}
                >
                  <option value="">Choisir dans l&apos;univers d&apos;exemple…</option>
                  {SAMPLE_UNIVERSE.filter((f) => !linesIsins.has(f.isin) && !included.some((i) => i.isin === f.isin)).map((f) => (
                    <option key={f.isin} value={f.isin}>{f.name}</option>
                  ))}
                </select>
              ) : (
                <FundAdder
                  onAdd={(isin, name) => includeFund(isin, name)}
                  existing={new Set([...included.map((f) => f.isin), ...linesIsins])}
                />
              )}
              {included.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {included.map((f) => (
                    <span key={f.isin} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-line text-ink-2 bg-paper-2">
                      {shortName(f.name, 28)}
                      <button
                        aria-label={`Ne plus imposer ${f.name}`}
                        onClick={() => setIncluded((prev) => prev.filter((x) => x.isin !== f.isin))}
                        className="text-muted hover:text-danger"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Réglages avancés : moteur de pondération + départage rétrocessions,
              repliés par défaut pour ne montrer d'emblée que l'essentiel. */}
          <div className="mt-4 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="inline-flex items-center gap-1.5 text-meta text-ink-2 font-medium hover:text-ink transition-colors"
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Réglages avancés
              {!showAdvanced && (method !== "sharpe" || retroTilt) && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-accent" aria-label="réglages personnalisés actifs" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-4">
                {/* Méthode de pondération : deux moteurs, mêmes contraintes. */}
                <div className="flex flex-col gap-1">
                  <span className="text-meta text-muted">Moteur de pondération</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMethod("sharpe")}
                      className={`px-3.5 py-2 rounded-lg text-meta font-medium border transition-all ${
                        method === "sharpe"
                          ? "bg-brown text-paper border-brown shadow-sm"
                          : "bg-paper text-ink-2 border-line hover:border-brown/30"
                      }`}
                    >
                      Max-Sharpe
                    </button>
                    <button
                      type="button"
                      onClick={() => setMethod("hrp")}
                      className={`px-3.5 py-2 rounded-lg text-meta font-medium border transition-all ${
                        method === "hrp"
                          ? "bg-brown text-paper border-brown shadow-sm"
                          : "bg-paper text-ink-2 border-line hover:border-brown/30"
                      }`}
                    >
                      HRP
                    </button>
                  </div>
                  <span className="text-meta text-muted">
                    {method === "sharpe"
                      ? "Optimise le couple rendement/risque."
                      : "Répartit le risque par familles corrélées."}
                  </span>
                </div>

                {/* Départage rémunération cabinet : l'adéquation client reste première,
                    la rétrocession ne départage que des fonds quasi équivalents. */}
                <div className="flex flex-col gap-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={retroTilt}
                      onChange={(e) => setRetroTilt(e.target.checked)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span className="text-meta text-ink font-medium">
                      Départage rémunération cabinet (rétrocessions)
                    </span>
                  </label>
                  <span className="text-meta text-muted">
                    À adéquation équivalente, retient la meilleure rétrocession, jamais au détriment du client.
                  </span>
                </div>
              </div>
            )}
          </div>

        <div className="mt-5">
          <Btn variant="primary" size="md" loading={busy} onClick={() => void generate()}>
            Générer le portefeuille
          </Btn>
        </div>
      </Card>

      {errorMsg && (
        <Card className="px-5 py-3">
          <span className="text-meta text-danger">ⓘ {errorMsg}</span>
        </Card>
      )}
    </PageShell>
  );
}
