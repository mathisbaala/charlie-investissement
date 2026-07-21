import { describe, it, expect } from "vitest";
import { bestFeSeries, type FeRate } from "@/lib/fonds-euros";

const r = (fonds_euros_nom: string, annee: number, taux_pct: number): FeRate => ({
  fonds_euros_nom,
  annee,
  taux_pct,
});

describe("bestFeSeries", () => {
  it("retourne [] quand aucune ligne", () => {
    expect(bestFeSeries([])).toEqual([]);
  });

  it("trie une série unique par année croissante", () => {
    const out = bestFeSeries([r("Euro", 2024, 2.8), r("Euro", 2022, 2.1), r("Euro", 2023, 2.5)]);
    expect(out.map((x) => x.annee)).toEqual([2022, 2023, 2024]);
  });

  it("privilégie le fonds euros au millésime le plus récent", () => {
    const out = bestFeSeries([
      r("Dynamique", 2023, 3.5),
      r("Dynamique", 2022, 3.4),
      r("Général", 2024, 2.6),
      r("Général", 2023, 2.5),
    ]);
    expect(out.every((x) => x.fonds_euros_nom === "Général")).toBe(true);
    expect(out.map((x) => x.annee)).toEqual([2023, 2024]);
  });

  it("à millésime égal, retient le meilleur dernier taux", () => {
    const out = bestFeSeries([r("Prudent", 2024, 2.2), r("Boosté", 2024, 3.1)]);
    expect(out[0].fonds_euros_nom).toBe("Boosté");
  });

  it("ignore les lignes sans année ou sans taux", () => {
    const dirty = [
      r("Euro", 2024, 2.8),
      { fonds_euros_nom: "Euro", annee: null as unknown as number, taux_pct: 9 },
      { fonds_euros_nom: "Euro", annee: 2023, taux_pct: null as unknown as number },
    ];
    const out = bestFeSeries(dirty);
    expect(out).toHaveLength(1);
    expect(out[0].annee).toBe(2024);
  });
});
