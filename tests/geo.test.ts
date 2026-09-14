import { describe, expect, it } from "vitest";

import { haversineKm, isInSingapore, medianPoint } from "../lib/geo";

describe("haversineKm", () => {
  it("measures one degree of latitude as ~111.195 km", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.195, 2);
  });

  it("is zero for the same point and symmetric", () => {
    const a = { lat: 1.3521, lng: 103.8198 };
    const b = { lat: 1.4382, lng: 103.7891 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });

  it("shrinks east-west distances away from the equator", () => {
    const atEquator = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const at60North = haversineKm({ lat: 60, lng: 0 }, { lat: 60, lng: 1 });
    expect(at60North).toBeCloseTo(atEquator / 2, 0);
  });
});

describe("isInSingapore", () => {
  it.each([
    [{ lat: 1.3521, lng: 103.8198 }, true],
    [{ lat: 1.15, lng: 103.6 }, true],
    [{ lat: 1.48, lng: 104.1 }, true],
    [{ lat: 1.149, lng: 103.8 }, false],
    [{ lat: 1.3, lng: 104.2 }, false],
    [{ lat: 1.5, lng: 103.76 }, false],
  ])("%o → %s", (point, expected) => {
    expect(isInSingapore(point)).toBe(expected);
  });
});

describe("medianPoint", () => {
  it("takes the component-wise median and ignores a stray point", () => {
    const points = [
      { lat: 1.3, lng: 103.8 },
      { lat: 1.31, lng: 103.81 },
      { lat: 1.32, lng: 103.82 },
      { lat: 1.45, lng: 103.99 },
      { lat: 1.305, lng: 103.805 },
    ];
    expect(medianPoint(points)).toEqual({ lat: 1.31, lng: 103.81 });
  });

  it("averages the middle pair for an even count", () => {
    const result = medianPoint([
      { lat: 1, lng: 10 },
      { lat: 2, lng: 20 },
    ]);
    expect(result.lat).toBeCloseTo(1.5);
    expect(result.lng).toBeCloseTo(15);
  });

  it("throws on an empty list", () => {
    expect(() => medianPoint([])).toThrow();
  });
});
