// @vitest-environment node
// DÉMO autonome (aucune base, aucun secret, aucune API payante) : construit une
// allocation optimisée sur un univers d'exemple et génère les livrables.
//
//   npm run demo:allocation
//
// → écrit, à côté de tes templates (dossier « Charlie AI/Screener ») :
//     Demo_Allocation_Charlie.pdf   (la présentation client, 3 pages)
//     Demo_Allocation_Charlie.txt   (le même contenu en texte, pour lecture rapide)
// Sans la variable DEMO=1, le fichier sert de simple test de fumée (rien n'est écrit).
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { optimizeAllocation, type FundInput } from "@/lib/optimizer";
import { buildPresentation } from "@/lib/allocationRationale";
import AllocationReportPDF from "@/lib/AllocationReportPDF";

// Univers d'exemple : supports plausibles d'un contrat AV luxembourgeois.
const UNIVERSE: FundInput[] = [
  { isin: "LU1135865084", name: "Amundi S&P 500 UCITS ETF", assetClass: "actions", category: "Actions USA", expectedReturn: 0.162, volatility: 0.17, sri: 5, sfdr: 6, ter: 0.0015 },
  { isin: "LU1897556517", name: "Groupama Global Disruption", assetClass: "actions", category: "Actions Disruption", expectedReturn: 0.177, volatility: 0.22, sri: 5, sfdr: 9, ter: 0.018 },
  { isin: "LU0115773425", name: "Fidelity Global Technology", assetClass: "actions", category: "Actions Technologie", expectedReturn: 0.188, volatility: 0.21, sri: 4, sfdr: 8, ter: 0.010 },
  { isin: "LU1876459303", name: "Axiom European Banks Equity", assetClass: "actions", category: "Actions Europe Fin.", expectedReturn: 0.26, volatility: 0.24, sri: 6, sfdr: 8, ter: 0.0185 },
  { isin: "FR0011261197", name: "R-co Valor", assetClass: "diversifie", category: "Allocation Flexible", expectedReturn: 0.075, volatility: 0.11, sri: 4, sfdr: 8, ter: 0.015 },
  { isin: "LU0171283459", name: "BGF Global Allocation", assetClass: "diversifie", category: "Multi-actifs Monde", expectedReturn: 0.071, volatility: 0.10, sri: 4, sfdr: 6, ter: 0.0175 },
  { isin: "LU1164219682", name: "AXA WF Euro Credit Total Return", assetClass: "obligations", category: "Obligations Crédit", expectedReturn: 0.047, volatility: 0.05, sri: 3, sfdr: 8, ter: 0.0075 },
  { isin: "FR0010230490", name: "Lazard Credit Opportunities", assetClass: "obligations", category: "Obligations Crédit", expectedReturn: 0.045, volatility: 0.055, sri: 3, sfdr: 8, ter: 0.0085 },
  { isin: "LU1694789535", name: "DNCA Invest Alpha Bonds", assetClass: "obligations", category: "Obligations Flexibles", expectedReturn: 0.035, volatility: 0.04, sri: 2, sfdr: 8, ter: 0.010 },
  { isin: "FR0013267663", name: "Hugau Moneterme", assetClass: "monetaire", category: "Monétaire", expectedReturn: 0.033, volatility: 0.005, sri: 1, sfdr: 8, ter: 0.001 },
];

// Corrélations réalistes : actions entre elles ~0,8 ; obligations ~0,4 ;
// actions/obligations ~0,1 ; monétaire quasi décorrélé.
const EQ = new Set(["LU1135865084", "LU1897556517", "LU0115773425", "LU1876459303"]);
const BD = new Set(["LU1164219682", "FR0010230490", "LU1694789535"]);
function corr(a: string, b: string): number {
  if (a === b) return 1;
  if (EQ.has(a) && EQ.has(b)) return 0.8;
  if (BD.has(a) && BD.has(b)) return 0.4;
  if (a === "FR0013267663" || b === "FR0013267663") return 0.02;
  return 0.1;
}

function textReport(p: ReturnType<typeof buildPresentation>): string {
  const L: string[] = [];
  L.push("═".repeat(64), `  ${p.title}`, `  ${p.subtitle}`, "═".repeat(64), "");
  L.push(`Supports ${p.headline.supports}  ·  SRI moyen ${p.headline.weightedSri}/7  ·  ` +
    `Perf. cible ~${p.headline.expectedReturnPct}%/an  ·  Vol ~${p.headline.volatilityPct}%`, "");
  L.push("CONTEXTE ET OBJECTIFS");
  p.objectives.forEach((o) => L.push("  • " + o));
  L.push("", "RÉPARTITION PAR CLASSE D'ACTIFS");
  p.classBreakdown.forEach((c) => L.push(`  ${String(c.weight).padStart(5)}%  ${c.label.padEnd(24)} ${c.role}`));
  L.push("", "ALLOCATION DÉTAILLÉE");
  p.table.forEach((l, i) =>
    L.push(`  ${String(i + 1).padStart(2)}. ${String(l.weight).padStart(5)}%  ${l.name.padEnd(34)} ${String(l.category ?? "").padEnd(22)} SRI ${l.sri ?? "-"}`));
  L.push("", "JUSTIFICATION PAR SUPPORT");
  p.perFundRationale.forEach((r, i) => L.push(`  ${i + 1}. ${r.name}`, `     ${r.text}`, ""));
  L.push("CONVICTIONS");
  p.convictions.forEach((c) => L.push(`  ▸ ${c.title}`, `    ${c.text}`, ""));
  return L.join("\n");
}

type Doc = React.ReactElement<DocumentProps>;

describe("Démo allocation", () => {
  it("génère une proposition d'allocation (cible 60/30/10)", async () => {
    const result = optimizeAllocation(UNIVERSE, corr, {
      classTargets: { actions: 55, obligations: 30, diversifie: 10, monetaire: 5 },
      minAssets: 4,
      maxAssets: 7,
      riskFree: 0.02,
    });
    const presentation = buildPresentation(result, {
      contractName: "Cardif Elite Lux",
      universeSize: UNIVERSE.length,
      asOfLabel: "Juillet 2026",
      advisorName: "Charlie Investissement — Démo",
    });

    // Invariants (le test protège la démo contre une régression du moteur).
    expect(result.lines.length).toBeGreaterThanOrEqual(4);
    expect(result.lines.length).toBeLessThanOrEqual(7);
    expect(result.lines.reduce((s, l) => s + l.weight, 0)).toBeCloseTo(100, 0);
    expect(result.sharpe).toBeGreaterThan(0);

    if (process.env.DEMO) {
      const outDir = resolve(process.cwd(), "..", ".."); // dossier « Charlie AI/Screener »
      const txt = textReport(presentation);
      writeFileSync(resolve(outDir, "Demo_Allocation_Charlie.txt"), txt);
      const buf = await renderToBuffer(
        React.createElement(AllocationReportPDF, { presentation }) as unknown as Doc,
      );
      writeFileSync(resolve(outDir, "Demo_Allocation_Charlie.pdf"), buf);
      // eslint-disable-next-line no-console
      console.log(
        `\n✅ Démo générée dans « Charlie AI/Screener » :\n` +
          `   • Demo_Allocation_Charlie.pdf  (présentation 3 pages)\n` +
          `   • Demo_Allocation_Charlie.txt  (résumé texte)\n\n` +
          txt,
      );
    }
  }, 30_000);
});
