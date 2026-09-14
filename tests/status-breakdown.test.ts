import { describe, expect, it } from "vitest";

import { describeStatusBreakdown } from "../lib/format";

describe("describeStatusBreakdown", () => {
  it.each([
    [33, 42, "33 with resales on record · 9 estimated"],
    [0, 53, "All estimated from completion year · no resales yet"],
    [12, 12, "All with resales on record"],
    [1200, 1450, "1,200 with resales on record · 250 estimated"],
  ])("%i of %i → %s", (withResales, total, text) => {
    expect(describeStatusBreakdown(withResales, total)).toBe(text);
  });

  it("returns nothing when there are no results", () => {
    expect(describeStatusBreakdown(0, 0)).toBeNull();
  });
});
