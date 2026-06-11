"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, Shield } from "@/components/ui/icons";

// ─── Types (mêmes formes que les RPC du screener) ──────────────────────────────

type Insurer = { company: string; funds: number };
type ContractVariant = { contract: string; key: string };
type Contract = {
  company: string; contract: string; key: string; funds: number;
  // Repli des doublons : nombre de contrats partageant exactement ce jeu de fonds
  // (le représentant inclus) + libellés des autres variantes (mêmes supports).
  group_size?: number;
  variants?: ContractVariant[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

// Lien vers le screener déjà filtré sur un assureur (clé `insurer`) ou un contrat
// précis (clé composite `contracts` = "Assureur::Contrat"). La page /recherche lit
// ces paramètres d'URL et amorce directement la liste des supports.
const insurerHref  = (company: string) => `/recherche?insurer=${encodeURIComponent(company)}`;
const contractHref = (key: string)     => `/recherche?contracts=${encodeURIComponent(key)}`;

const CONTRACTS_PREVIEW = 4;

// ─── Carte assureur ─────────────────────────────────────────────────────────────

function InsurerCard({ insurer, contracts }: { insurer: Insurer; contracts: Contract[] }) {
  const [showAll, setShowAll] = useState(false);
  // On masque le cas redondant où le seul « contrat » reprend le nom de l'assureur
  // (fréquent côté AV Luxembourg), comme sur la fiche fonds.
  const real = contracts.filter(
    (c) => c.contract && !(contracts.length === 1 && c.contract === insurer.company),
  );
  const shown = showAll ? real : real.slice(0, CONTRACTS_PREVIEW);
  const extra = real.length - shown.length;

  return (
    <div className="bg-paper rounded-xl border border-line px-5 py-4 flex flex-col">
      {/* En-tête : clic → tous les supports de l'assureur */}
      <Link
        href={insurerHref(insurer.company)}
        className="group flex items-start justify-between gap-2 -mx-1 px-1 py-1 rounded-lg hover:bg-paper-2 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink group-hover:text-accent-ink truncate">
            {insurer.company}
          </p>
          <p className="text-[11px] text-muted mt-0.5">
            {insurer.funds.toLocaleString("fr-FR")} support{insurer.funds > 1 ? "s" : ""} référencé{insurer.funds > 1 ? "s" : ""}
          </p>
        </div>
        <ChevronRight size={15} className="text-muted group-hover:text-accent-ink shrink-0 mt-0.5" />
      </Link>

      {/* Contrats : chaque puce → supports du contrat précis */}
      {real.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line-soft">
          <p className="text-[10px] uppercase tracking-widest text-muted-2 font-semibold mb-2">
            Par contrat
          </p>
          <div className="flex flex-wrap gap-1.5">
            {shown.map((c) => {
              const variants = c.variants ?? [];
              return (
                <Link
                  key={c.key}
                  href={contractHref(c.key)}
                  // Les variantes partagent le même jeu de fonds → le lien sur le
                  // représentant remonte exactement les mêmes supports.
                  title={variants.length
                    ? `Mêmes supports que : ${variants.map((v) => v.contract).join(" · ")}`
                    : undefined}
                  className="text-[11px] px-2 py-1 rounded-full bg-paper-2 border border-line text-ink-2 hover:border-accent/40 hover:text-accent-ink transition-colors"
                >
                  {c.contract} <span className="text-muted-2">({c.funds.toLocaleString("fr-FR")})</span>
                  {variants.length > 0 && (
                    <span className="text-accent ml-1">+{variants.length} variante{variants.length > 1 ? "s" : ""}</span>
                  )}
                </Link>
              );
            })}
            {!showAll && extra > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="text-[11px] px-2 py-1 text-accent hover:underline"
              >
                +{extra} contrat{extra > 1 ? "s" : ""}
              </button>
            )}
            {showAll && real.length > CONTRACTS_PREVIEW && (
              <button
                onClick={() => setShowAll(false)}
                className="text-[11px] px-2 py-1 text-muted hover:underline"
              >
                Réduire
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────

export default function AssureursPage() {
  const [insurers, setInsurers]   = useState<Insurer[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading]     = useState(true);
  const [q, setQ]                 = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/screener/insurers").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/screener/contracts").then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([ins, con]) => {
        if (cancelled) return;
        setInsurers((ins.data ?? []) as Insurer[]);
        setContracts((con.data ?? []) as Contract[]);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Regroupe les contrats par assureur (une seule passe).
  const contractsByCompany = useMemo(() => {
    const m = new Map<string, Contract[]>();
    for (const c of contracts) {
      const arr = m.get(c.company);
      if (arr) arr.push(c);
      else m.set(c.company, [c]);
    }
    return m;
  }, [contracts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? insurers.filter((i) => i.company.toLowerCase().includes(needle))
      : insurers;
    // Tri par nombre de supports décroissant (les plus gros distributeurs d'abord).
    return [...list].sort((a, b) => b.funds - a.funds);
  }, [insurers, q]);

  return (
    <div className="h-full overflow-y-auto bg-cream px-4 sm:px-8 py-10">
      <div className="max-w-[1040px] mx-auto">

        {/* ── En-tête ──────────────────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-1.5">
            <Shield size={22} className="text-accent-ink" strokeWidth={1.7} />
            <h1 className="text-[26px] text-ink italic" style={{ fontFamily: "var(--font-serif)" }}>
              Assurances vie
            </h1>
          </div>
          <p className="text-[13px] text-muted max-w-[640px]">
            Sélectionnez un assureur ou un contrat pour afficher tous les supports
            (UC) qui y sont référencés.
          </p>

          {/* Recherche assureur */}
          <div className="mt-5 bg-paper rounded-xl border border-line shadow-sm px-4 py-2.5 flex items-center gap-3 max-w-[420px]">
            <Search size={15} className="text-muted shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un assureur…"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted-2 focus:outline-none"
            />
          </div>
        </div>

        {/* ── Liste ────────────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
            <p className="text-[13px] text-muted">
              {insurers.length === 0
                ? "Aucun assureur référencé pour le moment."
                : `Aucun assureur ne correspond à « ${q.trim()} ».`}
            </p>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-muted-2 mb-3">
              {filtered.length.toLocaleString("fr-FR")} assureur{filtered.length > 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((insurer) => (
                <InsurerCard
                  key={insurer.company}
                  insurer={insurer}
                  contracts={contractsByCompany.get(insurer.company) ?? []}
                />
              ))}
            </div>
          </>
        )}

        <p className="text-[10px] text-muted-2 mt-6 leading-snug max-w-[640px]">
          Donnée partielle. L&apos;absence d&apos;un assureur ou d&apos;un contrat ne signifie pas
          qu&apos;un fonds n&apos;y est pas référencé.
        </p>
      </div>
    </div>
  );
}
