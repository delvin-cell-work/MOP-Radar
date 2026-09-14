import { describe, expect, it } from "vitest";

import type { Cohort, TownSummary } from "../lib/data-contract";
import { nearestSnap } from "../components/ResultsSheet";
import { blockMatchesView, neighbouringTowns, sortBlocksForView, townCountForView } from "../lib/views";

function town(slug: string, lat: number, lng: number, cohorts: Partial<Record<Cohort, number>>): TownSummary {
  const counts = { upcoming: 0, just_mopped: 0, mature: 0, later: 0, ...cohorts };
  const blocks = counts.upcoming + counts.just_mopped + counts.mature + counts.later;
  return {
    code: slug.toUpperCase(),
    name: slug,
    slug,
    blocks,
    confirmed: 0,
    estimated: blocks,
    cohorts: counts,
    center: { lat, lng },
  };
}

const withMonths = (...months: number[]) => months.map((m, i) => ({ id: `b${i}`, months_since_mop: m }));

describe("sortBlocksForView", () => {
  it("puts the most recent MOP first for just_mopped", () => {
    expect(sortBlocksForView(withMonths(5, 0, 12), "just_mopped").map((b) => b.months_since_mop)).toEqual([0, 5, 12]);
  });

  it("puts the soonest MOP first for upcoming", () => {
    expect(sortBlocksForView(withMonths(-22, -1, -10), "upcoming").map((b) => b.months_since_mop)).toEqual([
      -1, -10, -22,
    ]);
  });

  it("puts blocks closest to MOP in either direction first for all", () => {
    expect(sortBlocksForView(withMonths(-3, 30, 1, -40), "all").map((b) => b.months_since_mop)).toEqual([
      1, -3, 30, -40,
    ]);
  });

  it("breaks ties by id and does not mutate the input", () => {
    const blocks = [
      { id: "b", months_since_mop: 2 },
      { id: "a", months_since_mop: 2 },
    ];
    expect(sortBlocksForView(blocks, "just_mopped").map((b) => b.id)).toEqual(["a", "b"]);
    expect(blocks[0].id).toBe("b");
  });
});

describe("blockMatchesView and townCountForView", () => {
  const sample = town("tampines", 1.35, 103.94, { upcoming: 2, just_mopped: 3, mature: 10, later: 1 });

  it("counts only the view's cohorts", () => {
    expect(townCountForView(sample, "just_mopped")).toBe(3);
    expect(townCountForView(sample, "upcoming")).toBe(2);
    expect(townCountForView(sample, "all")).toBe(16);
  });

  it("matches every cohort in the all view", () => {
    expect(blockMatchesView({ cohort: "later" }, "all")).toBe(true);
    expect(blockMatchesView({ cohort: "mature" }, "just_mopped")).toBe(false);
  });
});

describe("neighbouringTowns", () => {
  const towns = [
    town("bishan", 1.3512, 103.8481, { just_mopped: 0 }),
    town("toa-payoh", 1.336, 103.8566, { just_mopped: 26 }),
    town("ang-mo-kio", 1.3702, 103.8476, { just_mopped: 3 }),
    town("serangoon", 1.357, 103.8723, { just_mopped: 0 }),
    town("sengkang", 1.3906, 103.8946, { just_mopped: 12 }),
  ];

  it("returns the nearest other towns with results, closest first", () => {
    const result = neighbouringTowns(towns, "bishan", "just_mopped", 2);
    expect(result.map((t) => t.slug)).toEqual(["toa-payoh", "ang-mo-kio"]);
    expect(result[0].count).toBe(26);
    expect(result[0].km).toBeGreaterThan(1);
    expect(result[0].km).toBeLessThan(result[1].km);
  });

  it("returns nothing for an unknown town", () => {
    expect(neighbouringTowns(towns, "nowhere", "just_mopped")).toEqual([]);
  });
});

describe("nearestSnap", () => {
  it.each([
    [0.1, "peek"],
    [0.42, "peek"],
    [0.45, "half"],
    [0.6, "half"],
    [0.85, "full"],
  ] as const)("%s → %s", (fraction, snap) => {
    expect(nearestSnap(fraction)).toBe(snap);
  });
});
