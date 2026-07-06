"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, Shield } from "@/components/ui/icons";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageShell } from "@/components/ui/Page";
import {
  type ContractType, type Envelope,
  visibleContracts, isInsurerVisible,
} from "@/lib/insurer-envelope";

// ─── Types (mêmes formes que les RPC du screener) ──────────────────────────────

type Insurer = { company: string; funds: number };
type ContractVariant = { contract: string; key: string };
type Contract = {
  company: string; contract: string; key: string; funds: number;
  group_size?: number;
  variants?: ContractVariant[];
  types?: ContractType[];
  closed?: boolean;
};

// ─── Enveloppes (axe primaire) ───────────────────────────────────────────────
// L'enveloppe devient l'entrée principale de la page (onglets), pas un filtre
// secondaire. « av » est le défaut du domaine : un contrat sans type explicite
// est considéré comme une assurance vie. PEP (marginal, 1 contrat) est exclu.
// La logique pure de filtrage vit dans @/lib/insurer-envelope (testée).

const ENVELOPES: { key: Envelope; label: string; short: string }[] = [
  { key: "av",   label: "Assurance vie",   short: "AV" },
  { key: "capi", label: "Capitalisation",  short: "Capi" },
  { key: "per",  label: "PER",             short: "PER" },
  { key: "pea",  label: "PEA",             short: "PEA" },
];
const ENV_LABEL: Record<Envelope, string> = {
  av: "assurance vie", capi: "capitalisation", per: "PER", pea: "PEA",
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

const insurerHref  = (company: string) => `/recherche?insurer=${encodeURIComponent(company)}`;
const contractHref = (key: string)     => `/recherche?contracts=${encodeURIComponent(key)}`;

// Hauteur fixe de carte : toutes les cartes s'alignent en une grille régulière
// (plus de trous ni de cartes inégales). Le surplus de contrats défile à
// l'intérieur de la carte plutôt que d'allonger la carte (et de creuser un vide
// chez la voisine plus courte).
const CARD_HEIGHT = "h-[300px]";

// ─── Carte assureur (hauteur fixe · liste de contrats scrollable) ────────────────

function InsurerCard(
  { insurer, allContracts, env, hideClosed, query }:
  { insurer: Insurer; allContracts: Contract[]; env: Envelope; hideClosed: boolean; query: string },
) {
  // Contrats visibles : enveloppe active + filtre statut commercial.
  let visible = visibleContracts(allContracts, insurer.company, env, hideClosed);

  // Recherche : si la requête ne matche pas le nom de l'assureur mais des contrats,
  // on restreint la liste aux contrats correspondants (la carte remonte parce que
  // l'un de ses contrats matche — on montre lesquels).
  const needle = query.trim().toLowerCase();
  const companyMatches = needle ? insurer.company.toLowerCase().includes(needle) : true;
  if (needle && !companyMatches) {
    visible = visible.filter((c) => c.contract.toLowerCase().includes(needle));
  }

  return (
    <Card className={`px-5 py-4 flex flex-col ${CARD_HEIGHT}`}>
      {/* En-tête : clic → tous les supports de l'assureur dans le screener */}
      <Link
        href={insurerHref(insurer.company)}
        className="group shrink-0 flex items-start justify-between gap-2 -mx-1 px-1 py-1 rounded-lg hover:bg-paper-2 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-body-lg font-semibold text-ink group-hover:text-accent-ink truncate">
            {insurer.company}
          </p>
          <p className="text-label text-muted mt-0.5">
            {/* Le total `insurer.funds` est l'union toutes enveloppes confondues.
                On ne l'affiche que sous l'onglet AV (enveloppe dominante, où il
                approxime l'union AV). Sous Capi/PER/PEA, il surcompterait → on
                montre seulement le nombre de contrats de l'enveloppe (exact). */}
            {env === "av" ? (
              <>
                {insurer.funds.toLocaleString("fr-FR")} support{insurer.funds > 1 ? "s" : ""} référencé{insurer.funds > 1 ? "s" : ""}
                {visible.length > 0 && (
                  <> · {visible.length} contrat{visible.length > 1 ? "s" : ""}</>
                )}
              </>
            ) : (
              <>{visible.length} contrat{visible.length > 1 ? "s" : ""} en {ENV_LABEL[env]}</>
            )}
          </p>
        </div>
        <ChevronRight size={15} className="text-muted group-hover:text-accent-ink shrink-0 mt-0.5" />
      </Link>

      {visible.length > 0 ? (
        // Tableau de contrats : en-tête figé, lignes défilantes (scrollbar fine).
        <div className="mt-3.5 flex flex-col min-h-0 flex-1">
          <div className="grid grid-cols-[1fr_auto] gap-3 pb-1.5 border-b border-line-soft shrink-0">
            <span className="text-caption uppercase tracking-widest text-muted-2 font-semibold">Contrat</span>
            <span className="text-caption uppercase tracking-widest text-muted-2 font-semibold text-right">Supports</span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto scrollbar-thin -mr-2 pr-2">
            {visible.map((c) => {
              const variants = c.variants ?? [];
              const title = [
                variants.length ? `Mêmes supports que : ${variants.map((v) => v.contract).join(" · ")}` : "",
                c.closed ? "Contrat fermé à la commercialisation" : "",
              ].filter(Boolean).join(" · ") || undefined;
              return (
                <li key={c.key}>
                  <Link
                    href={contractHref(c.key)}
                    title={title}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 py-2 border-b border-line-soft min-h-[44px] -mx-1 px-1 rounded-md hover:bg-accent/[0.03] transition-colors"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      {/* Pastille de statut : pleine = ouvert, creuse = fermé.
                          Le label « fermé » fournit le cue non-couleur (daltonisme). */}
                      <span
                        aria-hidden
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          c.closed ? "border-[1.5px] border-muted-2" : "bg-ok"
                        }`}
                      />
                      <span className="text-body text-ink-2 font-medium truncate">{c.contract}</span>
                      {c.closed && <span className="text-meta text-muted-2 italic shrink-0">fermé</span>}
                    </span>
                    <span className="text-body text-muted tabular-nums text-right">
                      {c.funds.toLocaleString("fr-FR")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        // Pas de détail de contrat (ex. AV Luxembourg « redondant ») : on remplit
        // la carte avec un accès direct aux supports plutôt que de laisser un vide.
        <div className="mt-3.5 flex-1 flex items-center justify-center">
          <Link
            href={insurerHref(insurer.company)}
            className="inline-flex items-center gap-1.5 text-label font-medium text-accent hover:underline"
          >
            Voir tous les supports référencés
            <ChevronRight size={14} />
          </Link>
        </div>
      )}
    </Card>
  );
}

// ─── Onglets d'enveloppe (axe primaire, a11y tablist) ────────────────────────────

function EnvelopeTabs(
  { active, onChange }: { active: Envelope; onChange: (e: Envelope) => void },
) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Navigation clavier : flèches gauche/droite déplacent focus + sélection.
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + ENVELOPES.length) % ENVELOPES.length;
    onChange(ENVELOPES[next].key);
    refs.current[next]?.focus();
  };

  return (
    // Scrollable horizontalement sur mobile : les libellés complets restent,
    // l'onglet actif est visible au montage (le navigateur garde le focus en vue).
    // Dégradé de bord droit (mobile uniquement) : signale qu'il reste des onglets
    // à scroller (sinon PEA est coupé net, sans indice). Retiré en md+ où tout tient.
    <div
      role="tablist"
      aria-label="Type d'enveloppe"
      className="flex gap-1 border-b border-line overflow-x-auto -mb-px [mask-image:linear-gradient(to_right,black_86%,transparent)] md:[mask-image:none]"
    >
      {ENVELOPES.map((env, idx) => {
        const on = env.key === active;
        return (
          <button
            key={env.key}
            ref={(el) => { refs.current[idx] = el; }}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(env.key)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={`whitespace-nowrap px-3.5 py-2.5 text-body font-medium border-b-2 transition-colors min-h-[44px] ${
              on
                ? "text-accent-ink border-accent font-semibold"
                : "text-muted border-transparent hover:text-ink-2"
            }`}
          >
            {env.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────

export default function AssureursPage() {
  const [insurers, setInsurers]   = useState<Insurer[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [q, setQ]                 = useState("");
  const [env, setEnv]             = useState<Envelope>("av");
  const [hideClosed, setHideClosed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    let cancelled = false;
    Promise.all([
      fetch("/api/screener/insurers").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/api/screener/contracts").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([ins, con]) => {
        if (cancelled) return;
        setInsurers((ins.data ?? []) as Insurer[]);
        setContracts((con.data ?? []) as Contract[]);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { const cleanup = load(); return cleanup; }, [load]);

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

  // Un assureur est visible sous l'enveloppe active s'il a au moins un contrat
  // de cette enveloppe (après filtre statut). Cas particulier AV : on garde aussi
  // les assureurs sans détail de contrat (AV Luxembourg « redondant »), car
  // l'assurance vie est le défaut du domaine — carte en-tête seule.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = insurers.filter((i) => {
      const all = contractsByCompany.get(i.company) ?? [];
      if (!isInsurerVisible(all, i.company, env, hideClosed)) return false;
      // La recherche matche le nom de l'assureur OU le nom d'un de ses contrats
      // (sous l'enveloppe active) : taper « Premium » remonte les assureurs qui
      // référencent un contrat « Premium ».
      if (!needle) return true;
      if (i.company.toLowerCase().includes(needle)) return true;
      return visibleContracts(all, i.company, env, hideClosed)
        .some((c) => c.contract.toLowerCase().includes(needle));
    });
    return [...list].sort((a, b) => b.funds - a.funds);
  }, [insurers, q, env, hideClosed, contractsByCompany]);

  return (
    <PageShell>
      {/* Axe primaire : enveloppe */}
      <EnvelopeTabs active={env} onChange={setEnv} />

      {/* Recherche + statut commercial */}
      <div className="mt-4 mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="bg-paper rounded-xl border border-line shadow-sm px-4 py-2.5 flex items-center gap-3 w-full max-w-[360px]">
          <Search size={15} className="text-muted shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un assureur…"
            aria-label="Rechercher un assureur"
            className="flex-1 bg-transparent text-body text-ink placeholder:text-muted-2 focus:outline-none"
          />
        </div>
        <label className="text-label text-muted flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={(e) => setHideClosed(e.target.checked)}
            className="accent-accent w-4 h-4"
          />
          Masquer les contrats fermés
        </label>
      </div>

      {/* ── Liste ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="px-5 py-4 h-[300px]">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3 w-1/3 mt-2" />
              <Skeleton className="h-3 w-full mt-5" />
              <Skeleton className="h-3 w-full mt-2.5" />
              <Skeleton className="h-3 w-2/3 mt-2.5" />
              <Skeleton className="h-3 w-full mt-2.5" />
              <Skeleton className="h-3 w-1/2 mt-2.5" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="flex h-48">
          <EmptyState
            icon={<Shield size={16} />}
            title="Impossible de charger les assureurs."
            hint="Vérifiez votre connexion et réessayez."
            action={
              <button
                onClick={() => load()}
                className="text-label px-3 py-1.5 rounded-lg border border-line bg-paper hover:border-accent/40 text-ink-2 transition-colors min-h-[36px]"
              >
                Réessayer
              </button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48">
          <EmptyState
            icon={<Shield size={16} />}
            title={
              q.trim()
                ? `Aucun assureur ne correspond à « ${q.trim()} ».`
                : `Aucun assureur ne propose encore de ${ENV_LABEL[env]} dans notre base.`
            }
            hint={
              q.trim()
                ? "Vérifiez l'orthographe ou élargissez votre recherche."
                : "Essayez une autre enveloppe ci-dessus."
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((insurer) => (
              <InsurerCard
                key={insurer.company}
                insurer={insurer}
                allContracts={contractsByCompany.get(insurer.company) ?? []}
                env={env}
                hideClosed={hideClosed}
                query={q}
              />
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
