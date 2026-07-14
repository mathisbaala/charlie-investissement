"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Btn } from "@/components/ui/Btn";
import { efficientFrontier } from "@/lib/frontier";
import { portfolioStats, weightedAverage, type AllocationLine } from "@/lib/optimizer";

// Graphique risque/rendement (Markowitz) de l'allocation proposée :
//  - chaque support retenu est un point (volatilité, rendement attendu) ;
//  - la frontière efficiente de l'univers retenu est tracée (enveloppe) ;
//  - le portefeuille optimal (max-Sharpe) est positionné ;
//  - les poids sont AJUSTABLES : le point « portefeuille simulé » se déplace
//    en direct (recalcul rendement/volatilité/Sharpe via la covariance).
// Présentation seulement : tout le calcul vit dans lib/frontier + lib/optimizer.

interface Props {
  lines: AllocationLine[];
  /** Matrice de covariance alignée sur `lines` (fractions annualisées). */
  cov: number[][];
  /** Taux sans risque (fraction). */
  riskFree: number;
  /**
   * Mode piloté (optionnel) : poids simulés en POURCENTAGES, possédés par le
   * parent (`null` = poids optimaux). Permet au reste de la page (rapport,
   * profil de risque, projets) de suivre les curseurs.
   */
  weights?: number[] | null;
  /** Notifié à chaque ajustement ; `null` = retour aux poids optimaux. */
  onWeightsChange?: (weights: number[] | null) => void;
}

const W = 720;
const H = 380;
const M = { top: 18, right: 20, bottom: 46, left: 62 };

const pct = (x: number, digits = 1) =>
  `${(x * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;

/** Ticks « ronds » ~n pas sur [0, max] (valeurs en fraction). */
function niceTicks(max: number, n = 5): number[] {
  if (max <= 0) return [0];
  const rawStep = max / n;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-12; v += step) out.push(v);
  return out;
}

export function MarkowitzChart({
  lines,
  cov,
  riskFree,
  weights: controlledWeights,
  onWeightsChange,
}: Props) {
  const mu = useMemo(() => lines.map((l) => l.expectedReturn), [lines]);
  const frontier = useMemo(() => efficientFrontier(mu, cov), [mu, cov]);

  // Poids simulés, en POURCENTAGES. Deux modes :
  //  - piloté (onWeightsChange fourni) : le parent possède l'état ;
  //  - autonome : état local (init = allocation optimale).
  const controlled = onWeightsChange !== undefined;
  const optimalWeights = useMemo(() => lines.map((l) => l.weight), [lines]);
  const [internalWeights, setInternalWeights] = useState<number[]>(optimalWeights);
  const [lastLines, setLastLines] = useState(lines);
  if (lines !== lastLines) {
    // Nouvelle allocation générée → on réinitialise la simulation locale.
    setLastLines(lines);
    setInternalWeights(lines.map((l) => l.weight));
  }
  // GARDE-FOU : pendant la passe de rendu déclenchée par un changement de
  // `lines` (le setState ci-dessus fait rejouer le rendu, mais la passe
  // courante va au bout), les poids peuvent encore avoir l'ANCIENNE longueur.
  // Croiser d'anciens poids avec la nouvelle covariance ferait déborder
  // portfolioStats (cov[i] undefined) → on aligne toujours sur les lignes
  // courantes.
  const rawWeights = controlled ? controlledWeights ?? optimalWeights : internalWeights;
  const weights = rawWeights.length === lines.length ? rawWeights : optimalWeights;
  const setWeights = (w: number[]) => {
    if (controlled) onWeightsChange!(w);
    else setInternalWeights(w);
  };
  const resetWeights = () => {
    if (controlled) onWeightsChange!(null);
    else setInternalWeights(lines.map((l) => l.weight));
  };

  const totalPct = weights.reduce((s, x) => s + x, 0);
  const wFrac = useMemo(() => {
    const t = weights.reduce((s, x) => s + x, 0);
    return t > 0 ? weights.map((x) => x / t) : weights.map(() => 1 / weights.length);
  }, [weights]);

  const optimal = useMemo(
    () => portfolioStats(optimalWeights.map((x) => x / 100), mu, cov, riskFree),
    [optimalWeights, mu, cov, riskFree],
  );
  const current = useMemo(
    () => portfolioStats(wFrac, mu, cov, riskFree),
    [wFrac, mu, cov, riskFree],
  );
  // SRI moyen pondéré : suit les curseurs en direct (les SRI manquants sont
  // ignorés, leur poids renormalisé — même règle que le moteur).
  const sris = useMemo(() => lines.map((l) => l.sri ?? null), [lines]);
  const currentSri = useMemo(() => weightedAverage(sris, wFrac), [sris, wFrac]);
  const optimalSri = useMemo(
    () => weightedAverage(sris, optimalWeights.map((x) => x / 100)),
    [sris, optimalWeights],
  );
  const edited = weights.some((w, i) => Math.abs(w - optimalWeights[i]) > 0.05);

  // Échelles (0 → max avec marge) sur l'union fonds + frontière + portefeuilles.
  const maxVol =
    Math.max(...lines.map((l) => l.volatility), ...frontier.map((f) => f.vol), current.vol, 0.01) * 1.15;
  const maxRet =
    Math.max(...lines.map((l) => l.expectedReturn), ...frontier.map((f) => f.ret), current.ret, 0.01) * 1.18;
  const x = (v: number) => M.left + (v / maxVol) * (W - M.left - M.right);
  const y = (r: number) => H - M.bottom - (r / maxRet) * (H - M.top - M.bottom);

  const [hover, setHover] = useState<{ px: number; py: number; title: string; sub: string } | null>(null);

  const frontierPath = frontier
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.vol).toFixed(1)},${y(p.ret).toFixed(1)}`)
    .join(" ");

  const fmtDelta = (d: number, digits = 1) =>
    `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits })} pt`;

  return (
    <Card className="px-5 py-5">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-label text-ink font-semibold">Positionnement risque / rendement</h2>
        <span className="text-meta text-muted">Frontière efficiente de l&apos;univers retenu (Markowitz)</span>
      </div>
      <p className="text-meta text-muted mb-3">
        Ajustez les poids ci-dessous : plus le point colle à la frontière, meilleur est le compromis risque/rendement.
      </p>

      {/* Légende — identité par point coloré, texte en encre neutre */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-2">
        <span className="inline-flex items-center gap-1.5 text-meta text-ink-2">
          <svg width="14" height="14" aria-hidden><line x1="1" y1="7" x2="13" y2="7" stroke="var(--color-accent)" strokeWidth="2" /></svg>
          Frontière efficiente
        </span>
        <span className="inline-flex items-center gap-1.5 text-meta text-ink-2">
          <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="4" fill="var(--color-muted)" /></svg>
          Supports retenus
        </span>
        <span className="inline-flex items-center gap-1.5 text-meta text-ink-2">
          <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="var(--color-ink)" /></svg>
          Portefeuille optimal
        </span>
        <span className="inline-flex items-center gap-1.5 text-meta text-ink-2">
          <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="var(--color-accent)" /></svg>
          Portefeuille simulé
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label="Plan volatilité / rendement attendu : supports, frontière efficiente et portefeuille"
        >
          {/* Grille + axes (hairlines discrètes) */}
          {niceTicks(maxRet).map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-line-soft)" strokeWidth="1" />
              <text x={M.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize="11" fill="var(--color-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {pct(t, 0)}
              </text>
            </g>
          ))}
          {niceTicks(maxVol).map((t) => (
            <g key={`x${t}`}>
              <line y1={M.top} y2={H - M.bottom} x1={x(t)} x2={x(t)} stroke="var(--color-line-soft)" strokeWidth="1" />
              <text x={x(t)} y={H - M.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--color-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {pct(t, 0)}
              </text>
            </g>
          ))}
          <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
            Volatilité annualisée
          </text>
          <text x={14} y={(M.top + H - M.bottom) / 2} textAnchor="middle" fontSize="11" fill="var(--color-muted)" transform={`rotate(-90 14 ${(M.top + H - M.bottom) / 2})`}>
            Rendement attendu
          </text>

          {/* Frontière efficiente */}
          {frontier.length > 1 && (
            <path d={frontierPath} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* Supports retenus */}
          {lines.map((l, i) => (
            <circle
              key={l.isin}
              cx={x(l.volatility)}
              cy={y(l.expectedReturn)}
              r="4"
              fill="var(--color-muted)"
              stroke="var(--color-paper)"
              strokeWidth="2"
              style={{ cursor: "pointer" }}
              onMouseEnter={() =>
                setHover({
                  px: x(l.volatility), py: y(l.expectedReturn),
                  title: l.name,
                  sub: `${pct(l.expectedReturn)} / vol ${pct(l.volatility)} · poids ${weights[i].toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`,
                })
              }
              onMouseLeave={() => setHover(null)}
            />
          ))}

          {/* Portefeuille optimal (max-Sharpe) */}
          <circle
            cx={x(optimal.vol)} cy={y(optimal.ret)} r="6"
            fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth="2"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover({ px: x(optimal.vol), py: y(optimal.ret), title: "Portefeuille optimal", sub: `${pct(optimal.ret)} / vol ${pct(optimal.vol)} · Sharpe ${optimal.sharpe.toFixed(2)}` })}
            onMouseLeave={() => setHover(null)}
          />

          {/* Portefeuille simulé (se déplace avec les curseurs) */}
          <circle
            cx={x(current.vol)} cy={y(current.ret)} r="6"
            fill="var(--color-accent)" stroke="var(--color-paper)" strokeWidth="2"
            style={{ cursor: "pointer", transition: "cx 120ms linear, cy 120ms linear" }}
            onMouseEnter={() => setHover({ px: x(current.vol), py: y(current.ret), title: "Portefeuille simulé", sub: `${pct(current.ret)} / vol ${pct(current.vol)} · Sharpe ${current.sharpe.toFixed(2)}` })}
            onMouseLeave={() => setHover(null)}
          />
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-line bg-paper px-3 py-2 shadow-sm"
            style={{ left: `${(hover.px / W) * 100}%`, top: `${(hover.py / H) * 100}%`, transform: "translate(-50%, -120%)", maxWidth: 260 }}
          >
            <div className="text-meta text-ink font-medium truncate">{hover.title}</div>
            <div className="text-meta text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{hover.sub}</div>
          </div>
        )}
      </div>

      {/* Lecture chiffrée : simulé vs optimal */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {(
          [
            ["Rendement attendu", current.ret, optimal.ret, (v: number) => pct(v)],
            ["Volatilité", current.vol, optimal.vol, (v: number) => pct(v)],
            ["Ratio de Sharpe", current.sharpe, optimal.sharpe, (v: number) => v.toFixed(2)],
          ] as const
        ).map(([label, cur, opt, fmt]) => (
          <div key={label} className="rounded-lg bg-paper-2 px-3 py-2">
            <div className="text-meta text-muted">{label}</div>
            <div className="text-label text-ink font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmt(cur)}
              {edited && (
                <span className="text-meta text-muted font-normal">
                  {" "}· optimal {fmt(opt)}{label !== "Ratio de Sharpe" ? ` (${fmtDelta(cur - opt)})` : ""}
                </span>
              )}
            </div>
          </div>
        ))}
        <div className="rounded-lg bg-paper-2 px-3 py-2">
          <div className="text-meta text-muted">SRI moyen</div>
          <div className="text-label text-ink font-semibold" style={{ fontVariantNumeric: "tabular-nums" }} data-testid="simulated-sri">
            {currentSri == null ? "—" : `${currentSri.toFixed(1)} / 7`}
            {edited && optimalSri != null && (
              <span className="text-meta text-muted font-normal"> · optimal {optimalSri.toFixed(1)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Curseurs de poids */}
      <div className="mt-4 space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-meta text-ink font-semibold">Poids simulés</h3>
          <div className="flex items-center gap-3">
            <span className="text-meta text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
              Total saisi {totalPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % — normalisé à 100 % pour le calcul
            </span>
            {edited && (
              <Btn variant="outline" size="sm" onClick={resetWeights}>
                Revenir à l&apos;optimal
              </Btn>
            )}
          </div>
        </div>
        {lines.map((l, i) => (
          <label key={l.isin} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
            <span className="text-meta text-ink-2 truncate" title={l.name}>{l.name}</span>
            <input
              type="range"
              min={0}
              max={60}
              step={0.5}
              value={weights[i]}
              aria-label={`Poids de ${l.name}`}
              onChange={(e) => {
                const next = [...weights];
                next[i] = Number(e.target.value);
                setWeights(next);
              }}
              className="w-44"
              style={{ accentColor: "var(--color-accent)" }}
            />
            <span className="text-meta text-ink w-20 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
              {(wFrac[i] * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}
