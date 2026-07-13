import { describe, it, expect } from "vitest";
import { guideForPath } from "@/lib/pageGuide";

describe("guideForPath", () => {
  it("associe chaque route principale à son guide", () => {
    expect(guideForPath("/recherche").title).toBe("Recherche");
    expect(guideForPath("/assureurs").title).toBe("Assurances vie");
    expect(guideForPath("/portefeuille").title).toBe("Portefeuille");
    expect(guideForPath("/documents").title).toBe("Documents");
    expect(guideForPath("/accueil").title).toBe("Accueil");
  });

  it("matche les sous-chemins par préfixe (fiche fonds)", () => {
    expect(guideForPath("/fonds/FR0000974005").title).toBe("Fiche fonds");
    expect(guideForPath("/recherche?q=etf").title).toBe("Recherche");
  });

  it("retombe sur l'accueil pour une route inconnue ou la racine", () => {
    expect(guideForPath("/").title).toBe("Accueil");
    expect(guideForPath("/matching").title).toBe("Accueil");
    expect(guideForPath("/route-inexistante").title).toBe("Accueil");
  });

  it("chaque guide a un intro et des sections non vides avec des puces", () => {
    const paths = ["/recherche", "/assureurs", "/portefeuille", "/documents", "/fonds/X", "/accueil"];
    for (const p of paths) {
      const g = guideForPath(p);
      expect(g.intro.trim().length).toBeGreaterThan(0);
      expect(g.sections.length).toBeGreaterThan(0);
      for (const s of g.sections) {
        expect(s.heading.trim().length).toBeGreaterThan(0);
        expect(s.items.length).toBeGreaterThan(0);
        expect(s.items.every((it) => it.trim().length > 0)).toBe(true);
      }
    }
  });
});
