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
  // Le require() de @napi-rs/canvas par pdfjs est dynamique → invisible au
  // traceur de fichiers. On force l'inclusion du paquet ET de son binaire natif
  // de plateforme (@napi-rs/canvas-linux-x64-gnu sur Vercel) dans les lambdas
  // des routes qui lisent des PDF, sinon « Cannot find module '@napi-rs/canvas' ».
  outputFileTracingIncludes: {
    "/api/releve": ["./node_modules/@napi-rs/canvas*/**/*"],
    "/api/dici/parse": ["./node_modules/@napi-rs/canvas*/**/*"],
  },
};

export default nextConfig;
