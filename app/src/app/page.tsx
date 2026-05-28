import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const cookieStore = await cookies();
  const seen = cookieStore.get("charlie_seen");

  if (seen?.value === "1") {
    redirect("/accueil");
  }

  redirect("/landing");
}
