"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SESSION_KEY, type SelectedFund } from "@/components/SelectionProvider";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { Chip } from "@/components/ui/Chip";
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
    included, setIncluded, includeFund, unreferencedIsins, source, linesIsins,
    profile, onProfileChange, busy, errorMsg, compute,
    aiVerify, setAiVerify,
  } = usePortfolioStudio();

  // Import des fonds sélectionnés au screener : la barre de sélection redirige
  // vers /portefeuille/construire?isins=… . On lit ces ISIN une seule fois au
  // montage, on les impose au portefeuille (nom récupéré depuis la sélection
  // stockée, repli sur l'ISIN), puis on nettoie l'URL pour qu'un rafraîchissement
  // ne réimporte pas. Lecture directe du sessionStorage (et non du contexte de
  // sélection) : les noms sont dispo tout de suite, sans dépendre de l'ordre de
  // montage des effets.
  const importedRef = useRef(false);
  useEffect(() => {
    if (importedRef.current) return;
    importedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("isins");
    if (!raw) return;
    const isins = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (isins.length) {
      let nameByIsin = new Map<string, string>();
      try {
        const saved = sessionStorage.getItem(SESSION_KEY);
        if (saved) {
          const list = JSON.parse(saved) as SelectedFund[];
          nameByIsin = new Map(list.map((f) => [f.isin, f.name]));
        }
      } catch {}
      isins.forEach((isin) => includeFund(isin, nameByIsin.get(isin) ?? isin));
    }
    params.delete("isins");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [includeFund]);

  // Périmètre du sélecteur de contrat : les assureurs renseignés (distribution
  // du profil, pré-remplie depuis Mon cabinet) + les partenaires du cabinet.
  // Vide → recherche dans tous les contrats de la base.
  const scopeInsurers = [...new Set([...profile.insurers, ...cabinet.insurers])];
  const cabinetKeys = new Set(cabinet.contracts.map((c) => c.key));

  // Au moins un support imposé n'est pas référencé dans le contrat courant :
  // la génération est bloquée tant qu'il n'est pas retiré.
  const hasUnreferenced = included.some((f) => unreferencedIsins.has(f.isin));

  async function generate() {
    if (hasUnreferenced) return; // garde : le bouton est déjà désactivé
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
                  {included.map((f) => {
                    // Support non référencé dans le contrat courant → pastille
                    // rouge + il bloque la génération tant qu'il n'est pas retiré.
                    const unref = unreferencedIsins.has(f.isin);
                    return (
                      <span
                        key={f.isin}
                        className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${unref ? "border-danger text-danger bg-danger-soft" : "border-line text-ink-2 bg-paper-2"}`}
                      >
                        {shortName(f.name, 28)}
                        {unref && <span className="font-medium">· non référencé</span>}
                        <button
                          aria-label={`Ne plus imposer ${f.name}`}
                          onClick={() => setIncluded((prev) => prev.filter((x) => x.isin !== f.isin))}
                          className={unref ? "text-danger hover:opacity-70" : "text-muted hover:text-danger"}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    );
                  })}
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
                    <Chip active={method === "sharpe"} onClick={() => setMethod("sharpe")}>
                      Max-Sharpe
                    </Chip>
                    <Chip active={method === "hrp"} onClick={() => setMethod("hrp")}>
                      HRP
                    </Chip>
                  </div>
                  <span className="text-meta text-muted">
                    {method === "sharpe"
                      ? "Optimise le couple rendement/risque."
                      : "Répartit le risque par familles corrélées."}
                  </span>
                </div>

                {/* À adéquation égale pour le client, on préfère le fonds qui
                    rémunère le mieux le cabinet — jamais au détriment du client. */}
                <div className="flex flex-col gap-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={retroTilt}
                      onChange={(e) => setRetroTilt(e.target.checked)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span className="text-meta text-ink font-medium">
                      Privilégier les fonds les mieux rémunérés pour le cabinet
                    </span>
                  </label>
                  <span className="text-meta text-muted">
                    Entre deux fonds aussi adaptés au client, retient celui qui rapporte le plus au cabinet.
                  </span>
                </div>

                {/* Vérification IA : le moteur alloue, l'IA relit (grille type
                    Finary — diversification, adéquation horizon/profil,
                    redondances) et fait re-calculer si besoin. Coût affiché. */}
                <div className="flex flex-col gap-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={aiVerify}
                      onChange={(e) => setAiVerify(e.target.checked)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span className="text-meta text-ink font-medium">
                      Vérification IA du portefeuille
                    </span>
                  </label>
                  <span className="text-meta text-muted">
                    Après le calcul, une IA contrôle diversification, adéquation horizon/profil et
                    redondances, corrige si besoin (via le moteur) et affiche le coût de l&apos;appel.
                  </span>
                </div>
              </div>
            )}
          </div>

        <div className="mt-5 flex flex-col gap-2">
          {hasUnreferenced && (
            <span className="text-meta text-danger">
              ⓘ Retirez les supports non référencés dans le contrat pour générer le portefeuille.
            </span>
          )}
          <Btn
            variant="primary"
            size="md"
            loading={busy}
            disabled={hasUnreferenced}
            onClick={() => void generate()}
            className="w-fit"
          >
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
