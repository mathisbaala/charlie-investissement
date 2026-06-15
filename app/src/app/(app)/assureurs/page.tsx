"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, Shield } from "@/components/ui/icons";

// ─── Types (mêmes formes que les RPC du screener) ──────────────────────────────

type Insurer = { company: string; funds: number };
type ContractVariant = { contract: string; key: string };
type ContractType = "av" | "capi" | "per" | "pea" | "pep";
type Contract = {
  company: string; contract: string; key: string; funds: number;
  // Repli des doublons : nombre de contrats partageant exactement ce jeu de fonds
  // (le représentant inclus) + libellés des autres variantes (mêmes supports).
  group_size?: number;
  variants?: ContractVariant[];
  // Type d'enveloppe (ensemble des types des variantes) + statut commercial.
  types?: ContractType[];
  closed?: boolean;
};

// Libellés courts des types d'enveloppe. « av » (assurance vie) est le défaut du
// domaine → non affiché en badge (implicite), mais filtrable.
const TYPE_LABEL: Record<ContractType, string> = {
  av: "AV", capi: "Capi", per: "PER", pea: "PEA", pep: "PEP",
};
// Types proposés au filtre (PEP marginal — 1 contrat — exclu de la barre).
const TYPE_FILTERS: ContractType[] = ["av", "capi", "per", "pea"];

// ─── Helpers ────────────────────────────────────────────────────────────────────

// Lien vers le screener déjà filtré sur un assureur (clé `insurer`) ou un contrat
// précis (clé composite `contracts` = "Assureur::Contrat"). La page /recherche lit
// ces paramètres d'URL et amorce directement la liste des supports.
const insurerHref  = (company: string) => `/recherche?insurer=${encodeURIComponent(company)}`;
const contractHref = (key: string)     => `/recherche?contracts=${encodeURIComponent(key)}`;

const CONTRACTS_PREVIEW = 4;

// ─── Carte assureur ─────────────────────────────────────────────────────────────

function InsurerCard(
  { insurer, contracts, pass }: { insurer: Insurer; contracts: Contract[]; pass: (c: Contract) => boolean },
) {
  const [showAll, setShowAll] = useState(false);
  // On masque le cas redondant où le seul « contrat » reprend le nom de l'assureur
  // (fréquent côté AV Luxembourg), comme sur la fiche fonds. Puis on applique les
  // filtres type / statut commercial de la barre.
  const real = contracts.filter(
    (c) => c.contract && !(contracts.length === 1 && c.contract === insurer.company) && pass(c),
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
          <p className="text-body-lg font-semibold text-ink group-hover:text-accent-ink truncate">
            {insurer.company}
          </p>
          <p className="text-label text-muted mt-0.5">
            {insurer.funds.toLocaleString("fr-FR")} support{insurer.funds > 1 ? "s" : ""} référencé{insurer.funds > 1 ? "s" : ""}
          </p>
        </div>
        <ChevronRight size={15} className="text-muted group-hover:text-accent-ink shrink-0 mt-0.5" />
      </Link>

      {/* Contrats : chaque puce → supports du contrat précis */}
      {real.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line-soft">
          <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-2">
            Par contrat
          </p>
          <div className="flex flex-wrap gap-1.5">
            {shown.map((c) => {
              const variants = c.variants ?? [];
              // Badges de type hors « av » (défaut implicite) — ex. Capi / PER / PEA.
              const typeBadges = (c.types ?? []).filter((t) => t !== "av");
              const titleParts = [
                variants.length ? `Mêmes supports que : ${variants.map((v) => v.contract).join(" · ")}` : "",
                c.closed ? "Contrat fermé à la commercialisation" : "",
              ].filter(Boolean);
              return (
                <Link
                  key={c.key}
                  href={contractHref(c.key)}
                  // Les variantes partagent le même jeu de fonds → le lien sur le
                  // représentant remonte exactement les mêmes supports.
                  title={titleParts.length ? titleParts.join(" — ") : undefined}
                  className={`text-label px-2 py-1 rounded-full border transition-colors ${
                    c.closed
                      ? "bg-paper border-line-soft text-muted-2 hover:border-line"
                      : "bg-paper-2 border-line text-ink-2 hover:border-accent/40 hover:text-accent-ink"
                  }`}
                >
                  {c.contract} <span className="text-muted-2">({c.funds.toLocaleString("fr-FR")})</span>
                  {typeBadges.map((t) => (
                    <span key={t} className="ml-1 text-caption uppercase tracking-wide text-accent-ink/70 font-semibold">
                      {TYPE_LABEL[t]}
                    </span>
                  ))}
                  {c.closed && <span className="ml-1 text-caption uppercase tracking-wide text-muted-2">fermé</span>}
                  {variants.length > 0 && (
                    <span className="text-accent ml-1">+{variants.length} variante{variants.length > 1 ? "s" : ""}</span>
                  )}
                </Link>
              );
            })}
            {!showAll && extra > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="text-label px-2 py-1 text-accent hover:underline"
              >
                +{extra} contrat{extra > 1 ? "s" : ""}
              </button>
            )}
            {showAll && real.length > CONTRACTS_PREVIEW && (
              <button
                onClick={() => setShowAll(false)}
                className="text-label px-2 py-1 text-muted hover:underline"
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
  const [activeTypes, setActiveTypes] = useState<ContractType[]>([]);
  const [hideClosed, setHideClosed]   = useState(false);

  const toggleType = (t: ContractType) =>
    setActiveTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  // Un contrat passe les filtres de la barre (type d'enveloppe + statut commercial).
  const pass = (c: Contract) =>
    (!hideClosed || !c.closed) &&
    (activeTypes.length === 0 || (c.types ?? []).some((t) => activeTypes.includes(t)));
  const filterActive = activeTypes.length > 0 || hideClosed;

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
    let list = needle
      ? insurers.filter((i) => i.company.toLowerCase().includes(needle))
      : insurers;
    // Quand un filtre type/statut est actif, on n'affiche que les assureurs qui
    // proposent au moins un contrat correspondant.
    if (filterActive) {
      list = list.filter((i) => (contractsByCompany.get(i.company) ?? []).some(pass));
    }
    // Tri par nombre de supports décroissant (les plus gros distributeurs d'abord).
    return [...list].sort((a, b) => b.funds - a.funds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insurers, q, filterActive, activeTypes, hideClosed, contractsByCompany]);

  return (
    <div className="h-full overflow-y-auto bg-cream px-4 sm:px-8 py-10">
      <div className="max-w-[1040px] mx-auto">

        {/* ── En-tête ──────────────────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-1.5">
            <Shield size={22} className="text-accent-ink" strokeWidth={1.7} />
            <h1 className="text-display text-ink italic" style={{ fontFamily: "var(--font-serif)" }}>
              Assurances vie
            </h1>
          </div>
          <p className="text-body text-muted max-w-[640px]">
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
              className="flex-1 bg-transparent text-body text-ink placeholder:text-muted-2 focus:outline-none"
            />
          </div>

          {/* Filtres : type d'enveloppe + statut commercial */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-label text-muted-2 mr-1">Type&nbsp;:</span>
            {TYPE_FILTERS.map((t) => {
              const on = activeTypes.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={`text-label px-2.5 py-1 rounded-full border transition-colors ${
                    on
                      ? "bg-accent/10 border-accent/40 text-accent-ink"
                      : "bg-paper border-line text-muted hover:border-accent/30"
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              );
            })}
            <span className="mx-1 w-px h-4 bg-line" aria-hidden />
            <button
              onClick={() => setHideClosed((v) => !v)}
              className={`text-label px-2.5 py-1 rounded-full border transition-colors ${
                hideClosed
                  ? "bg-accent/10 border-accent/40 text-accent-ink"
                  : "bg-paper border-line text-muted hover:border-accent/30"
              }`}
            >
              Masquer les contrats fermés
            </button>
          </div>
        </div>

        {/* ── Liste ────────────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
            <p className="text-body text-muted">
              {insurers.length === 0
                ? "Aucun assureur référencé pour le moment."
                : `Aucun assureur ne correspond à « ${q.trim()} ».`}
            </p>
          </div>
        ) : (
          <>
            <p className="text-label text-muted-2 mb-3">
              {filtered.length.toLocaleString("fr-FR")} assureur{filtered.length > 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((insurer) => (
                <InsurerCard
                  key={insurer.company}
                  insurer={insurer}
                  contracts={contractsByCompany.get(insurer.company) ?? []}
                  pass={pass}
                />
              ))}
            </div>
          </>
        )}

        <p className="text-caption text-muted-2 mt-6 leading-snug max-w-[640px]">
          Donnée partielle. L&apos;absence d&apos;un assureur ou d&apos;un contrat ne signifie pas
          qu&apos;un fonds n&apos;y est pas référencé.
        </p>
      </div>
    </div>
  );
}
