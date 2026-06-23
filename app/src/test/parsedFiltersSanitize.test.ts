import { describe, it, expect } from "vitest";
import { sanitizeParsedFilters } from "../lib/claude";

// sanitizeParsedFilters durcit la sortie brute du LLM : seuls les champs connus,
// valeurs d'enum autorisées et nombres dans les bornes plausibles sont conservés.

describe("sanitizeParsedFilters", () => {
  it("retourne {} pour une entrée non-objet", () => {
    expect(sanitizeParsedFilters(null)).toEqual({});
    expect(sanitizeParsedFilters("oops")).toEqual({});
    expect(sanitizeParsedFilters(42)).toEqual({});
  });

  it("écarte les clés inconnues (hallucinations)", () => {
    expect(sanitizeParsedFilters({ foo: "bar", region: ["usa"] })).toEqual({ region: ["usa"] });
  });

  it("filtre les valeurs d'enum invalides et garde les valides", () => {
    expect(sanitizeParsedFilters({ region: ["usa", "mars", "world"] })).toEqual({
      region: ["usa", "world"],
    });
    // Plus aucune valeur valide → le champ disparaît (pas de tableau vide).
    expect(sanitizeParsedFilters({ region: ["mars"] })).toEqual({});
  });

  it("ne garde que les SFDR 6/8/9", () => {
    expect(sanitizeParsedFilters({ sfdr: [8, 9, 7, 1] })).toEqual({ sfdr: [8, 9] });
  });

  it("écarte les nombres hors bornes plausibles", () => {
    expect(sanitizeParsedFilters({ sri_max: 3 })).toEqual({ sri_max: 3 });
    expect(sanitizeParsedFilters({ sri_max: 99 })).toEqual({}); // hors [1,7]
    expect(sanitizeParsedFilters({ morningstar_min: 4 })).toEqual({ morningstar_min: 4 });
    expect(sanitizeParsedFilters({ morningstar_min: 0 })).toEqual({}); // hors [1,5]
  });

  it("coerce les nombres passés en chaîne", () => {
    expect(sanitizeParsedFilters({ drawdown_max: "20" })).toEqual({ drawdown_max: 20 });
    expect(sanitizeParsedFilters({ perf_5y_min: "abc" })).toEqual({}); // NaN écarté
  });

  it("conserve les nouveaux filtres Sprint 2", () => {
    expect(
      sanitizeParsedFilters({
        perf_5y_min: 5,
        vol_3y_max: 12,
        sharpe_3y_min: 0.5,
        drawdown_max: 15,
        no_entry_fee: true,
      }),
    ).toEqual({
      perf_5y_min: 5,
      vol_3y_max: 12,
      sharpe_3y_min: 0.5,
      drawdown_max: 15,
      no_entry_fee: true,
    });
  });

  it("ne conserve les booléens que s'ils valent strictement true", () => {
    expect(sanitizeParsedFilters({ has_kid: true, no_entry_fee: false })).toEqual({ has_kid: true });
    expect(sanitizeParsedFilters({ no_entry_fee: "true" })).toEqual({}); // pas un vrai booléen
  });

  it("nettoie exclude_regions / exclude_sectors via les mêmes enums", () => {
    expect(
      sanitizeParsedFilters({ exclude_regions: ["usa", "zzz"], exclude_sectors: ["Technologie", "Bidon"] }),
    ).toEqual({ exclude_regions: ["usa"], exclude_sectors: ["Technologie"] });
  });

  it("tronque et nettoie les chaînes libres", () => {
    expect(sanitizeParsedFilters({ manager_search: "  Amundi  ", free_text: "" })).toEqual({
      manager_search: "Amundi",
    });
  });

  it("ne garde que les labels durabilité officiels", () => {
    expect(sanitizeParsedFilters({ labels: ["isr", "bidon", "greenfin"] })).toEqual({
      labels: ["isr", "greenfin"],
    });
    expect(sanitizeParsedFilters({ labels: ["msci"] })).toEqual({}); // aucun valide → champ absent
  });

  it("ne conserve beats_benchmark que s'il vaut strictement true", () => {
    expect(sanitizeParsedFilters({ beats_benchmark: true })).toEqual({ beats_benchmark: true });
    expect(sanitizeParsedFilters({ beats_benchmark: "true" })).toEqual({});
    expect(sanitizeParsedFilters({ beats_benchmark: false })).toEqual({});
  });

  it("valide sort_intent (colonne triable connue + direction)", () => {
    expect(sanitizeParsedFilters({ sort_intent: { field: "ter", dir: "asc" } })).toEqual({
      sort_intent: { field: "ter", dir: "asc" },
    });
    // dir absente ou invalide → défaut "desc"
    expect(sanitizeParsedFilters({ sort_intent: { field: "aum_eur" } })).toEqual({
      sort_intent: { field: "aum_eur", dir: "desc" },
    });
    // colonne hors whitelist → champ écarté (sinon retomberait silencieusement sur le défaut)
    expect(sanitizeParsedFilters({ sort_intent: { field: "risk_score", dir: "asc" } })).toEqual({});
    expect(sanitizeParsedFilters({ sort_intent: "ter" })).toEqual({});
  });

  it("écarte le plancher SRI quand la fourchette est inversée (sri_min > sri_max)", () => {
    expect(sanitizeParsedFilters({ sri_min: 5, sri_max: 3 })).toEqual({ sri_max: 3 });
    // fourchette cohérente → les deux conservés
    expect(sanitizeParsedFilters({ sri_min: 2, sri_max: 5 })).toEqual({ sri_min: 2, sri_max: 5 });
    expect(sanitizeParsedFilters({ sri_min: 3, sri_max: 3 })).toEqual({ sri_min: 3, sri_max: 3 });
  });

  it("conserve target_maturity et borne le millésime d'échéance (2024-2045)", () => {
    expect(sanitizeParsedFilters({ target_maturity: true })).toEqual({ target_maturity: true });
    expect(sanitizeParsedFilters({ target_maturity: true, maturity_year_min: 2028, maturity_year_max: 2030 }))
      .toEqual({ target_maturity: true, maturity_year_min: 2028, maturity_year_max: 2030 });
    // hors bornes plausibles -> annee ecartee
    expect(sanitizeParsedFilters({ maturity_year_min: 1999 })).toEqual({});
    expect(sanitizeParsedFilters({ maturity_year_max: 2099 })).toEqual({});
    // target_maturity ne vaut que pour true (pas de coercition)
    expect(sanitizeParsedFilters({ target_maturity: "oui" })).toEqual({});
  });

  it("ecarte le plafond de millesime quand la fourchette est inversee", () => {
    expect(sanitizeParsedFilters({ maturity_year_min: 2032, maturity_year_max: 2027 }))
      .toEqual({ maturity_year_min: 2032 });
  });

  it("conserve l.univers private equity (fcpr/fcpi/fip/fpci)", () => {
    expect(sanitizeParsedFilters({ universe: ["fcpr", "fcpi", "fip", "fpci"] }))
      .toEqual({ universe: ["fcpr", "fcpi", "fip", "fpci"] });
    // mix valide + invalide -> ne garde que les valides
    expect(sanitizeParsedFilters({ universe: ["fcpr", "sicav"] }))
      .toEqual({ universe: ["fcpr"] });
  });
});
