import { describe, expect, it } from "vitest";

import { blockKey } from "../lib/mop";
import {
  buildStreets,
  locateBlocks,
  matchStreetCodes,
  polygonCentroid,
  streetInitials,
  type Building,
  type Street,
} from "../scripts/pipeline/geo-match";
import { buildingFeatureSchema } from "../scripts/pipeline/schemas";

function street(name: string, townCode: string, blocks: string[]): Street {
  return { name, townCode, blocks: new Set(blocks) };
}

function buildingsFor(streetCode: string, blocks: string[], lat: number, lng: number): Building[] {
  return blocks.map((blkNo, index) => ({ blkNo, streetCode, lat: lat + index * 0.0005, lng: lng + index * 0.0005 }));
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

const JURONG_EAST = { lat: 1.333, lng: 103.742 };
const PASIR_RIS = { lat: 1.373, lng: 103.949 };
const BEDOK = { lat: 1.324, lng: 103.93 };

describe("streetInitials", () => {
  it.each([
    ["JLN BT MERAH", ["B", "J", "M"]],
    ["LOR 1 TOA PAYOH", ["L", "P", "T"]],
    ["C'WEALTH CRES", ["C"]],
    ["BT BATOK WEST AVE 6", ["A", "B", "W"]],
  ])("%s → %j", (name, initials) => {
    expect([...streetInitials(name)].sort()).toEqual(initials);
  });
});

describe("matchStreetCodes", () => {
  it("tells apart streets with identical block numbers by the code's initial", () => {
    const streets = [street("JURONG EAST ST 13", "JE", range(101, 116)), street("LENGKONG TIGA", "BD", range(101, 116))];
    const buildings = [
      ...buildingsFor("JUS03N", range(101, 116), JURONG_EAST.lat, JURONG_EAST.lng),
      ...buildingsFor("LET03Z", range(101, 116), BEDOK.lat, BEDOK.lng),
    ];
    const { streetByCode, rejected } = matchStreetCodes(buildings, streets);
    expect(streetByCode.get("JUS03N")).toBe("JURONG EAST ST 13");
    expect(streetByCode.get("LET03Z")).toBe("LENGKONG TIGA");
    expect(rejected).toEqual([]);
  });

  it("matches a code built from a word after JALAN", () => {
    const { streetByCode } = matchStreetCodes(
      buildingsFor("BUM03D", range(1, 10), 1.284, 103.824),
      [street("JLN BT MERAH", "BM", range(1, 10))],
    );
    expect(streetByCode.get("BUM03D")).toBe("JLN BT MERAH");
  });

  it("matches a code that covers only part of a long street", () => {
    const { streetByCode } = matchStreetCodes(
      buildingsFor("TAS41A", range(401, 410), 1.355, 103.95),
      [street("TAMPINES ST 41", "TAP", range(401, 440))],
    );
    expect(streetByCode.get("TAS41A")).toBe("TAMPINES ST 41");
  });

  it("rejects a tie between equally good streets", () => {
    const { streetByCode, rejected } = matchStreetCodes(
      buildingsFor("QUE01M", range(1, 4), 1.32, 103.81),
      [street("QUEEN'S RD", "BT", range(1, 4)), street("QUEEN ST", "CT", range(1, 4))],
    );
    expect(streetByCode.size).toBe(0);
    expect(rejected).toEqual([{ code: "QUE01M", reason: "tie", closest: expect.any(String), buildings: 4 }]);
  });

  it("rejects a code whose blocks don't fit one street", () => {
    const { rejected } = matchStreetCodes(
      buildingsFor("CHS11A", range(51, 55), 1.284, 103.84),
      [street("CHIN SWEE RD", "CT", ["51", "52"])],
    );
    expect(rejected).toEqual([{ code: "CHS11A", reason: "low_containment", closest: "CHIN SWEE RD", buildings: 5 }]);
  });

  it("rejects a code with no street sharing its blocks and initial", () => {
    const { rejected } = matchStreetCodes(
      buildingsFor("ZZZ00A", ["999"], 1.3, 103.8),
      [street("ANG MO KIO AVE 3", "AMK", ["999"])],
    );
    expect(rejected).toEqual([{ code: "ZZZ00A", reason: "no_candidate", closest: null, buildings: 1 }]);
  });

  it("rejects a match whose buildings sit in another part of Singapore", () => {
    const streets = [street("JURONG EAST ST 13", "JE", range(101, 160)), street("TEBAN GDNS RD", "JE", ["20", "22", "24"])];
    const buildings = [
      ...buildingsFor("JUS03N", range(101, 160), JURONG_EAST.lat, JURONG_EAST.lng),
      ...buildingsFor("TEG99X", ["20", "22", "24"], PASIR_RIS.lat, PASIR_RIS.lng),
    ];
    const { streetByCode, rejected } = matchStreetCodes(buildings, streets);
    expect(streetByCode.get("JUS03N")).toBe("JURONG EAST ST 13");
    expect(streetByCode.has("TEG99X")).toBe(false);
    expect(rejected).toEqual([{ code: "TEG99X", reason: "outside_town", closest: "TEBAN GDNS RD", buildings: 3 }]);
  });
});

describe("locateBlocks", () => {
  const streetByCode = new Map([["BUM03D", "JLN BT MERAH"]]);
  const buildings: Building[] = [
    { blkNo: "1", streetCode: "BUM03D", lat: 1.28, lng: 103.82 },
    { blkNo: "2", streetCode: "BUM03D", lat: 1.29, lng: 103.83 },
    { blkNo: "1", streetCode: "BUM03D", lat: 1.4, lng: 103.9 },
    { blkNo: "7", streetCode: "UNMATCHED", lat: 1.35, lng: 103.85 },
  ];
  const blocks = [
    { blkNo: "1", street: "JLN BT MERAH" },
    { blkNo: "2", street: "jln bt  merah" },
    { blkNo: "3", street: "JLN BT MERAH" },
    { blkNo: "7", street: "NOWHERE RD" },
  ];
  const { locations, duplicateFootprints } = locateBlocks(blocks, buildings, streetByCode);

  it("uses the block's own footprint, keeping the first of duplicates", () => {
    expect(locations.get(blockKey("1", "JLN BT MERAH"))).toEqual({ lat: 1.28, lng: 103.82, precision: "block" });
    expect(locations.get(blockKey("2", "JLN BT MERAH"))?.precision).toBe("block");
    expect(duplicateFootprints).toBe(1);
  });

  it("falls back to the median of located blocks on the same street", () => {
    const fallback = locations.get(blockKey("3", "JLN BT MERAH"));
    expect(fallback?.precision).toBe("street");
    expect(fallback?.lat).toBeCloseTo(1.285);
    expect(fallback?.lng).toBeCloseTo(103.825);
  });

  it("leaves a block unlocated when neither it nor its street has a footprint", () => {
    expect(locations.has(blockKey("7", "NOWHERE RD"))).toBe(false);
  });
});

describe("buildStreets", () => {
  it("groups blocks by normalised street and picks the most common town", () => {
    const streets = buildStreets([
      { blkNo: "1", street: "JLN BT MERAH", townCode: "BM" },
      { blkNo: "2", street: "jln bt  merah", townCode: "BM" },
      { blkNo: "3", street: "JLN BT MERAH", townCode: "CT" },
    ]);
    expect(streets).toHaveLength(1);
    expect(streets[0].name).toBe("JLN BT MERAH");
    expect(streets[0].townCode).toBe("BM");
    expect([...streets[0].blocks].sort()).toEqual(["1", "2", "3"]);
  });
});

describe("polygonCentroid", () => {
  const square = [
    [103.8, 1.3],
    [103.802, 1.3],
    [103.802, 1.302],
    [103.8, 1.302],
    [103.8, 1.3],
  ];

  it("averages the vertices of a closed ring without double-counting the closing point", () => {
    const centre = polygonCentroid({ type: "Polygon", coordinates: [square] });
    expect(centre.lat).toBeCloseTo(1.301, 6);
    expect(centre.lng).toBeCloseTo(103.801, 6);
  });

  it("uses the largest polygon of a MultiPolygon", () => {
    const triangle = [
      [103.9, 1.4],
      [103.901, 1.4],
      [103.9, 1.401],
      [103.9, 1.4],
    ];
    const centre = polygonCentroid({ type: "MultiPolygon", coordinates: [[triangle], [square]] });
    expect(centre.lat).toBeCloseTo(1.301, 6);
  });
});

describe("building feature schema", () => {
  const feature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [103.7466894767018, 1.3413951314392092],
          [103.74669556639537, 1.341390574568694],
          [103.74668096640988, 1.3413707549232672],
          [103.7466894767018, 1.3413951314392092],
        ],
      ],
    },
    properties: { OBJECTID: 948044, BLK_NO: "277", ST_COD: "TOG02Q", POSTAL_COD: "600277" },
  };

  it("accepts a real feature", () => {
    expect(buildingFeatureSchema.parse(feature).properties).toEqual({ BLK_NO: "277", ST_COD: "TOG02Q" });
  });

  it("rejects a malformed street code", () => {
    expect(() =>
      buildingFeatureSchema.parse({ ...feature, properties: { ...feature.properties, ST_COD: "Toa Payoh" } }),
    ).toThrow();
  });

  it("rejects an unsupported geometry type", () => {
    expect(() =>
      buildingFeatureSchema.parse({ ...feature, geometry: { type: "Point", coordinates: [103.8, 1.3] } }),
    ).toThrow();
  });
});
