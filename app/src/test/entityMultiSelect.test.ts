import { describe, it, expect } from "vitest";
import { filterEntityOptions, type EntityOption } from "../components/screener/EntityMultiSelect";

const OPTS: EntityOption[] = [
  { value: "Amundi", label: "Amundi", count: 1200 },
  { value: "BNP Paribas AM", label: "BNP Paribas AM", count: 800 },
  { value: "Rothschild & Co", label: "Rothschild & Co", count: 40 },
  { value: "Générali", label: "Générali", count: 60 },
];

describe("filterEntityOptions", () => {
  it("filtre par sous-chaîne, insensible à la casse", () => {
    const r = filterEntityOptions(OPTS, "bnp", []);
    expect(r.map((o) => o.value)).toEqual(["BNP Paribas AM"]);
  });

  it("ignore les accents dans la requête comme dans les options", () => {
    expect(filterEntityOptions(OPTS, "generali", []).map((o) => o.value)).toEqual(["Générali"]);
    expect(filterEntityOptions(OPTS, "générali", []).map((o) => o.value)).toEqual(["Générali"]);
  });

  it("exclut les options déjà sélectionnées", () => {
    const r = filterEntityOptions(OPTS, "", ["Amundi"]);
    expect(r.map((o) => o.value)).not.toContain("Amundi");
    expect(r.map((o) => o.value)).toContain("BNP Paribas AM");
  });

  it("renvoie tout l'univers (hors sélection) quand la requête est vide", () => {
    expect(filterEntityOptions(OPTS, "", [])).toHaveLength(4);
  });

  it("plafonne au nombre max demandé", () => {
    expect(filterEntityOptions(OPTS, "", [], 2)).toHaveLength(2);
  });

  it("renvoie une liste vide quand rien ne matche", () => {
    expect(filterEntityOptions(OPTS, "zzz", [])).toEqual([]);
  });
});
