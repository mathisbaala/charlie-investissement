import { describe, it, expect } from "vitest";
import { orderInsurersByPartners } from "../components/screener/FilterPanel";

// Filtre « Référencé chez » du screener : les partenaires du cabinet remontent
// en tête (pastille), les autres restent consultables dessous — contrairement
// à l'allocation où le périmètre est strict.
const OPTIONS = [
  { company: "Axa", funds: 300 },
  { company: "Cardif Lux Vie", funds: 650 },
  { company: "Generali Luxembourg", funds: 722 },
];

describe("orderInsurersByPartners", () => {
  it("sépare partenaires (en tête) et autres, sans rien perdre", () => {
    const { partnerRows, otherRows } = orderInsurersByPartners(OPTIONS, ["Cardif Lux Vie"]);
    expect(partnerRows.map((o) => o.company)).toEqual(["Cardif Lux Vie"]);
    expect(otherRows.map((o) => o.company)).toEqual(["Axa", "Generali Luxembourg"]);
    expect(partnerRows.length + otherRows.length).toBe(OPTIONS.length);
  });

  it("sans partenaire déclaré, tout reste dans la liste principale", () => {
    const { partnerRows, otherRows } = orderInsurersByPartners(OPTIONS, []);
    expect(partnerRows).toEqual([]);
    expect(otherRows).toHaveLength(3);
  });

  it("le rapprochement ignore accents et casse", () => {
    const { partnerRows } = orderInsurersByPartners(OPTIONS, ["CARDIF LUX VIE", "généràli luxembourg"]);
    expect(partnerRows.map((o) => o.company)).toEqual(["Cardif Lux Vie", "Generali Luxembourg"]);
  });
});
