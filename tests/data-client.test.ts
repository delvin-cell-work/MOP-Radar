import { describe, expect, it } from "vitest";

import { DATA_SCHEMA_VERSION, MAP_POINT_COLUMNS, type MapPointsFile } from "../lib/data-contract";
import { decodeMapPoints } from "../lib/data-client";
import { flatTypeMask } from "../lib/flat-types";

describe("decodeMapPoints", () => {
  it("turns compact tuples into named blocks carrying the file's cohort", () => {
    const file: MapPointsFile = {
      schema_version: DATA_SCHEMA_VERSION,
      cohort: "just_mopped",
      current_month: "2026-09",
      columns: MAP_POINT_COLUMNS,
      points: [
        ["110b-bidadari-pk-dr", "TP", 1.33912, 103.87012, "confirmed", 2, 2021, flatTypeMask({ "4room": 92, "5room": 40 }), 0, "active", "block"],
        ["108a-bidadari-pk-dr", "TP", 1.3386, 103.8699, "estimated", 2, 2021, flatTypeMask({ "4room": 156 }), 1, "none", "street"],
      ],
    };

    expect(decodeMapPoints(file)).toEqual([
      {
        id: "110b-bidadari-pk-dr",
        townCode: "TP",
        lat: 1.33912,
        lng: 103.87012,
        cohort: "just_mopped",
        status: "confirmed",
        monthsSinceMop: 2,
        yearCompleted: 2021,
        flatTypeMask: 0b11000,
        hasRentalUnits: false,
        activity: "active",
        precision: "block",
      },
      {
        id: "108a-bidadari-pk-dr",
        townCode: "TP",
        lat: 1.3386,
        lng: 103.8699,
        cohort: "just_mopped",
        status: "estimated",
        monthsSinceMop: 2,
        yearCompleted: 2021,
        flatTypeMask: 0b1000,
        hasRentalUnits: true,
        activity: "none",
        precision: "street",
      },
    ]);
  });
});
