import type { Metadata, Viewport } from "next";
import {
  Instrument_Serif,
  DM_Sans,
  Caveat,
  DM_Mono,
} from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  weight: ["400"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const dmSans = DM_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const caveat = Caveat({
  weight: ["500"],
  subsets: ["latin"],
  variable: "--font-hand",
  display: "swap",
});

const dmMono = DM_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const TITLE = "Charlie Investissement";
const DESCRIPTION = "L'intelligence la plus profonde sur chaque fonds.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: SITE_URL,
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Rendu mobile correct : largeur = écran, pas de zoom desktop par défaut.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="fr"
      className={`${instrumentSerif.variable} ${dmSans.variable} ${caveat.variable} ${dmMono.variable} h-full`}
    >
      <body className="h-full">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
