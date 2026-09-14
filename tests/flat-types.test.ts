import { describe, expect, it } from "vitest";

import { flatTypeMask, maskHasFlatType, resaleFlatTypeByLabel } from "../lib/flat-types";

describe("flat type mask", () => {
  it("sets one bit per flat type with sold units", () => {
    const mask = flatTypeMask({ "4room": 60, executive: 10, "3room": 0 });
    expect(mask).toBe(0b101000);
    expect(maskHasFlatType(mask, "4room")).toBe(true);
    expect(maskHasFlatType(mask, "executive")).toBe(true);
    expect(maskHasFlatType(mask, "3room")).toBe(false);
    expect(maskHasFlatType(mask, "studio")).toBe(false);
  });

  it("is zero for an empty mix", () => {
    expect(flatTypeMask({})).toBe(0);
  });
});

describe("resaleFlatTypeByLabel", () => {
  it("maps resale labels and rejects unknown ones", () => {
    expect(resaleFlatTypeByLabel("MULTI-GENERATION")).toBe("multigen");
    expect(resaleFlatTypeByLabel("STUDIO")).toBeUndefined();
  });
});
