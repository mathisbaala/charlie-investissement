// @vitest-environment node
//
// pdfToLines s'appuie sur pdfjs (API Node) : env `node`, pas jsdom. On fabrique
// un vrai PDF avec @react-pdf/renderer puis on le relit — le seul test qui
// exerce le pipeline PDF de bout en bout (les autres testent les fonctions pures).
import React from "react";
import { describe, it, expect } from "vitest";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { pdfToLines } from "@/lib/pdfText";

const makePdf = (line: string): Promise<Buffer> =>
  renderToBuffer(
    React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        null,
        React.createElement(View, null, React.createElement(Text, null, line)),
      ),
    ),
  );

describe("pdfToLines", () => {
  it("reconstruit le texte d'un PDF (ISIN + montant sur la même ligne)", async () => {
    const buf = await makePdf("FR0000295230  5 574,67 EUR");
    const text = await pdfToLines(new Uint8Array(buf));
    expect(text).toContain("FR0000295230");
    expect(text).toContain("5 574,67");
  });

  it("NE DÉTACHE PAS le buffer de l'appelant (régression: PDF vide envoyé à l'IA)", async () => {
    // pdfjs transfère l'ArrayBuffer passé à getDocument. La route relevé réutilise
    // ses octets après pdfToLines (base64 → Vision) : si le buffer était détaché,
    // elle enverrait un PDF vide à Claude (« PDF cannot be empty », 400). La copie
    // défensive dans pdfToLines doit garder l'entrée intacte.
    const buf = await makePdf("LU1234567890  10 000,00 EUR");
    const input = new Uint8Array(buf);
    const before = input.byteLength;
    expect(before).toBeGreaterThan(0);
    await pdfToLines(input);
    expect(input.byteLength).toBe(before);
  });
});
