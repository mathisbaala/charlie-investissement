import { describe, it, expect, afterEach } from "vitest";
import { C, setBrandAccent } from "../lib/pdf/theme";
import { relativeLuminance } from "../lib/branding";

// Remet la palette Charlie par défaut après chaque test (C est un singleton).
afterEach(() => setBrandAccent(null));

describe("setBrandAccent", () => {
  it("remplace l'accent des documents par la couleur de la marque", () => {
    setBrandAccent("#2a5067");
    expect(C.clay).toBe("#2a5067");
  });

  it("dérive un fond doux clair et un texte foncé cohérents", () => {
    setBrandAccent("#2a5067");
    // Fond doux nettement plus clair que l'accent ; texte nettement plus foncé.
    expect(relativeLuminance(C.claySoft)).toBeGreaterThan(relativeLuminance(C.clay));
    expect(relativeLuminance(C.clayInk)).toBeLessThan(relativeLuminance(C.clay));
    // Version couverture : plus claire que l'accent (lisible sur fond sombre).
    expect(relativeLuminance(C.clayOnDark)).toBeGreaterThan(relativeLuminance(C.clay));
  });

  it("accepte une couleur sans dièse", () => {
    setBrandAccent("e53935");
    expect(C.clay).toBe("#e53935");
  });

  it("rétablit l'accent clay Charlie quand la marque est absente", () => {
    setBrandAccent("#2a5067");
    setBrandAccent(null);
    expect(C.clay).toBe("#8F4A31");
    expect(C.clayOnDark).toBe("#C88A6E");
  });

  it("ignore une valeur invalide (garde le défaut)", () => {
    setBrandAccent("pas-une-couleur");
    expect(C.clay).toBe("#8F4A31");
  });
});
