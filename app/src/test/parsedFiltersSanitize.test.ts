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
});
