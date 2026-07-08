import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Aperçu de lien (LinkedIn, WhatsApp, Slack, X…) aux couleurs Charlie.
export const alt =
  "Charlie Investissement, l'intelligence la plus profonde sur chaque fonds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Palette dérivée de globals.css (oklch → hex approché, Satori ne gère pas oklch).
const CREAM = "#F5F3EF";
const INK = "#2C2A27";
const INK_2 = "#4A4742";
const MUTED = "#8B8782";
const CLAY = "#8F4A31"; // clay désaturé (cohérent app + PDF)
const LINE = "#D8D4CE";

const INTER = "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest";

// Chargement best-effort : en cas d'échec réseau, on rend sans police custom
// (Satori bascule sur sa police par défaut) plutôt que de casser le build.
async function loadFonts() {
  try {
    const [regular, semibold, italic] = await Promise.all([
      fetch(`${INTER}/latin-400-normal.ttf`).then((r) => r.arrayBuffer()),
      fetch(`${INTER}/latin-600-normal.ttf`).then((r) => r.arrayBuffer()),
      fetch(`${INTER}/latin-400-italic.ttf`).then((r) => r.arrayBuffer()),
    ]);
    return [
      { name: "Inter", data: regular, style: "normal" as const, weight: 400 as const },
      { name: "Inter", data: semibold, style: "normal" as const, weight: 600 as const },
      { name: "Inter", data: italic, style: "italic" as const, weight: 400 as const },
    ];
  } catch {
    return [];
  }
}

// Logo officiel Charlie (le « C ») embarqué en data URI : lecture disque au
// rendu (route Node), pas de dépendance réseau. En cas d'échec, on retombe
// sur la pastille clay historique.
async function loadLogo(): Promise<string | null> {
  try {
    const png = await readFile(join(process.cwd(), "public", "charlie-logo.png"));
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image() {
  const [fonts, logo] = await Promise.all([loadFonts(), loadLogo()]);

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
          fontFamily: "Inter",
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
              "radial-gradient(circle, rgba(143,74,49,0.28) 0%, rgba(143,74,49,0) 70%)",
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
              "radial-gradient(circle, rgba(143,74,49,0.14) 0%, rgba(143,74,49,0) 70%)",
          }}
        />

        {/* Marque */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt="Charlie"
              width={64}
              height={64}
              style={{ width: 64, height: 64, objectFit: "contain" }}
            />
          ) : (
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: CLAY,
                display: "flex",
              }}
            />
          )}
          <div
            style={{
              display: "flex",
              fontFamily: "Inter",
              fontWeight: 600,
              fontSize: 46,
              color: INK,
              letterSpacing: -1,
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
              fontFamily: "Inter",
              fontWeight: 600,
              fontSize: 92,
              lineHeight: 1.06,
              letterSpacing: -3,
              color: INK,
            }}
          >
            <span>Trouver&nbsp;</span>
            <span style={{ color: CLAY }}>le bon support</span>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Inter",
              fontWeight: 600,
              fontSize: 92,
              lineHeight: 1.06,
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
