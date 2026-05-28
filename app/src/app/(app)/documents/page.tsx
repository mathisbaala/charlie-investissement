import React from "react";
import Link from "next/link";
import { Btn } from "@/components/ui/Btn";
import { FileText } from "@/components/ui/icons";

export default function DocumentsPage() {
  return (
    <div className="h-full overflow-y-auto bg-cream px-8 py-8">
      {/* Header */}
      <h1
        className="text-[26px] text-ink"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Documents
      </h1>
      <p className="text-[13px] text-muted mt-1">
        Accédez aux DICIs, prospectus et rapports réglementaires.
      </p>

      {/* Empty state card */}
      <div className="mt-8 bg-paper rounded-xl border border-line p-12 flex flex-col items-center text-center">
        <FileText size={40} className="text-muted-2" strokeWidth={1.25} />
        <p className="text-[14px] text-ink mt-4">
          Documents non encore indexés
        </p>
        <p className="text-[12px] text-muted mt-2 max-w-md">
          Les documents réglementaires (DICI, prospectus, rapports ESG) seront
          disponibles prochainement. En attendant, accédez directement aux DICIs
          depuis les fiches fonds.
        </p>
        <Link href="/recherche" className="mt-6">
          <Btn variant="primary" size="sm">
            Rechercher des fonds
          </Btn>
        </Link>
      </div>
    </div>
  );
}
