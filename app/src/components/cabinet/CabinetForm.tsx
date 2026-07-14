"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { X } from "@/components/ui/icons";
import {
  EMPTY_CABINET,
  emptyContract,
  loadStoredCabinet,
  saveStoredCabinet,
  type CabinetSettings,
  type CabinetContract,
} from "@/lib/cabinet";

// Onglet Cabinet : données STRUCTURELLES du CGP, saisies une fois —
// partenariats assureurs, contrats distribués et conventions de rétrocession
// (cascade : taux par contrat + exceptions par fonds). L'allocation s'en sert
// pour proposer directement les bons contrats et estimer la rémunération sur
// les vrais taux au lieu de l'estimation de place.

const inputCls =
  "w-full border border-line rounded-lg px-3 py-2 text-meta bg-paper text-ink placeholder:text-muted focus:outline-none focus:border-brown/50 transition-colors";

interface ContractOption {
  company: string;
  key: string;
  contract?: string;
  funds?: number;
}

/** Saisie d'un pourcentage : affiche en %, stocke en fraction (null si vide). */
function PctInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  max = 100,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  ariaLabel: string;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        max={max}
        step={0.05}
        value={value == null ? "" : Math.round(value * 10000) / 100}
        onChange={(e) => {
          const n = e.target.value === "" ? null : Number(e.target.value);
          onChange(n == null || !Number.isFinite(n) ? null : Math.min(Math.max(n, 0), max) / 100);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`${inputCls} w-24`}
      />
      <span className="text-meta text-muted">%</span>
    </div>
  );
}

export function CabinetForm() {
  const [cabinet, setCabinet] = useState<CabinetSettings>(EMPTY_CABINET);
  const [initialized, setInitialized] = useState(false);

  // Référencement : contrats connus de la base, groupés par assureur.
  const [options, setOptions] = useState<ContractOption[]>([]);
  const [optStatus, setOptStatus] = useState<"loading" | "ready" | "error">("loading");
  const [insurerQuery, setInsurerQuery] = useState("");

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    setCabinet(loadStoredCabinet());
  }, [initialized]);

  useEffect(() => {
    if (!initialized) return;
    saveStoredCabinet(cabinet);
  }, [cabinet, initialized]);

  // IMPORTANT : repasser à true au (re)montage — en mode strict React (dev),
  // le composant est monté/démonté/remonté : sans cette remise à true, le ref
  // restait « démonté » et la réponse du fetch était ignorée pour toujours
  // (« Chargement du référencement… » infini).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const loadOptions = useCallback((attempt = 0) => {
    setOptStatus("loading");
    fetch("/api/screener/contracts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http"))))
      .then((j: { data?: ContractOption[] }) => {
        if (!mountedRef.current) return;
        setOptions(j.data ?? []);
        setOptStatus("ready");
      })
      .catch(() => {
        if (!mountedRef.current) return;
        if (attempt < 2) setTimeout(() => loadOptions(attempt + 1), 800 * (attempt + 1));
        else setOptStatus("error");
      });
  }, []);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  function toggleInsurer(company: string) {
    setCabinet((c) => {
      const has = c.insurers.includes(company);
      return {
        ...c,
        insurers: has ? c.insurers.filter((x) => x !== company) : [...c.insurers, company],
        // Retirer un assureur retire aussi ses contrats (et leurs conventions).
        contracts: has ? c.contracts.filter((k) => !k.key.startsWith(`${company}::`)) : c.contracts,
      };
    });
  }
  function toggleContract(key: string) {
    setCabinet((c) => {
      const has = c.contracts.some((x) => x.key === key);
      return {
        ...c,
        contracts: has
          ? c.contracts.filter((x) => x.key !== key)
          : [...c.contracts, emptyContract(key)],
      };
    });
  }
  function updateContract(key: string, patch: Partial<CabinetContract>) {
    setCabinet((c) => ({
      ...c,
      contracts: c.contracts.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    }));
  }

  const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const companies = [...new Set(options.map((o) => o.company))];
  const insurerMatches = insurerQuery.trim()
    ? companies
        .filter((cn) => !cabinet.insurers.includes(cn))
        .filter((cn) => normalize(cn).includes(normalize(insurerQuery)))
        .slice(0, 8)
    : [];

  return (
    <div className="space-y-5">
      {/* Identité */}
      <Card className="p-5 space-y-3">
        <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold">Nom du cabinet</p>
        <input
          className={`${inputCls} max-w-md`}
          value={cabinet.cabinetName}
          onChange={(e) => setCabinet((c) => ({ ...c, cabinetName: e.target.value }))}
          placeholder="Ex. Charlie Gestion Privée"
          aria-label="Nom du cabinet / conseiller"
        />
      </Card>

      {/* Partenariats */}
      <Card className="p-5 space-y-4">
        <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold">
          Assureurs partenaires
        </p>
        <div className="relative max-w-md">
          <input
            type="text"
            aria-label="Rechercher un assureur partenaire"
            value={insurerQuery}
            onChange={(e) => setInsurerQuery(e.target.value)}
            onFocus={() => { if (optStatus === "error") loadOptions(); }}
            placeholder="Rechercher un assureur…"
            autoComplete="off"
            className={inputCls}
          />
          {insurerQuery.trim() && (
            <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-60 overflow-y-auto scrollbar-thin rounded-lg border border-line bg-paper shadow-lg">
              {optStatus === "loading" ? (
                <p className="px-3 py-2 text-meta text-muted-2">Chargement du référencement…</p>
              ) : optStatus === "error" ? (
                <button type="button" onClick={() => loadOptions()}
                  className="block w-full text-left px-3 py-2 text-meta text-warn hover:bg-accent-soft/40">
                  Impossible de charger le référencement. Cliquez pour réessayer.
                </button>
              ) : insurerMatches.length === 0 ? (
                <p className="px-3 py-2 text-meta text-muted-2">Aucun assureur ne correspond.</p>
              ) : (
                insurerMatches.map((cn) => (
                  <button key={cn} type="button"
                    onClick={() => { toggleInsurer(cn); setInsurerQuery(""); }}
                    className="block w-full text-left px-3 py-2 text-meta text-ink-2 hover:bg-accent-soft/40">
                    {cn}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {cabinet.insurers.length === 0 && (
          <p className="text-meta text-muted">Ajoutez vos assureurs partenaires.</p>
        )}

        {/* Contrats par assureur + conventions */}
        {cabinet.insurers.map((company) => {
          const contractsOf = options.filter((o) => o.company === company);
          return (
            <div key={company} className="rounded-xl border border-line p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-meta font-semibold text-ink">{company}</p>
                <button type="button" onClick={() => toggleInsurer(company)}
                  aria-label={`Retirer ${company}`}
                  className="text-muted hover:text-danger transition-colors">
                  <X size={13} />
                </button>
              </div>
              {contractsOf.length === 0 ? (
                <p className="text-meta text-muted">
                  {optStatus === "ready"
                    ? "Aucun contrat référencé pour cet assureur dans la base."
                    : "Chargement des contrats…"}
                </p>
              ) : (
                contractsOf.map((o) => {
                  const selected = cabinet.contracts.find((x) => x.key === o.key) ?? null;
                  const label = o.contract ?? o.key.split("::")[1] ?? o.key;
                  return (
                    <div key={o.key} className="border-t border-line-soft pt-3 space-y-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={selected != null}
                          onChange={() => toggleContract(o.key)}
                          style={{ accentColor: "var(--color-accent)" }} />
                        <span className="text-meta text-ink">{label}</span>
                        {o.funds != null && (
                          <span className="text-caption text-muted-2">{o.funds} fonds</span>
                        )}
                      </label>
                      {selected && (
                        <div className="pl-6 space-y-2">
                          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-caption text-muted">
                                Frais de gestion du contrat (%/an)
                              </span>
                              <PctInput
                                value={selected.contractFeeShare}
                                onChange={(v) => updateContract(o.key, { contractFeeShare: v })}
                                placeholder="ex : 0,50"
                                ariaLabel={`Part frais de gestion : ${label}`}
                                max={5}
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-caption text-muted">
                                Rétrocession UC (% des frais des fonds)
                              </span>
                              <PctInput
                                value={selected.ucRetroShare}
                                onChange={(v) => updateContract(o.key, { ucRetroShare: v })}
                                placeholder="ex : 50"
                                ariaLabel={`Rétrocession UC : ${label}`}
                              />
                            </label>
                          </div>
                          {/* Exceptions par fonds */}
                          {selected.fundOverrides.map((ov, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <input
                                className={`${inputCls} w-44`}
                                value={ov.isin}
                                aria-label={`ISIN exception ${oi + 1} : ${label}`}
                                onChange={(e) =>
                                  updateContract(o.key, {
                                    fundOverrides: selected.fundOverrides.map((x, xi) =>
                                      xi === oi ? { ...x, isin: e.target.value.toUpperCase() } : x),
                                  })
                                }
                                placeholder="ISIN"
                              />
                              <PctInput
                                value={ov.share}
                                onChange={(v) =>
                                  updateContract(o.key, {
                                    fundOverrides: selected.fundOverrides.map((x, xi) =>
                                      xi === oi ? { ...x, share: v ?? 0 } : x),
                                  })
                                }
                                placeholder="ex : 60"
                                ariaLabel={`Part exception ${oi + 1} : ${label}`}
                              />
                              <button type="button"
                                aria-label={`Supprimer l'exception ${ov.isin || oi + 1}`}
                                onClick={() =>
                                  updateContract(o.key, {
                                    fundOverrides: selected.fundOverrides.filter((_, xi) => xi !== oi),
                                  })
                                }
                                className="text-muted hover:text-danger transition-colors">
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          <button type="button"
                            onClick={() =>
                              updateContract(o.key, {
                                fundOverrides: [...selected.fundOverrides, { isin: "", share: 0.5 }],
                              })
                            }
                            className="text-meta text-muted hover:text-ink underline underline-offset-2">
                            + Exception par fonds
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
        {cabinet.contracts.length > 0 && (
          <p className="text-caption text-muted-2 leading-snug">
            Cases vides = estimation de place (~50 % des frais en gestion active, 0 sur les ETF).
          </p>
        )}
      </Card>
    </div>
  );
}
