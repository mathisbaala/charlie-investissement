import { describe, it, expect } from "vitest";
import {
  serializeForNlp,
  isProfileActive,
  profileToScreenerFilters,
  EMPTY_PROFILE,
} from "../lib/clientProfile";

// Les critères « contexte » (besoin de revenus, réaction à une baisse, zones
// géographiques) enrichissent la chaîne NLP du screener mais ne produisent PAS
// de filtre dur — au même titre que l'âge, l'horizon ou la TMI.

describe("serializeForNlp — nouveaux critères de contexte", () => {
  it("sérialise le besoin de revenus", () => {
    expect(serializeForNlp({ ...EMPTY_PROFILE, income_need: "regulier" }))
      .toContain("revenus réguliers");
    expect(serializeForNlp({ ...EMPTY_PROFILE, income_need: "ponctuel" }))
      .toContain("revenus ponctuels");
    expect(serializeForNlp({ ...EMPTY_PROFILE, income_need: "non" }))
      .toContain("capitalisation");
  });

  it("sérialise la réaction à une forte baisse", () => {
    expect(serializeForNlp({ ...EMPTY_PROFILE, reaction_baisse: "vendre" }))
      .toContain("tendance à vendre");
    expect(serializeForNlp({ ...EMPTY_PROFILE, reaction_baisse: "renforcer" }))
      .toContain("tendance à renforcer");
  });

  it("sérialise les zones géographiques avec leurs libellés lisibles", () => {
    const s = serializeForNlp({ ...EMPTY_PROFILE, geographies: ["zone_euro", "emergents"] });
    expect(s).toContain("zones géographiques privilégiées");
    expect(s).toContain("Zone euro");
    expect(s).toContain("Marchés émergents");
  });

  it("ne sérialise rien pour les nouveaux champs laissés vides", () => {
    expect(serializeForNlp(EMPTY_PROFILE)).toBe("");
  });
});

describe("isProfileActive — nouveaux critères", () => {
  it("est actif dès qu'un nouveau critère est renseigné", () => {
    expect(isProfileActive({ ...EMPTY_PROFILE, income_need: "ponctuel" })).toBe(true);
    expect(isProfileActive({ ...EMPTY_PROFILE, reaction_baisse: "conserver" })).toBe(true);
    expect(isProfileActive({ ...EMPTY_PROFILE, geographies: ["monde"] })).toBe(true);
  });

  it("reste inactif pour un profil vide", () => {
    expect(isProfileActive(EMPTY_PROFILE)).toBe(false);
  });
});

describe("profileToScreenerFilters — nouveaux critères = contexte uniquement", () => {
  it("n'émet aucun filtre dur pour les champs de contexte", () => {
    expect(profileToScreenerFilters({
      ...EMPTY_PROFILE,
      income_need: "regulier",
      reaction_baisse: "vendre",
      geographies: ["europe", "asie"],
    })).toEqual({});
  });
});
