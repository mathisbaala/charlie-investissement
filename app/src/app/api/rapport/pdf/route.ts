import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import RapportFondsPDF from "@/lib/RapportFondsPDF";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isinsParam = url.searchParams.get("isins") ?? "";
  const isins = isinsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);

  if (isins.length < 1) {
    return NextResponse.json({ error: "Au moins 1 ISIN requis" }, { status: 400 });
  }

  const { data: funds, error } = await supabase
    .from("investissement_funds")
    .select("*")
    .in("isin", isins);

  if (error || !funds?.length) {
    return NextResponse.json({ error: "Fonds introuvables" }, { status: 404 });
  }

  // Conserver l'ordre de sélection
  const ordered = isins
    .map((isin) => funds.find((f) => f.isin === isin))
    .filter(Boolean);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(RapportFondsPDF as any, { funds: ordered });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const date = new Date().toISOString().split("T")[0];
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="rapport-fonds-${date}.pdf"`,
    },
  });
}
