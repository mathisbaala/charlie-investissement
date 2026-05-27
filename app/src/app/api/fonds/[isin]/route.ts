import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ isin: string }> }
) {
  const { isin } = await params;

  const { data, error } = await supabase
    .from("investissement_funds")
    .select("*")
    .eq("isin", isin)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Fonds non trouvé" }, { status: 404 });
  }

  return NextResponse.json({ fund: data });
}
