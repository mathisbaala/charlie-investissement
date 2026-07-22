import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import FraisPDF, { type FraisPdfHypotheses } from "@/lib/FraisPDF";
import { botGuard, dataRateLimit } from "@/lib/rateLimit";
import {
  buildFraisReport, HORIZONS_DEFAUT,
  type SimulationInput, type FraisReportSupportInput,
} from "@/lib/feeSimulator";

export const runtime = "nodejs";

// Export du document de FRAIS (client, conforme DDA) ou de RÉMUNÉRATION (cabinet,
// interne) de l'onglet Frais. 100 % DÉTERMINISTE : ni IA, ni base — juste le
// moteur pur buildFraisReport + la mise en page @react-pdf. Aucun coût de token ;
// on protège quand même l'endpoint (botGuard + anti-burst) car le rendu PDF est
// consommateur de CPU.

const MAX_SUPPORTS = 20;

// Logo officiel Charlie (« C ») embarqué en data URI : lecture disque au rendu
// (route Node), sans dépendance réseau. Mémoïsé entre requêtes (module scope).
// En cas d'échec, le document retombe sur la pastille clay (fallback BrandHeader).
let logoCache: string | null | undefined;
async function loadLogo(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const png = await readFile(join(process.cwd(), "public", "charlie-logo.png"));
    logoCache = `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

const n = (v: unknown, def = 0): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
};

// Exporté pour test : garantit qu'AUCUN paramètre de rémunération n'est perdu au
// parsing (régression — eurosRetroShare avait été oublié, le PDF sous-estimait
// alors la rétro fonds euros du cabinet vs l'écran). Next ignore les exports non-HTTP.
export function parseInput(raw: Record<string, unknown>): SimulationInput {
  const f = (raw.frais ?? {}) as Record<string, unknown>;
  return {
    versementInitial: n(raw.versementInitial),
    versementAnnuel: n(raw.versementAnnuel),
    dureeAnnees: Math.max(1, Math.floor(n(raw.dureeAnnees, 1))),
    partUC: n(raw.partUC),
    rendementUC: n(raw.rendementUC),
    rendementFE: n(raw.rendementFE),
    frais: {
      contratEntree: n(f.contratEntree), contratGestionUC: n(f.contratGestionUC),
      contratGestionFE: n(f.contratGestionFE), contratSortie: n(f.contratSortie),
      ucEntree: n(f.ucEntree), ucGestion: n(f.ucGestion), ucSortie: n(f.ucSortie),
    },
    retroCgp: n(raw.retroCgp),
    commissionCabinet: n(raw.commissionCabinet),
    contractFeeShare: n(raw.contractFeeShare),
    eurosRetroShare: n(raw.eurosRetroShare),
    honoraireForfait: n(raw.honoraireForfait),
    honoraireAnnuelPct: n(raw.honoraireAnnuelPct),
  };
}

function parseSupports(raw: unknown): FraisReportSupportInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SUPPORTS).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    return {
      isin: String(o.isin ?? "").slice(0, 12),
      name: String(o.name ?? o.isin ?? "").slice(0, 80),
      poids: n(o.poids),
      ter: num(o.ter),
      entryFee: num(o.entryFee),
      retro: num(o.retro),
    };
  }).filter((s) => s.isin.length > 0);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const bot = botGuard(req);
  if (bot) return bot;
  const burst = await dataRateLimit(req, 1);
  if (burst) return burst;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON attendu" }, { status: 400 });
  }

  const mode = body.mode === "cabinet" ? "cabinet" : "client";
  const clientRef = typeof body.clientRef === "string" && body.clientRef.trim()
    ? body.clientRef.trim().slice(0, 80)
    : null;
  const input = parseInput((body.input ?? {}) as Record<string, unknown>);
  const supports = parseSupports(body.supports);

  const horizons = Array.from(new Set([...HORIZONS_DEFAUT, input.dureeAnnees]))
    .filter((h) => h >= 1 && h <= input.dureeAnnees)
    .sort((a, b) => a - b);

  const report = buildFraisReport(input, supports, horizons);
  if (!report) {
    return NextResponse.json({ error: "Paramètres insuffisants pour la projection" }, { status: 400 });
  }

  const hypotheses: FraisPdfHypotheses = {
    versementInitial: input.versementInitial,
    versementAnnuel: input.versementAnnuel,
    duree: input.dureeAnnees,
    partUC: input.partUC,
    rendementUC: input.rendementUC,
    rendementFE: input.rendementFE,
    contratEntree: input.frais.contratEntree,
    contratGestionUC: input.frais.contratGestionUC,
    contratGestionFE: input.frais.contratGestionFE,
    contratSortie: input.frais.contratSortie,
    ucEntree: input.frais.ucEntree,
    ucGestion: input.frais.ucGestion,
    ucSortie: input.frais.ucSortie,
    retroCgp: input.retroCgp ?? 0,
    commissionCabinet: input.commissionCabinet ?? 0,
  };

  const logo = await loadLogo();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(FraisPDF as any, { mode, clientRef, hypotheses, report, logo });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const date = new Date().toISOString().split("T")[0];
  const nom = mode === "cabinet" ? "frais-cabinet" : "frais-client";
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nom}-${date}.pdf"`,
    },
  });
}
