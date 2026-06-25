import { redirect } from "next/navigation";

// La page « Profil client » a été fusionnée dans l'accueil (recherche en langage
// naturel + profil client). On garde la route pour ne pas casser les liens, elle
// redirige vers l'accueil.
export default function MatchingPage() {
  redirect("/accueil");
}
