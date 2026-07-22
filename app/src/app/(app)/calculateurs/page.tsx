import type { Metadata } from "next";
import { CalculateursClient } from "@/components/calculateurs/CalculateursClient";

export const metadata: Metadata = {
  title: "Calculateurs — Charlie",
  description:
    "Calculateurs patrimoniaux : transmission, succession, donation, assurance-vie, IFI — en langage naturel.",
};

export default function CalculateursPage() {
  return <CalculateursClient />;
}
