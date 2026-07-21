"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { X, ChevronDown, ChevronRight, Search, Loader2 } from "@/components/ui/icons";
import {
  EMPTY_CABINET,
  emptyContract,
  hasAnyConvention,
  loadStoredCabinet,
  saveStoredCabinet,
  searchInsurerContracts,
  type CabinetSettings,
  type CabinetContract,
} from "@/lib/cabinet";

// Onglet Cabinet : données STRUCTURELLES du CGP, saisies une fois —
// partenariats assureurs, contrats distribués et conventions de rétrocession
// (cascade : taux par contrat + exceptions par fonds). L'allocation s'en sert
// pour proposer directement les bons contrats et estimer la rémunération sur
// les vrais taux au lieu de l'estimation de place.
//
// Les contrats d'un assureur partenaire ne sont PAS rattachés d'office :
// certains assureurs en référencent soixante, tout afficher rendait la page
// illisible. Le CGP ajoute un à un, via une recherche par assureur, les
// contrats qu'il distribue réellement.

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

/**
 * Recherche des contrats d'UN assureur pour les ajouter au cabinet un à un.
 * Le menu s'ouvre au focus (les huit premiers contrats restants), se filtre à
 * la saisie et reste ouvert après un ajout — on enchaîne souvent plusieurs
 * contrats d'affilée ; le contrat ajouté disparaît simplement de la liste.
 */
function ContractSearch({
  company,
  options,
  existingKeys,
  onAdd,
  status,
  onRetry,
}: {
  company: string;
  options: ContractOption[];
  existingKeys: Set<string>;
  onAdd: (key: string) => void;
  status: "loading" | "ready" | "error";
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Fermer au clic extérieur (même pattern que le ContractPicker de l'atelier).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const hits = searchInsurerContracts(options, company, existingKeys, query);
  const pick = (key: string) => {
    onAdd(key);
    setQuery("");
  };

  return (
    <div ref={boxRef} className="relative max-w-md">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 focus-within:border-brown/50 transition-colors">
        {status === "loading" ? (
          <Loader2 size={13} className="text-muted shrink-0 animate-spin" />
        ) : (
          <Search size={13} className="text-muted shrink-0" />
        )}
        <input
          type="text"
          aria-label={`Rechercher un contrat ${company}`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); if (status === "error") onRetry(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (hits[0]) { e.preventDefault(); pick(hits[0].key); }
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          placeholder="Ajouter un contrat…"
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent text-meta text-ink placeholder:text-muted focus:outline-none"
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-60 overflow-y-auto scrollbar-thin rounded-lg border border-line bg-paper shadow-lg">
          {status === "error" ? (
            <button type="button" onClick={onRetry}
              className="block w-full text-left px-3 py-2 text-meta text-warn hover:bg-accent-soft/40">
              Impossible de charger le référencement. Cliquez pour réessayer.
            </button>
          ) : status === "loading" ? (
            <p className="px-3 py-2 text-meta text-muted-2">Chargement du référencement…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2 text-meta text-muted-2">
              {query.trim() ? "Aucun contrat ne correspond." : "Tous les contrats sont déjà ajoutés."}
            </p>
          ) : (
            hits.map((o) => (
              <button key={o.key} type="button" onClick={() => pick(o.key)}
                className="w-full text-left px-3 py-2 flex items-baseline gap-2 border-b border-line-soft last:border-0 hover:bg-accent-soft/40 transition-colors">
                <span className="text-meta text-ink-2 truncate">
                  {o.contract ?? o.key.split("::")[1] ?? o.key}
                </span>
                {o.funds != null && (
                  <span className="text-caption text-muted-2 shrink-0">{o.funds} fonds</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
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

  // Assureurs repliés (visuellement réduits à leur nom). Les assureurs déjà en
  // place au chargement arrivent repliés — dix partenaires ne font pas une page
  // interminable — ; un assureur qu'on vient d'ajouter s'ouvre, prêt à saisir.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    const stored = loadStoredCabinet();
    setCabinet(stored);
    setCollapsed(Object.fromEntries(stored.insurers.map((n) => [n, true])));
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
    // Un assureur fraîchement ajouté s'ouvre, prêt à saisir.
    setCollapsed((s) => ({ ...s, [company]: false }));
  }
  function addContract(key: string) {
    setCabinet((c) =>
      c.contracts.some((x) => x.key === key)
        ? c
        : { ...c, contracts: [...c.contracts, emptyContract(key)] },
    );
  }
  function removeContract(key: string) {
    setCabinet((c) => ({ ...c, contracts: c.contracts.filter((x) => x.key !== key) }));
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
    <div className="max-w-2xl space-y-5">
      {/* Identité */}
      <Card className="p-5 space-y-3">
        <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold">Nom du cabinet</p>
        <input
          className={inputCls}
          value={cabinet.cabinetName}
          onChange={(e) => setCabinet((c) => ({ ...c, cabinetName: e.target.value }))}
          placeholder="Ex. Charlie Gestion Privée"
          aria-label="Nom du cabinet / conseiller"
        />
      </Card>

      {/* Partenariats */}
      <Card className="p-5 space-y-4">
        <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold">
          Vos partenaires
        </p>
        <div className="relative">
          <input
            type="text"
            aria-label="Rechercher un partenaire"
            value={insurerQuery}
            onChange={(e) => setInsurerQuery(e.target.value)}
            onFocus={() => { if (optStatus === "error") loadOptions(); }}
            placeholder="Rechercher un partenaire…"
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
                <p className="px-3 py-2 text-meta text-muted-2">Aucun partenaire ne correspond.</p>
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

        {/* Un bloc par assureur : recherche pour ajouter les contrats distribués
            un à un (pas de rattachement d'office — certains assureurs en
            référencent soixante), puis saisie des conventions contrat par
            contrat. Le chevron replie l'assureur à son seul nom. */}
        {cabinet.insurers.map((company) => {
          const contractsOf = options.filter((o) => o.company === company);
          const added = cabinet.contracts.filter((x) => x.key.startsWith(`${company}::`));
          const addedKeys = new Set(added.map((x) => x.key));
          const isCollapsed = collapsed[company] ?? false;
          const filled = added.filter(hasAnyConvention).length;
          return (
            <div key={company} className="rounded-xl border border-line p-4 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCollapsed((s) => ({ ...s, [company]: !isCollapsed }))}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? "Déplier" : "Replier"} ${company}`}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  {isCollapsed
                    ? <ChevronRight size={14} className="text-muted shrink-0" />
                    : <ChevronDown size={14} className="text-muted shrink-0" />}
                  <span className="text-meta font-semibold text-ink truncate">{company}</span>
                  <span className="text-caption text-muted-2 shrink-0">
                    {added.length > 0
                      ? `${added.length} contrat${added.length > 1 ? "s" : ""} ajouté${added.length > 1 ? "s" : ""}`
                      : contractsOf.length > 0
                        ? `${contractsOf.length} contrat${contractsOf.length > 1 ? "s" : ""} référencé${contractsOf.length > 1 ? "s" : ""}`
                        : ""}
                    {filled > 0 && ` · ${filled} convention${filled > 1 ? "s" : ""} renseignée${filled > 1 ? "s" : ""}`}
                  </span>
                </button>
                <button type="button" onClick={() => toggleInsurer(company)}
                  aria-label={`Retirer ${company}`}
                  className="text-muted hover:text-danger transition-colors shrink-0">
                  <X size={13} />
                </button>
              </div>
              {!isCollapsed && (
                <>
                  {optStatus === "ready" && contractsOf.length === 0 && added.length === 0 ? (
                    <p className="text-meta text-muted">
                      Aucun contrat référencé pour ce partenaire dans la base.
                    </p>
                  ) : (
                    <ContractSearch
                      company={company}
                      options={options}
                      existingKeys={addedKeys}
                      onAdd={addContract}
                      status={optStatus}
                      onRetry={() => loadOptions()}
                    />
                  )}
                  {added.length === 0 && contractsOf.length > 0 && (
                    <p className="text-meta text-muted">
                      Ajoutez les contrats que vous distribuez pour renseigner leurs conventions.
                    </p>
                  )}
                  {added.map((sel) => {
                    const opt = contractsOf.find((o) => o.key === sel.key);
                    const label = opt?.contract ?? sel.key.split("::")[1] ?? sel.key;
                    return (
                      <div key={sel.key} className="border-t border-line-soft pt-3 space-y-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-meta font-medium text-ink">{label}</span>
                          {opt?.funds != null && (
                            <span className="text-caption text-muted-2">{opt.funds} fonds</span>
                          )}
                          <button type="button" onClick={() => removeContract(sel.key)}
                            aria-label={`Retirer le contrat ${label}`}
                            className="ml-auto text-muted hover:text-danger transition-colors shrink-0">
                            <X size={12} />
                          </button>
                        </div>
                        <div className="pl-1 space-y-2">
                          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-caption text-muted">
                                Frais de gestion du contrat (%/an)
                              </span>
                              <PctInput
                                value={sel.contractFeeShare}
                                onChange={(v) => updateContract(sel.key, { contractFeeShare: v })}
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
                                value={sel.ucRetroShare}
                                onChange={(v) => updateContract(sel.key, { ucRetroShare: v })}
                                placeholder="ex : 50"
                                ariaLabel={`Rétrocession UC : ${label}`}
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-caption text-muted">
                                Frais d&apos;entrée reversés (% des versements)
                              </span>
                              <PctInput
                                value={sel.entryFeeShare}
                                onChange={(v) => updateContract(sel.key, { entryFeeShare: v })}
                                placeholder="ex : 1,00"
                                ariaLabel={`Frais d'entrée reversés : ${label}`}
                                max={10}
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-caption text-muted">
                                Frais d&apos;arbitrage reversés (% des montants)
                              </span>
                              <PctInput
                                value={sel.arbitrageFeeShare}
                                onChange={(v) => updateContract(sel.key, { arbitrageFeeShare: v })}
                                placeholder="ex : 0,20"
                                ariaLabel={`Frais d'arbitrage reversés : ${label}`}
                                max={5}
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-caption text-muted">
                                Rétrocession fonds euros (%/an de l&apos;encours)
                              </span>
                              <PctInput
                                value={sel.eurosRetroShare}
                                onChange={(v) => updateContract(sel.key, { eurosRetroShare: v })}
                                placeholder="ex : 0,30"
                                ariaLabel={`Rétrocession fonds euros : ${label}`}
                                max={5}
                              />
                            </label>
                          </div>
                          {/* Autres rétrocessions, en saisie libre : n'importe quel
                              type de frais prévu par la convention (SCPI, structurés,
                              commissions ponctuelles…). */}
                          {sel.customFees.map((fee, fi) => (
                            <div key={fi} className="flex items-center gap-2">
                              <input
                                className={`${inputCls} w-64`}
                                value={fee.label}
                                aria-label={`Intitulé rétrocession libre ${fi + 1} : ${label}`}
                                onChange={(e) =>
                                  updateContract(sel.key, {
                                    customFees: sel.customFees.map((x, xi) =>
                                      xi === fi ? { ...x, label: e.target.value } : x),
                                  })
                                }
                                placeholder="Intitulé, ex : Commission SCPI"
                              />
                              <PctInput
                                value={fee.rate}
                                onChange={(v) =>
                                  updateContract(sel.key, {
                                    customFees: sel.customFees.map((x, xi) =>
                                      xi === fi ? { ...x, rate: v } : x),
                                  })
                                }
                                placeholder="ex : 0,50"
                                ariaLabel={`Taux rétrocession libre ${fi + 1} : ${label}`}
                              />
                              <button type="button"
                                aria-label={`Supprimer la rétrocession ${fee.label || fi + 1}`}
                                onClick={() =>
                                  updateContract(sel.key, {
                                    customFees: sel.customFees.filter((_, xi) => xi !== fi),
                                  })
                                }
                                className="text-muted hover:text-danger transition-colors">
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          {/* Exceptions par fonds */}
                          {sel.fundOverrides.map((ov, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <input
                                className={`${inputCls} w-44`}
                                value={ov.isin}
                                aria-label={`ISIN exception ${oi + 1} : ${label}`}
                                onChange={(e) =>
                                  updateContract(sel.key, {
                                    fundOverrides: sel.fundOverrides.map((x, xi) =>
                                      xi === oi ? { ...x, isin: e.target.value.toUpperCase() } : x),
                                  })
                                }
                                placeholder="ISIN"
                              />
                              <PctInput
                                value={ov.share}
                                onChange={(v) =>
                                  updateContract(sel.key, {
                                    fundOverrides: sel.fundOverrides.map((x, xi) =>
                                      xi === oi ? { ...x, share: v ?? 0 } : x),
                                  })
                                }
                                placeholder="ex : 60"
                                ariaLabel={`Part exception ${oi + 1} : ${label}`}
                              />
                              <button type="button"
                                aria-label={`Supprimer l'exception ${ov.isin || oi + 1}`}
                                onClick={() =>
                                  updateContract(sel.key, {
                                    fundOverrides: sel.fundOverrides.filter((_, xi) => xi !== oi),
                                  })
                                }
                                className="text-muted hover:text-danger transition-colors">
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          <div className="flex flex-wrap gap-x-5 gap-y-1">
                            <button type="button"
                              onClick={() =>
                                updateContract(sel.key, {
                                  fundOverrides: [...sel.fundOverrides, { isin: "", share: 0.5 }],
                                })
                              }
                              className="text-meta text-muted hover:text-ink underline underline-offset-2">
                              + Exception par fonds
                            </button>
                            <button type="button"
                              onClick={() =>
                                updateContract(sel.key, {
                                  customFees: [...sel.customFees, { label: "", rate: null }],
                                })
                              }
                              className="text-meta text-muted hover:text-ink underline underline-offset-2">
                              + Autre rétrocession
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
        {cabinet.contracts.length > 0 && (
          <p className="text-caption text-muted-2 leading-snug">
            Champs vides = estimation de place (~50 % des frais en gestion active, 0 sur les ETF).
          </p>
        )}
      </Card>

      {/* Honoraires de conseil : facturation DIRECTE au client (hors
          rétrocession), 100 % revenu cabinet. Consolidés avec les commissions
          dans la rémunération par portefeuille. Politique par défaut du cabinet. */}
      <Card className="p-5 space-y-4">
        <div>
          <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold">
            Honoraires de conseil
          </p>
          <p className="text-caption text-muted-2 mt-1 leading-snug">
            Facturés directement au client, en sus des frais du contrat. Consolidés
            avec vos rétrocessions dans la rémunération par portefeuille.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">Forfait ponctuel (bilan, mission)</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                step={100}
                value={cabinet.honoraireForfait == null ? "" : cabinet.honoraireForfait}
                onChange={(e) => {
                  const n = e.target.value === "" ? null : Number(e.target.value);
                  setCabinet((c) => ({ ...c, honoraireForfait: n == null || !Number.isFinite(n) ? null : Math.max(0, n) }));
                }}
                placeholder="ex : 1 500"
                aria-label="Honoraire forfaitaire (€)"
                className={`${inputCls} w-28`}
              />
              <span className="text-meta text-muted">€</span>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">Récurrent (suivi, mandat) — %/an de l&apos;encours</span>
            <PctInput
              value={cabinet.honoraireAnnuel}
              onChange={(v) => setCabinet((c) => ({ ...c, honoraireAnnuel: v }))}
              placeholder="ex : 0,50"
              ariaLabel="Honoraire annuel (% de l'encours)"
              max={5}
            />
          </label>
        </div>
      </Card>
    </div>
  );
}
