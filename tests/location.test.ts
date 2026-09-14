import { describe, expect, it } from "vitest";

import { haversineKm, isInSingapore } from "../lib/geo";
import {
  failureFromPositionError,
  GEOLOCATION_OPTIONS,
  locationSupportFailure,
  nearestTown,
} from "../lib/location";
import { TOWNS } from "../lib/towns";

const nearestSlug = (lat: number, lng: number) => nearestTown({ lat, lng }, TOWNS)?.slug ?? null;

describe("nearestTown with the shipped town centres", () => {
  it.each([
    ["Tampines Hub", 1.3533, 103.9406, "tampines"],
    ["Ang Mo Kio Hub", 1.3691, 103.848, "ang-mo-kio"],
    ["Waterway Point, Punggol", 1.4065, 103.902, "punggol"],
    ["Jurong East MRT", 1.3331, 103.7422, "jurong-east"],
    ["Woodlands Civic Centre", 1.436, 103.7865, "woodlands"],
    ["Toa Payoh Hub", 1.3326, 103.8474, "toa-payoh"],
    ["Tengah, west of Bukit Batok", 1.36, 103.73, "tengah"],
    ["Sentosa, nearest HDB town Bukit Merah", 1.2494, 103.8303, "bukit-merah"],
    ["Changi Village, nearest HDB town Pasir Ris", 1.389, 103.988, "pasir-ris"],
  ])("%s", (label, lat, lng, slug) => {
    expect(nearestSlug(lat, lng), label).toBe(slug);
  });

  it.each([
    ["Kuala Lumpur", 3.139, 101.6869],
    ["Johor Bahru, north of the bounding box", 1.4927, 103.7414],
    ["Batam, south of the bounding box", 1.13, 104.03],
    ["east of the bounding box", 1.3, 104.2],
    ["west of the bounding box", 1.3, 103.59],
  ])("returns null outside Singapore: %s", (label, lat, lng) => {
    expect(nearestSlug(lat, lng), label).toBeNull();
  });

  it("accepts points on the bounding box edge", () => {
    expect(nearestSlug(1.48, 103.8)).not.toBeNull();
    expect(nearestSlug(1.15, 104.1)).not.toBeNull();
  });

  it("returns null for coordinates that aren't numbers", () => {
    expect(nearestSlug(Number.NaN, 103.8)).toBeNull();
    expect(nearestSlug(1.35, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("nearestTown", () => {
  const towns = [
    { slug: "west", center: { lat: 1.3, lng: 103.8 } },
    { slug: "east", center: { lat: 1.3, lng: 103.9 } },
  ];

  it("picks the closer centre by great-circle distance", () => {
    expect(nearestTown({ lat: 1.31, lng: 103.89 }, towns)?.slug).toBe("east");
  });

  it("keeps the first town in the table on an exact tie", () => {
    expect(nearestTown({ lat: 1.3, lng: 103.85 }, towns)?.slug).toBe("west");
  });

  it("returns null for an empty table", () => {
    expect(nearestTown({ lat: 1.3, lng: 103.85 }, [])).toBeNull();
  });
});

describe("shipped town centres", () => {
  it("are all inside Singapore and at least 1 km apart", () => {
    for (const town of TOWNS) expect(isInSingapore(town.center), town.name).toBe(true);
    for (let i = 0; i < TOWNS.length; i++) {
      for (let j = i + 1; j < TOWNS.length; j++) {
        expect(haversineKm(TOWNS[i].center, TOWNS[j].center), `${TOWNS[i].name}–${TOWNS[j].name}`).toBeGreaterThan(1);
      }
    }
  });

  it("each resolve to their own town", () => {
    for (const town of TOWNS) expect(nearestTown(town.center, TOWNS)?.slug).toBe(town.slug);
  });
});

describe("failureFromPositionError", () => {
  it.each([
    [1, "denied"],
    [2, "unavailable"],
    [3, "timeout"],
    [99, "unavailable"],
  ] as const)("code %i → %s", (code, failure) => {
    expect(failureFromPositionError(code)).toBe(failure);
  });
});

describe("locationSupportFailure", () => {
  it("sends non-HTTPS pages straight to the picker, even when geolocation exists", () => {
    expect(locationSupportFailure({ isSecureContext: false, hasGeolocation: true })).toBe("insecure");
    expect(locationSupportFailure({ isSecureContext: false, hasGeolocation: false })).toBe("insecure");
  });

  it("reports missing geolocation on a secure page", () => {
    expect(locationSupportFailure({ isSecureContext: true, hasGeolocation: false })).toBe("unsupported");
  });

  it("allows geolocation on a secure page that supports it", () => {
    expect(locationSupportFailure({ isSecureContext: true, hasGeolocation: true })).toBeNull();
  });
});

describe("GEOLOCATION_OPTIONS", () => {
  it("matches the product brief", () => {
    expect(GEOLOCATION_OPTIONS).toEqual({ enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 });
  });
});
