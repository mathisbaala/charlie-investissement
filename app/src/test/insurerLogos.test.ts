// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  slugifyInsurer,
  insurerLogoSrc,
  insurerInitials,
} from "@/lib/insurer-logos";
import { INSURER_LOGO_SLUGS } from "@/lib/insurer-logos.generated";

describe("slugifyInsurer", () => {
  it("met en minuscules et tirets", () => {
    expect(slugifyInsurer("AXA France")).toBe("axa-france");
  });
  it("retire les accents", () => {
    expect(slugifyInsurer("Oradéa Vie")).toBe("oradea-vie");
    expect(slugifyInsurer("Prépar Vie")).toBe("prepar-vie");
    expect(slugifyInsurer("Caisse d'Épargne")).toBe("caisse-d-epargne");
  });
  it("gère les séparateurs multiples et points", () => {
    expect(slugifyInsurer("Apicil / OneLife")).toBe("apicil-onelife");
    expect(slugifyInsurer("Utmost Luxembourg S.A.")).toBe("utmost-luxembourg-s-a");
  });
  it("est stable (idempotent) sur un slug déjà propre", () => {
    expect(slugifyInsurer("generali-vie")).toBe("generali-vie");
  });
});

describe("insurerLogoSrc", () => {
  it("renvoie le chemin pour un assureur ayant un logo", () => {
    // generali-vie est présent dans le lot sourcé.
    expect(INSURER_LOGO_SLUGS.has("generali-vie")).toBe(true);
    expect(insurerLogoSrc("Generali Vie")).toBe("/insurers/generali-vie.png");
  });
  it("réutilise le logo de la maison mère via alias de marque", () => {
    // Allianz Life Luxembourg n'a pas de fichier propre → logo Allianz France.
    expect(INSURER_LOGO_SLUGS.has("allianz-life-luxembourg")).toBe(false);
    expect(insurerLogoSrc("Allianz Life Luxembourg")).toBe("/insurers/allianz-france.png");
    expect(insurerLogoSrc("Swiss Life Luxembourg")).toBe("/insurers/swisslife-france.png");
  });
  it("résout les logos curés (Wikimedia) avec le bon slug", () => {
    expect(insurerLogoSrc("APICIL")).toBe("/insurers/apicil.png");
    // slugs à pièges (apostrophe / espace).
    expect(insurerLogoSrc("Caisse d'Épargne")).toBe("/insurers/caisse-d-epargne.png");
    expect(insurerLogoSrc("Bourse Direct")).toBe("/insurers/bourse-direct.png");
  });
  it("aliasse les véhicules Apicil vers le logo APICIL", () => {
    expect(insurerLogoSrc("Apicil / OneLife")).toBe("/insurers/apicil.png");
    expect(insurerLogoSrc("APICIL Luxembourg")).toBe("/insurers/apicil.png");
  });
  it("résout les logos curés LOCAUX (fichiers commités)", () => {
    // Spirica, Selencia, Sogécap, Oradéa Vie, Le Conservateur : logos fournis à la
    // main (le favicon ne renvoyait qu'un placeholder gris ou rien).
    expect(INSURER_LOGO_SLUGS.has("spirica")).toBe(true);
    expect(insurerLogoSrc("Spirica")).toBe("/insurers/spirica.png");
    expect(insurerLogoSrc("Selencia")).toBe("/insurers/selencia.png");
    expect(insurerLogoSrc("Sogécap")).toBe("/insurers/sogecap.png");
    expect(insurerLogoSrc("Oradéa Vie")).toBe("/insurers/oradea-vie.png");
    expect(insurerLogoSrc("Le Conservateur")).toBe("/insurers/le-conservateur.png");
  });
  it("renvoie null quand aucun logo n'a été sourcé (repli monogramme)", () => {
    expect(insurerLogoSrc("Assureur Sans Logo XYZ")).toBeNull();
  });
  it("renvoie null pour une valeur vide/absente", () => {
    expect(insurerLogoSrc("")).toBeNull();
    expect(insurerLogoSrc(null)).toBeNull();
    expect(insurerLogoSrc(undefined)).toBeNull();
    expect(insurerLogoSrc("Assureur Inconnu XYZ")).toBeNull();
  });
});

describe("insurerInitials", () => {
  it("prend les initiales des deux premiers mots significatifs", () => {
    expect(insurerInitials("Bourse Direct")).toBe("BD");
    expect(insurerInitials("Trade Republic")).toBe("TR");
  });
  it("ignore les mots vides (de, la, vie…)", () => {
    expect(insurerInitials("Generali Vie")).toBe("GE"); // « Vie » ignoré → un seul mot
    expect(insurerInitials("Caisse d'Épargne")).toBe("CE"); // « d' » ignoré
  });
  it("prend deux lettres pour un mot unique", () => {
    expect(insurerInitials("Spirica")).toBe("SP");
    expect(insurerInitials("APICIL")).toBe("AP");
  });
  it("gère les valeurs vides", () => {
    expect(insurerInitials("")).toBe("?");
    expect(insurerInitials(null)).toBe("?");
  });
});
