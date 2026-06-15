import Link from "next/link";

// Page 404 on-brand (au lieu de la page par défaut de Next). Couvre les ISIN
// inexistants (/fonds/XXX) et les routes inconnues.
export default function NotFound() {
  return (
    <div className="h-full min-h-screen flex items-center justify-center bg-cream px-6">
      <div className="max-w-md text-center">
        <p
          className="text-[40px] text-ink italic mb-2"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Introuvable.
        </p>
        <p className="text-[13px] text-muted mb-6">
          Cette page ou ce fonds n'existe pas (ou plus). Reviens à la recherche
          pour trouver le bon support.
        </p>
        <Link
          href="/accueil"
          className="inline-block px-4 py-2 rounded-lg bg-accent text-paper text-[13px] font-medium hover:bg-accent/90 transition-colors"
        >
          Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
