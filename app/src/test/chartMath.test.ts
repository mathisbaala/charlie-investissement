import { describe, it, expect } from "vitest";
import {
  rebase100,
  downsample,
  seriesBounds,
  projectSeries,
  polylinePoints,
  areaPath,
  donutSegments,
  axisDateLabels,
  type Pt,
} from "../lib/pdf/chartMath";

describe("rebase100", () => {
  it("rebase sur la première valeur positive", () => {
    expect(rebase100([50, 75, 100])).toEqual([100, 150, 200]);
  });
  it("ignore les têtes nulles / négatives pour choisir la base", () => {
    const out = rebase100([0, 200, 400]);
    // base = 200 → 0→100 (non-fini protégé), 200→100, 400→200
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(200);
  });
  it("retombe à 100 partout si aucune base positive", () => {
    expect(rebase100([0, 0])).toEqual([100, 100]);
  });
});

describe("downsample", () => {
  it("ne touche pas une série déjà courte", () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
  it("réduit à `max` points en gardant extrémités", () => {
    const out = downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
    expect(out.length).toBe(3);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(9);
  });
});

describe("seriesBounds", () => {
  it("calcule min/max temps et valeur sur plusieurs séries", () => {
    const a: Pt[] = [{ t: 0, v: 100 }, { t: 10, v: 120 }];
    const b: Pt[] = [{ t: 5, v: 90 }, { t: 15, v: 110 }];
    const out = seriesBounds([a, b]);
    expect(out).toEqual({ minT: 0, maxT: 15, minV: 90, maxV: 120 });
  });
  it("évite l'amplitude nulle (série plate)", () => {
    const out = seriesBounds([[{ t: 0, v: 100 }, { t: 10, v: 100 }]]);
    expect(out!.maxV - out!.minV).toBeGreaterThan(0);
  });
  it("renvoie null sans point exploitable", () => {
    expect(seriesBounds([[]])).toBeNull();
  });
});

describe("projectSeries", () => {
  it("projette dans le canevas (Y inversé)", () => {
    const b = { minT: 0, maxT: 10, minV: 0, maxV: 100 };
    const out = projectSeries([{ t: 0, v: 0 }, { t: 10, v: 100 }], b, 200, 100, 0);
    expect(out[0]).toEqual({ x: 0, y: 100 }); // valeur basse → bas du graphe
    expect(out[1]).toEqual({ x: 200, y: 0 }); // valeur haute → haut du graphe
  });
});

describe("polylinePoints / areaPath", () => {
  it("formate les points en attribut SVG", () => {
    expect(polylinePoints([{ x: 1.23, y: 4.56 }, { x: 7, y: 8 }])).toBe("1.2,4.6 7,8");
  });
  it("ferme l'aire sur la ligne de base", () => {
    const d = areaPath([{ x: 0, y: 10 }, { x: 20, y: 5 }], 50);
    expect(d.startsWith("M 0 50")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
  it("renvoie une chaîne vide sans point", () => {
    expect(areaPath([], 50)).toBe("");
  });
});

describe("donutSegments", () => {
  it("produit un segment par valeur positive, part = fraction du total", () => {
    const segs = donutSegments([75, 25], { cx: 50, cy: 50, rOuter: 50, rInner: 30 });
    expect(segs.length).toBe(2);
    expect(segs[0].share).toBeCloseTo(0.75, 5);
    expect(segs[1].share).toBeCloseTo(0.25, 5);
    expect(segs[0].d).toContain("A 50 50");
  });
  it("ignore les valeurs nulles / négatives", () => {
    const segs = donutSegments([100, 0, -5], { cx: 0, cy: 0, rOuter: 10, rInner: 6 });
    expect(segs.length).toBe(1);
  });
  it("renvoie [] si total nul", () => {
    expect(donutSegments([0, 0], { cx: 0, cy: 0, rOuter: 10, rInner: 6 })).toEqual([]);
  });
});

describe("axisDateLabels", () => {
  it("renvoie des libellés mois/année aux extrémités", () => {
    const out = axisDateLabels(new Date("2021-01-15").getTime(), new Date("2024-06-15").getTime());
    expect(out.start).toMatch(/2[01]$/); // « janv 21 »
    expect(out.end).toMatch(/2[34]$/);
  });
});
