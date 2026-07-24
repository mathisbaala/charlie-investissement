// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { parseClientBranding, applyBranding } from "@/lib/pdf/brandFromRequest";
import { C, setBrandAccent } from "@/lib/pdf/theme";

// C est un singleton mutable : on rétablit l'accent Charlie après chaque test.
afterEach(() => setBrandAccent(null));

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("parseClientBranding", () => {
  it("accepte un accent hexadécimal et un logo PNG", () => {
    expect(parseClientBranding({ accent: "#2a5067", logo: PNG })).toEqual({
      accent: "#2a5067",
      logo: PNG,
    });
  });

  it("accepte un accent sans dièse", () => {
    expect(parseClientBranding({ accent: "2a5067" }).accent).toBe("2a5067");
  });

  it("rejette un accent invalide", () => {
    expect(parseClientBranding({ accent: "bleu" }).accent).toBeNull();
    expect(parseClientBranding({ accent: "#12" }).accent).toBeNull();
    expect(parseClientBranding({}).accent).toBeNull();
  });

  it("rejette un logo non-PNG (SVG/JPEG non rendus par @react-pdf)", () => {
    expect(parseClientBranding({ logo: "data:image/svg+xml,<svg/>" }).logo).toBeNull();
    expect(parseClientBranding({ logo: "https://x.fr/logo.png" }).logo).toBeNull();
  });

  it("rejette un logo au-delà de la taille plafond", () => {
    const huge = "data:image/png;base64," + "A".repeat(1_500_001);
    expect(parseClientBranding({ logo: huge }).logo).toBeNull();
  });

  it("tolère une entrée absente ou non-objet", () => {
    expect(parseClientBranding(undefined)).toEqual({ accent: null, logo: null });
    expect(parseClientBranding("nope")).toEqual({ accent: null, logo: null });
  });
});

describe("applyBranding", () => {
  it("applique la couleur de marque et rend le logo cabinet fourni", async () => {
    const logo = await applyBranding({ accent: "#2a5067", logo: PNG });
    expect(C.clay).toBe("#2a5067");
    expect(logo).toBe(PNG);
  });

  it("rétablit l'accent Charlie quand la marque est absente", async () => {
    setBrandAccent("#2a5067");
    // Sans logo cabinet : repli sur le « C » Charlie (data URI non vide).
    const logo = await applyBranding({ accent: null, logo: null });
    expect(C.clay).toBe("#8F4A31");
    expect(logo && logo.startsWith("data:image/")).toBe(true);
  });
});
