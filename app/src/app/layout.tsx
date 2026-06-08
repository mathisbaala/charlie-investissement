import type { Metadata } from "next";
import {
  Instrument_Serif,
  DM_Sans,
  Caveat,
  DM_Mono,
} from "next/font/google";
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

export const metadata: Metadata = {
  title: "Charlie Investissement",
  description: "L'intelligence la plus profonde sur chaque fonds.",
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
      <body className="h-full">{children}</body>
    </html>
  );
}
