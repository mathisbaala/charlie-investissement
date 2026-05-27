import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { renderToBuffer } from "@react-pdf/renderer";
import FicheFondsPDF from "@/lib/FicheFondsPDF";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ isin: string }> }
) {
  const { isin } = await params;

  const { data: fund, error } = await supabase
    .from("investissement_funds")
    .select("*")
    .eq("isin", isin)
    .single();

  if (error || !fund) {
    return NextResponse.json({ error: "Fonds non trouvé" }, { status: 404 });
  }

  const buffer = await renderToBuffer(<FicheFondsPDF fund={fund} />);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="fiche-${isin}.pdf"`,
    },
  });
}
