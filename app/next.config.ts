import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Le badge de dev Next.js se place par défaut en bas à gauche, pile sur
  // l'icône « Mon cabinet » du rail (introuvable en dev). On le déporte.
  devIndicators: { position: "bottom-right" },
  // pdfjs et xlsx (extraction des relevés, /api/releve) restent des modules
  // Node externes : bundlés par Next, leurs imports dynamiques cassent
  // (résolution worker pour pdfjs ; cpexcel pour xlsx). @napi-rs/canvas est
  // requis DYNAMIQUEMENT par pdfjs-dist v6 legacy pour fournir DOMMatrix/Path2D :
  // sans lui en serverless, l'extraction texte throw (« Cannot polyfill
  // DOMMatrix ») → tout upload PDF de relevé tombait en 422. Externe = Next ne
  // tente pas de bundler ses binaires natifs par plateforme.
  serverExternalPackages: ["pdfjs-dist", "xlsx", "@napi-rs/canvas"],
  // pdfjs-dist charge par import DYNAMIQUE (invisible au traceur de fichiers)
  // deux choses absentes de la lambda sinon :
  //   • son worker `pdf.worker.mjs` (« Setting up fake worker failed: Cannot
  //     find module …/pdf.worker.mjs ») → le VRAI blocage du 422 ;
  //   • @napi-rs/canvas + son binaire natif de plateforme (DOMMatrix/Path2D).
  // On force l'inclusion des deux dans les lambdas des routes qui lisent des PDF.
  outputFileTracingIncludes: {
    "/api/releve": [
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
    ],
    "/api/dici/parse": [
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
    ],
  },
  // Alignement URL ↔ onglet du rail (juillet 2026) : l'onglet « Frais » vivait
  // sous /simulateur et « Partenaires » sous /assureurs. Les routes ont été
  // renommées pour coller aux libellés ; on garde les anciens chemins en
  // redirection permanente (301) pour les liens, signets et l'indexation SEO —
  // les query strings (?isins=…, ?key=…, ?company=…) sont préservées d'office.
  async redirects() {
    return [
      { source: "/simulateur", destination: "/frais", permanent: true },
      { source: "/assureurs", destination: "/partenaires", permanent: true },
      { source: "/assureurs/:path*", destination: "/partenaires/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
