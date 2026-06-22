import { ImageResponse } from "next/og";

// Aperçu de lien (LinkedIn, WhatsApp, Slack, X…) aux couleurs Charlie.
export const alt =
  "Charlie Investissement — l'intelligence la plus profonde sur chaque fonds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Palette dérivée de globals.css (oklch → hex approché, Satori ne gère pas oklch).
const CREAM = "#F4F2EE";
const INK = "#2C2A27";
const INK_2 = "#4A4742";
const MUTED = "#8B8782";
const CLAY = "#AC5E3C";
const LINE = "#D8D4CE";

const FONT_BASE =
  "https://cdn.jsdelivr.net/fontsource/fonts/instrument-serif@latest/latin-400";
const DM_SANS =
  "https://cdn.jsdelivr.net/fontsource/fonts/dm-sans@latest/latin-600-normal.ttf";

// Chargement best-effort : en cas d'échec réseau, on rend sans police custom
// (Satori bascule sur sa police par défaut) plutôt que de casser le build.
async function loadFonts() {
  try {
    const [serif, serifItalic, sans] = await Promise.all([
      fetch(`${FONT_BASE}-normal.ttf`).then((r) => r.arrayBuffer()),
      fetch(`${FONT_BASE}-italic.ttf`).then((r) => r.arrayBuffer()),
      fetch(DM_SANS).then((r) => r.arrayBuffer()),
    ]);
    return [
      { name: "Instrument Serif", data: serif, style: "normal" as const, weight: 400 as const },
      { name: "Instrument Serif", data: serifItalic, style: "italic" as const, weight: 400 as const },
      { name: "DM Sans", data: sans, style: "normal" as const, weight: 600 as const },
    ];
  } catch {
    return [];
  }
}

export default async function Image() {
  const fonts = await loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 84,
          background: CREAM,
          fontFamily: "DM Sans",
          position: "relative",
        }}
      >
        {/* Halos clay (rappel du fond de la landing) */}
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -150,
            width: 580,
            height: 580,
            borderRadius: "50%",
            display: "flex",
            background:
              "radial-gradient(circle, rgba(172,94,60,0.32) 0%, rgba(172,94,60,0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -150,
            left: -130,
            width: 400,
            height: 400,
            borderRadius: "50%",
            display: "flex",
            background:
              "radial-gradient(circle, rgba(172,94,60,0.16) 0%, rgba(172,94,60,0) 70%)",
          }}
        />

        {/* Marque */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: CLAY,
              display: "flex",
            }}
          />
          <div
            style={{
              display: "flex",
              fontFamily: "Instrument Serif",
              fontSize: 44,
              color: INK,
              letterSpacing: -0.5,
            }}
          >
            Charlie
          </div>
        </div>

        {/* Accroche */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Instrument Serif",
              fontSize: 104,
              lineHeight: 1.04,
              letterSpacing: -3,
              color: INK,
            }}
          >
            <span>Trouver&nbsp;</span>
            <span style={{ fontStyle: "italic", color: CLAY }}>le bon support</span>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Instrument Serif",
              fontSize: 104,
              lineHeight: 1.04,
              letterSpacing: -3,
              color: INK,
            }}
          >
            en une phrase.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 30,
              color: INK_2,
              maxWidth: 760,
            }}
          >
            L&apos;intelligence la plus profonde sur chaque fonds.
          </div>
        </div>

        {/* Pied */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${LINE}`,
            paddingTop: 28,
          }}
        >
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: INK }}>
            charliewealth.fr
          </div>
          <div style={{ display: "flex", fontSize: 26, color: MUTED }}>
            Recherche de fonds pour conseillers
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
