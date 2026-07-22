import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  saturation,
  readableOn,
  ensureUsableAccent,
  deriveAccentVars,
  colorDistance,
  pickDistinct,
} from "../lib/branding";

describe("normalizeHex", () => {
  it("développe le format court #rgb", () => {
    expect(normalizeHex("#0af")).toBe("#00aaff");
  });
  it("accepte #rrggbb et le passe en minuscules avec dièse", () => {
    expect(normalizeHex("C0392B")).toBe("#c0392b");
    expect(normalizeHex("#C0392B")).toBe("#c0392b");
  });
  it("convertit rgb() en hexadécimal", () => {
    expect(normalizeHex("rgb(192, 57, 43)")).toBe("#c0392b");
  });
  it("ignore le canal alpha de rgba()", () => {
    expect(normalizeHex("rgba(0, 170, 255, 0.5)")).toBe("#00aaff");
  });
  it("gère les composantes en pourcentage", () => {
    expect(normalizeHex("rgb(100%, 0%, 0%)")).toBe("#ff0000");
  });
  it("rejette les entrées invalides", () => {
    expect(normalizeHex("pas une couleur")).toBeNull();
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("rgb(300, 0, 0)")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe("hexToRgb", () => {
  it("décompose en canaux 0-255", () => {
    expect(hexToRgb("#c0392b")).toEqual([192, 57, 43]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("le blanc est plus lumineux que le noir", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });
  it("le contraste blanc/noir vaut 21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });
  it("le contraste est symétrique", () => {
    expect(contrastRatio("#c0392b", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#c0392b"),
      6,
    );
  });
});

describe("saturation", () => {
  it("un gris a une saturation nulle", () => {
    expect(saturation("#808080")).toBe(0);
  });
  it("une couleur pure est saturée", () => {
    expect(saturation("#ff0000")).toBeCloseTo(1, 5);
  });
});

describe("readableOn", () => {
  it("choisit le texte blanc sur une couleur sombre", () => {
    expect(readableOn("#1a1a2e")).toBe("#ffffff");
  });
  it("choisit l'encre foncée sur une couleur claire", () => {
    expect(readableOn("#ffe000")).toBe("#333030");
  });
});

describe("ensureUsableAccent", () => {
  it("laisse intacte une couleur déjà lisible", () => {
    expect(ensureUsableAccent("#c0392b")).toBe("#c0392b");
  });
  it("assombrit une couleur trop claire jusqu'à un contraste utilisable", () => {
    const out = ensureUsableAccent("#ffe000"); // jaune vif, illisible en accent
    expect(out).not.toBe("#ffe000");
    expect(contrastRatio(out, "#ffffff")).toBeGreaterThanOrEqual(3);
  });
  it("garde la teinte dominante en assombrissant (le rouge reste rouge)", () => {
    const out = ensureUsableAccent("#ff5555");
    const [r, g, b] = hexToRgb(out);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });
});

describe("colorDistance", () => {
  it("est nulle entre couleurs identiques", () => {
    expect(colorDistance("#c0392b", "#c0392b")).toBe(0);
  });
  it("est maximale entre noir et blanc", () => {
    expect(colorDistance("#000000", "#ffffff")).toBeCloseTo(441.67, 1);
  });
});

describe("pickDistinct", () => {
  it("garde toujours la première couleur (la plus présente)", () => {
    const out = pickDistinct(["#c0392b", "#c13a2c", "#c23b2d"], 3);
    expect(out[0]).toBe("#c0392b");
  });
  it("écarte les quasi-doublons et ne garde que des couleurs distinctes", () => {
    // Trois rouges quasi identiques + un bleu → on veut le rouge et le bleu.
    const out = pickDistinct(["#c0392b", "#c13a2c", "#c23b2d", "#2a5067"], 3);
    expect(out).toEqual(["#c0392b", "#2a5067"]);
  });
  it("propose jusqu'à trois couleurs franchement différentes", () => {
    const out = pickDistinct(["#e53935", "#3c2619", "#6e95b1", "#009439"], 3);
    expect(out.length).toBe(3);
    expect(out[0]).toBe("#e53935");
  });
  it("normalise et ignore les entrées invalides", () => {
    const out = pickDistinct(["E53935", "pas-une-couleur", "#2a5067"], 3);
    expect(out).toEqual(["#e53935", "#2a5067"]);
  });
});

describe("deriveAccentVars", () => {
  it("produit les six variables d'accent", () => {
    const vars = deriveAccentVars("#c0392b");
    expect(Object.keys(vars).sort()).toEqual(
      [
        "--color-accent",
        "--color-accent-ink",
        "--color-accent-soft",
        "--color-accent-tint",
        "--color-brown",
        "--color-brown-2",
      ].sort(),
    );
  });
  it("aligne accent et brown sur la même couleur utilisable", () => {
    const vars = deriveAccentVars("#c0392b");
    expect(vars["--color-accent"]).toBe(vars["--color-brown"]);
    expect(vars["--color-accent"]).toBe(ensureUsableAccent("#c0392b"));
  });
  it("les fonds doux/pâles sont plus clairs que l'accent", () => {
    const vars = deriveAccentVars("#c0392b");
    expect(relativeLuminance(vars["--color-accent-soft"])).toBeGreaterThan(
      relativeLuminance(vars["--color-accent"]),
    );
    expect(relativeLuminance(vars["--color-accent-tint"])).toBeGreaterThan(
      relativeLuminance(vars["--color-accent-soft"]),
    );
  });
});
