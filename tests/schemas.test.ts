import { describe, expect, it } from "vitest";

import { PipelineError } from "../scripts/pipeline/errors";
import {
  assertFieldSet,
  DATASET_A_FIELDS,
  DATASET_B_COLUMNS,
  datasetARecordSchema,
  datasetBRowSchema,
  datastoreResponseSchema,
  parseRemainingLease,
  parseWithSchema,
} from "../scripts/pipeline/schemas";

// Verbatim records from data.gov.sg, September 2026.
const datasetARecord = {
  _id: 1,
  blk_no: "1",
  street: "BEACH RD",
  max_floor_lvl: "16",
  year_completed: "1970",
  residential: "Y",
  commercial: "Y",
  market_hawker: "N",
  miscellaneous: "N",
  multistorey_carpark: "N",
  precinct_pavilion: "N",
  bldg_contract_town: "KWN",
  total_dwelling_units: "142",
  "1room_sold": "0",
  "2room_sold": "1",
  "3room_sold": "138",
  "4room_sold": "1",
  "5room_sold": "2",
  exec_sold: "0",
  multigen_sold: "0",
  studio_apartment_sold: "0",
  "1room_rental": "0",
  "2room_rental": "0",
  "3room_rental": "0",
  other_room_rental: "0",
};

const datasetBRow = {
  month: "2017-01",
  town: "ANG MO KIO",
  flat_type: "2 ROOM",
  block: "406",
  street_name: "ANG MO KIO AVE 10",
  storey_range: "10 TO 12",
  floor_area_sqm: "44",
  flat_model: "Improved",
  lease_commence_date: "1979",
  remaining_lease: "61 years 04 months",
  resale_price: "232000",
};

describe("Dataset A record schema", () => {
  it("parses a real record into typed block input", () => {
    const block = datasetARecordSchema.parse(datasetARecord);
    expect(block).toMatchObject({
      blkNo: "1",
      street: "BEACH RD",
      townCode: "KWN",
      yearCompleted: 1970,
      totalDwellingUnits: 142,
      residential: true,
      amenities: { commercial: true, marketHawker: false },
    });
    expect(block.sold["3room"]).toBe(138);
    expect(block.rental.other).toBe(0);
  });

  it("covers exactly the published fields", () => {
    const published = Object.keys(datasetARecord).filter((field) => field !== "_id");
    expect([...DATASET_A_FIELDS].sort()).toEqual(published.sort());
  });

  it("fails when a field disappears", () => {
    const withoutField: Record<string, unknown> = { ...datasetARecord };
    delete withoutField["3room_sold"];
    expect(() => parseWithSchema(datasetARecordSchema, withoutField, "record #1")).toThrow(PipelineError);
  });

  it.each([
    ["4room_sold", "12.5"],
    ["4room_sold", ""],
    ["year_completed", "70"],
    ["residential", "yes"],
  ])("fails when %s is %j", (field, value) => {
    expect(() => datasetARecordSchema.parse({ ...datasetARecord, [field]: value })).toThrow();
  });

  it("fails when a count arrives as a number instead of text (column type changed)", () => {
    expect(() => datasetARecordSchema.parse({ ...datasetARecord, "4room_sold": 1 })).toThrow();
  });
});

describe("Dataset B row schema", () => {
  it("parses a real row and converts remaining lease to months", () => {
    expect(datasetBRowSchema.parse(datasetBRow)).toMatchObject({
      floor_area_sqm: 44,
      lease_commence_date: 1979,
      remaining_lease: 736,
      resale_price: 232000,
    });
  });

  it("covers exactly the published columns", () => {
    expect([...DATASET_B_COLUMNS].sort()).toEqual(Object.keys(datasetBRow).sort());
  });

  it.each([
    ["month", "2017-1"],
    ["storey_range", "10-12"],
    ["resale_price", "$232,000"],
    ["remaining_lease", "61"],
  ])("fails when %s is %j", (field, value) => {
    expect(() => datasetBRowSchema.parse({ ...datasetBRow, [field]: value })).toThrow();
  });
});

describe("parseRemainingLease", () => {
  it.each([
    ["61 years 04 months", 736],
    ["94 years 11 months", 1139],
    ["70 years", 840],
    ["1 year 1 month", 13],
  ])("%s → %i", (value, months) => {
    expect(parseRemainingLease(value)).toBe(months);
  });
});

describe("assertFieldSet", () => {
  it("passes when fields match in any order", () => {
    expect(() => assertFieldSet("Dataset", ["b", "a"], ["a", "b"])).not.toThrow();
  });

  it("names missing and new fields", () => {
    expect(() => assertFieldSet("Dataset", ["a", "c"], ["a", "b"])).toThrow(/Missing fields: b[\s\S]*New fields: c/);
  });
});

describe("datastore response schema", () => {
  it("rejects an error envelope", () => {
    const tooLarge = {
      success: false,
      error: { __type: "Validation Error", records: ["Size of row data too large."] },
    };
    expect(datastoreResponseSchema.safeParse(tooLarge).success).toBe(false);
  });
});
