import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Le badge de dev Next.js se place par défaut en bas à gauche, pile sur
  // l'icône « Mon cabinet » du rail (introuvable en dev). On le déporte.
  devIndicators: { position: "bottom-right" },
  // pdfjs (extraction des relevés, /api/releve) doit rester un module Node
  // externe : bundlé par Next, son import dynamique casse (résolution worker).
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
