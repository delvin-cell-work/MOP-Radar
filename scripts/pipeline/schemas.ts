import { z } from "zod";

import type { BlockInput } from "../../lib/mop";
import { PipelineError } from "./errors";

/**
 * Zod schemas for every payload that crosses the data.gov.sg boundary. The
 * datasets are matched by ID *and* name, so a re-pointed ID fails loudly.
 */

export interface DatasetDefinition {
  id: string;
  name: string;
}

export const DATASET_A: DatasetDefinition = {
  id: "d_17f5382f26140b1fdae0ba2ef6239d2f",
  name: "HDB Property Information",
};

export const DATASET_B: DatasetDefinition = {
  id: "d_8b84c4ee58e3cfc0ece0d773c8ca6abc",
  name: "Resale flat prices based on registration date from Jan-2017 onwards",
};

export function describeDataset(dataset: DatasetDefinition): string {
  return `${dataset.name} (${dataset.id})`;
}

const text = z.string().trim().min(1);
const wholeNumber = z.string().regex(/^\d+$/, "expected a whole number as text").transform(Number);
const decimalNumber = z.string().regex(/^\d+(\.\d+)?$/, "expected a number as text").transform(Number);
const year = z.string().regex(/^\d{4}$/, "expected a 4-digit year").transform(Number);
const flag = z.enum(["Y", "N"]).transform((value) => value === "Y");

const datasetAShape = {
  blk_no: text,
  street: text,
  max_floor_lvl: wholeNumber,
  year_completed: year,
  residential: flag,
  commercial: flag,
  market_hawker: flag,
  miscellaneous: flag,
  multistorey_carpark: flag,
  precinct_pavilion: flag,
  bldg_contract_town: text,
  total_dwelling_units: wholeNumber,
  "1room_sold": wholeNumber,
  "2room_sold": wholeNumber,
  "3room_sold": wholeNumber,
  "4room_sold": wholeNumber,
  "5room_sold": wholeNumber,
  exec_sold: wholeNumber,
  multigen_sold: wholeNumber,
  studio_apartment_sold: wholeNumber,
  "1room_rental": wholeNumber,
  "2room_rental": wholeNumber,
  "3room_rental": wholeNumber,
  other_room_rental: wholeNumber,
};

export const DATASET_A_FIELDS: readonly string[] = Object.keys(datasetAShape);

export const datasetARecordSchema = z.object(datasetAShape).transform(
  (record): BlockInput => ({
    blkNo: record.blk_no,
    street: record.street,
    townCode: record.bldg_contract_town,
    yearCompleted: record.year_completed,
    maxFloorLvl: record.max_floor_lvl,
    totalDwellingUnits: record.total_dwelling_units,
    residential: record.residential,
    sold: {
      "1room": record["1room_sold"],
      "2room": record["2room_sold"],
      "3room": record["3room_sold"],
      "4room": record["4room_sold"],
      "5room": record["5room_sold"],
      executive: record.exec_sold,
      multigen: record.multigen_sold,
      studio: record.studio_apartment_sold,
    },
    rental: {
      oneRoom: record["1room_rental"],
      twoRoom: record["2room_rental"],
      threeRoom: record["3room_rental"],
      other: record.other_room_rental,
    },
    amenities: {
      commercial: record.commercial,
      marketHawker: record.market_hawker,
      miscellaneous: record.miscellaneous,
      multistoreyCarpark: record.multistorey_carpark,
      precinctPavilion: record.precinct_pavilion,
    },
  }),
);

const REMAINING_LEASE_RE = /^(\d{1,2}) years?(?: (\d{1,2}) months?)?$/;

/** "61 years 04 months" → 736. */
export function parseRemainingLease(value: string): number {
  const match = REMAINING_LEASE_RE.exec(value.trim());
  if (!match) throw new Error(`Unrecognised remaining_lease "${value}"`);
  return Number(match[1]) * 12 + Number(match[2] ?? 0);
}

const datasetBShape = {
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM"),
  town: text,
  flat_type: text,
  block: text,
  street_name: text,
  storey_range: z.string().regex(/^\d{2} TO \d{2}$/, "expected 'NN TO NN'"),
  floor_area_sqm: decimalNumber,
  flat_model: text,
  lease_commence_date: year,
  remaining_lease: z
    .string()
    .regex(REMAINING_LEASE_RE, "expected 'N years M months'")
    .transform(parseRemainingLease),
  resale_price: decimalNumber,
};

export const DATASET_B_COLUMNS: readonly string[] = Object.keys(datasetBShape);

export const datasetBRowSchema = z.object(datasetBShape);

export const DATASET_C: DatasetDefinition = {
  id: "d_16b157c52ed637edd6ba1232e026258d",
  name: "HDB Existing Building",
};

/** Every property on a building feature as of Sep 2026. Only BLK_NO and ST_COD are used. */
export const DATASET_C_PROPERTIES: readonly string[] = [
  "OBJECTID",
  "BLK_NO",
  "ST_COD",
  "ENTITYID",
  "POSTAL_COD",
  "INC_CRC",
  "FMEL_UPD_D",
  "SHAPE.AREA",
  "SHAPE.LEN",
];

const position = z.array(z.number()).min(2);
const linearRing = z.array(position).min(3);

export const buildingGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: z.array(linearRing).min(1) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(linearRing).min(1)).min(1) }),
]);

export type BuildingGeometry = z.output<typeof buildingGeometrySchema>;

export const buildingFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: buildingGeometrySchema,
  properties: z.object({
    BLK_NO: text,
    ST_COD: z.string().regex(/^[A-Z]{3}\d{2}[A-Z]$/, "expected a street code like TOP02W"),
  }),
});

export const buildingCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()).min(1),
});

export const datastoreResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    resource_id: z.string(),
    fields: z.array(z.object({ id: z.string(), type: z.string() })),
    records: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
  }),
});

export const metadataResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    datasetId: z.string(),
    name: z.string(),
    lastUpdatedAt: z.string(),
    coverageEnd: z.string().optional(),
  }),
});

export const pollDownloadResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    status: z.string().optional(),
    url: z.url().optional(),
  }),
});

export function parseWithSchema<T extends z.ZodType>(schema: T, value: unknown, context: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new PipelineError(
      `${context} failed validation. The source schema may have changed.\n` +
        `${z.prettifyError(result.error)}\n` +
        `Value: ${JSON.stringify(value)?.slice(0, 500)}`,
    );
  }
  return result.data;
}

export function assertFieldSet(context: string, actual: readonly string[], expected: readonly string[]): void {
  const missing = expected.filter((field) => !actual.includes(field));
  const added = actual.filter((field) => !expected.includes(field));
  if (missing.length === 0 && added.length === 0) return;
  throw new PipelineError(
    [
      `${context}: schema has changed.`,
      missing.length > 0 ? `  Missing fields: ${missing.join(", ")}` : null,
      added.length > 0 ? `  New fields: ${added.join(", ")}` : null,
      "  Review the dataset on data.gov.sg, then update scripts/pipeline/schemas.ts and lib/mop.ts.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
