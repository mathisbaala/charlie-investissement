import type { Metadata, Viewport } from "next";
import { Inter, DM_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Police d'interface unique : Inter. Sans-serif neutre, institutionnelle et
// hyper-lisible pour les tableaux financiers denses (registre fintech/banque,
// pas « éditorial/coffee shop »). Elle alimente à la fois --font-sans et, via
// globals.css, --font-sans (alias, plus de serif décorative). DM Mono reste
// réservé aux chiffres/ISIN tabulaires.
const inter = Inter({
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-sans",
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
      className={`${inter.variable} ${dmMono.variable} h-full`}
    >
      {/* suppressHydrationWarning : les extensions navigateur (Grammarly…)
          injectent des attributs dans <body> avant l'hydratation React →
          faux mismatch serveur/client. N'affecte que CETTE balise, pas ses
          enfants (les vraies erreurs d'hydratation restent visibles). */}
      <body className="h-full" suppressHydrationWarning>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
