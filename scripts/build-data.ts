/**
 * MOP Radar data pipeline: fetches three HDB datasets from data.gov.sg, derives
 * MOP status and a map location per block, writes static JSON to public/data/
 * and prints a summary.
 *
 *   npm run data
 *
 * Exits non-zero, leaving the previous public/data in place, if a dataset ID,
 * name or schema has changed, a join degrades, or resale data is stale.
 */
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  COHORTS,
  DATA_SCHEMA_VERSION,
  MAP_POINT_COLUMNS,
  TRANSACTION_COLUMNS,
  type BlockLocation,
  type Cohort,
  type DataMeta,
  type DerivedBlock,
  type MapPoint,
  type MapPointsFile,
  type MopStatus,
  type TownBlocksFile,
  type TownTransactionsFile,
  type TransactionRow,
} from "../lib/data-contract";
import { flatTypeMask, resaleFlatTypeByLabel } from "../lib/flat-types";
import { haversineKm, isInSingapore, medianPoint, type LatLng } from "../lib/geo";
import { formatMonth, parseMonth, singaporeMonth, type MonthIndex } from "../lib/months";
import {
  blockKey,
  deriveBlock,
  estimatedMopMonth,
  exclusionReason,
  FIRST_RESALE_MAX_LAG_MONTHS,
  normaliseName,
  type BlockInput,
  type DerivationContext,
  type ExclusionReason,
  type TransactionInput,
} from "../lib/mop";
import { TOWNS, townByCode, townByResaleName } from "../lib/towns";
import { parseCsv } from "./pipeline/csv";
import {
  fetchDatasetDownload,
  fetchDatasetMetadata,
  fetchDatastore,
  fetchDatastorePage,
  type DatasetMetadata,
} from "./pipeline/data-gov-sg";
import { PipelineError } from "./pipeline/errors";
import {
  buildStreets,
  locateBlocks,
  matchStreetCodes,
  polygonCentroid,
  type Building,
  type LocatedBlock,
  type RejectionReason,
  type StreetCodeMatch,
} from "./pipeline/geo-match";
import {
  assertFieldSet,
  buildingCollectionSchema,
  buildingFeatureSchema,
  DATASET_A,
  DATASET_A_FIELDS,
  DATASET_B,
  DATASET_B_COLUMNS,
  DATASET_C,
  DATASET_C_PROPERTIES,
  datasetARecordSchema,
  datasetBRowSchema,
  describeDataset,
  parseWithSchema,
} from "./pipeline/schemas";

const OUTPUT_DIR = path.join(process.cwd(), "public", "data");
/** Share of resale blocks allowed to have no Property Information match (1 of 9,745 in Sep 2026). */
const MAX_UNMATCHED_BLOCK_RATE = 0.01;
/** Share of matched blocks whose resale town disagrees with Property Information (0 in Sep 2026). */
const MAX_TOWN_MISMATCH_RATE = 0.005;
/** Allowed gap between the CSV download's row count and the datastore's total. */
const MAX_ROW_COUNT_DRIFT = 0.001;
const MAX_RESALE_STALENESS_MONTHS = 3;
/** Share of eligible blocks that must be placed at their own footprint (99.7% in Sep 2026). */
const MIN_BLOCK_LOCATION_COVERAGE = 0.98;
/** 5 decimal places of a degree is about 1.1 m. */
const COORDINATE_DECIMALS = 5;
/** How far a computed town centre may move from lib/towns.ts before that table must be updated. */
const MAX_TOWN_CENTRE_DRIFT_KM = 1;
/** First resale this far BEFORE the estimate suggests year_completed is wrong. Reported only. */
const EARLY_RESALE_LEAD_MONTHS = 12;

const COHORT_LABELS: Record<Cohort, string> = {
  upcoming: "upcoming (next 24 mo)",
  just_mopped: "just_mopped (last 24 mo)",
  mature: "mature (24+ mo ago)",
  later: "later (24+ mo away)",
};

const REJECTION_LABELS: Record<RejectionReason, string> = {
  no_candidate: "no street shares its block numbers and initial",
  tie: "two streets fit equally well",
  low_containment: "its block numbers don't fit one street",
  outside_town: "best street is in another part of Singapore",
};

interface ResaleTransaction extends TransactionInput {
  key: string;
  block: string;
  street: string;
  townCode: string;
  storeyRange: string;
  floorAreaSqm: number;
  remainingLeaseMonths: number;
}

interface PropertyData {
  metadata: DatasetMetadata;
  blocks: BlockInput[];
}

interface ResaleData {
  metadata: DatasetMetadata;
  transactions: ResaleTransaction[];
  latestMonth: MonthIndex;
}

interface BuildingData {
  metadata: DatasetMetadata;
  buildings: Building[];
}

interface JoinResult {
  transactionsByKey: Map<string, ResaleTransaction[]>;
  unmatched: { block: string; street: string; transactions: number }[];
  townMismatches: string[];
}

interface WrittenFile {
  file: string;
  bytes: number;
}

const n = (value: number) => value.toLocaleString("en-SG");
const pct = (part: number, whole: number) => `${whole === 0 ? "0.0" : ((part / whole) * 100).toFixed(1)}%`;
const money = (value: number) => `$${n(value)}`;
const roundCoordinate = (value: number) => Number(value.toFixed(COORDINATE_DECIMALS));
const roundPoint = (point: LatLng): LatLng => ({ lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) });

async function loadProperty(): Promise<PropertyData> {
  const label = describeDataset(DATASET_A);
  console.log(`\n→ ${label}`);
  const metadata = await fetchDatasetMetadata(DATASET_A);
  const { fields, records } = await fetchDatastore(DATASET_A);
  assertFieldSet(label, fields.filter((field) => field !== "_id"), DATASET_A_FIELDS);

  const blocks = records.map((record, index) =>
    parseWithSchema(datasetARecordSchema, record, `${label} record #${index + 1}`),
  );

  const unknownTowns = [...new Set(blocks.filter((b) => !townByCode(b.townCode)).map((b) => b.townCode))];
  if (unknownTowns.length > 0) {
    throw new PipelineError(
      `${label}: unknown bldg_contract_town code(s): ${unknownTowns.join(", ")}. Add them to lib/towns.ts.`,
    );
  }

  const keys = new Set<string>();
  for (const block of blocks) {
    const key = blockKey(block.blkNo, block.street);
    if (keys.has(key)) {
      throw new PipelineError(
        `${label}: duplicate block ${block.blkNo} ${block.street}. ` +
          "Resales are joined on block + street, so duplicates would mix transactions.",
      );
    }
    keys.add(key);
  }

  return { metadata, blocks };
}

async function loadResales(currentMonth: MonthIndex): Promise<ResaleData> {
  const label = describeDataset(DATASET_B);
  console.log(`\n→ ${label}`);
  const metadata = await fetchDatasetMetadata(DATASET_B);
  const summary = await fetchDatastorePage(DATASET_B, 1, 0);
  assertFieldSet(label, summary.fields.filter((field) => field !== "_id"), DATASET_B_COLUMNS);

  const [header, ...rows] = parseCsv(await fetchDatasetDownload(DATASET_B));
  if (!header) throw new PipelineError(`${label}: CSV download was empty`);
  assertFieldSet(`${label} CSV header`, header, DATASET_B_COLUMNS);

  const drift = Math.abs(rows.length - summary.total) / Math.max(summary.total, 1);
  if (drift > MAX_ROW_COUNT_DRIFT) {
    throw new PipelineError(
      `${label}: CSV has ${n(rows.length)} rows but the datastore reports ${n(summary.total)}. ` +
        "The download may be truncated or out of date.",
    );
  }

  const unknownFlatTypes = new Set<string>();
  const unknownTowns = new Set<string>();
  const transactions: ResaleTransaction[] = [];

  for (let index = 0; index < rows.length; index++) {
    const cells = rows[index];
    const context = `${label} CSV line ${index + 2}`;
    if (cells.length !== header.length) {
      throw new PipelineError(`${context}: expected ${header.length} columns, found ${cells.length}`);
    }
    const record: Record<string, string> = {};
    header.forEach((column, i) => {
      record[column] = cells[i];
    });

    const row = parseWithSchema(datasetBRowSchema, record, context);
    const flatType = resaleFlatTypeByLabel(row.flat_type);
    const town = townByResaleName(row.town);
    if (!flatType) unknownFlatTypes.add(row.flat_type);
    if (!town) unknownTowns.add(row.town);
    if (!flatType || !town) continue;

    transactions.push({
      key: blockKey(row.block, row.street_name),
      block: row.block,
      street: row.street_name,
      townCode: town.code,
      month: parseMonth(row.month),
      flatType,
      storeyRange: row.storey_range,
      floorAreaSqm: row.floor_area_sqm,
      remainingLeaseMonths: row.remaining_lease,
      resalePrice: row.resale_price,
    });
  }

  if (unknownFlatTypes.size > 0) {
    throw new PipelineError(
      `${label}: unknown flat_type value(s): ${[...unknownFlatTypes].join(", ")}. Map them in lib/flat-types.ts.`,
    );
  }
  if (unknownTowns.size > 0) {
    throw new PipelineError(
      `${label}: unknown town value(s): ${[...unknownTowns].join(", ")}. Map them in lib/towns.ts.`,
    );
  }
  if (transactions.length === 0) throw new PipelineError(`${label}: no transactions found`);

  const latestMonth = transactions.reduce((max, tx) => Math.max(max, tx.month), transactions[0].month);
  if (latestMonth > currentMonth) {
    throw new PipelineError(
      `${label}: latest resale month ${formatMonth(latestMonth)} is after the current month ` +
        `${formatMonth(currentMonth)}. Check the system clock.`,
    );
  }
  if (currentMonth - latestMonth > MAX_RESALE_STALENESS_MONTHS) {
    throw new PipelineError(
      `${label}: latest resale month is ${formatMonth(latestMonth)}, more than ` +
        `${MAX_RESALE_STALENESS_MONTHS} months ago. Refusing to publish stale data.`,
    );
  }

  return { metadata, transactions, latestMonth };
}

async function loadBuildings(): Promise<BuildingData> {
  const label = describeDataset(DATASET_C);
  console.log(`\n→ ${label}`);
  const metadata = await fetchDatasetMetadata(DATASET_C);
  const body = await fetchDatasetDownload(DATASET_C);

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new PipelineError(`${label}: download is not valid GeoJSON (${n(body.length)} characters)`);
  }
  const collection = parseWithSchema(buildingCollectionSchema, json, label);
  const firstFeature = collection.features[0] as { properties?: Record<string, unknown> };
  assertFieldSet(`${label} feature properties`, Object.keys(firstFeature.properties ?? {}), DATASET_C_PROPERTIES);

  const buildings: Building[] = [];
  const outsideSingapore: string[] = [];
  collection.features.forEach((raw, index) => {
    const feature = parseWithSchema(buildingFeatureSchema, raw, `${label} feature #${index + 1}`);
    const centre = polygonCentroid(feature.geometry);
    const { BLK_NO, ST_COD } = feature.properties;
    if (!isInSingapore(centre)) {
      outsideSingapore.push(`${BLK_NO} ${ST_COD}`);
      return;
    }
    buildings.push({ blkNo: normaliseName(BLK_NO), streetCode: ST_COD, lat: centre.lat, lng: centre.lng });
  });

  if (outsideSingapore.length > 0) {
    throw new PipelineError(
      `${label}: ${n(outsideSingapore.length)} building(s) fall outside Singapore ` +
        `(e.g. ${outsideSingapore.slice(0, 5).join("; ")}). Coordinates may no longer be WGS84 lng/lat.`,
    );
  }
  return { metadata, buildings };
}

function joinResales(blocks: BlockInput[], transactions: ResaleTransaction[]): JoinResult {
  const blocksByKey = new Map(blocks.map((block) => [blockKey(block.blkNo, block.street), block]));
  const transactionsByKey = new Map<string, ResaleTransaction[]>();
  for (const tx of transactions) {
    const list = transactionsByKey.get(tx.key);
    if (list) list.push(tx);
    else transactionsByKey.set(tx.key, [tx]);
  }

  const unmatched: JoinResult["unmatched"] = [];
  const townMismatches: string[] = [];
  for (const [key, list] of transactionsByKey) {
    const block = blocksByKey.get(key);
    if (!block) {
      unmatched.push({ block: list[0].block, street: list[0].street, transactions: list.length });
    } else if (list.some((tx) => tx.townCode !== block.townCode)) {
      townMismatches.push(`${block.blkNo} ${block.street}`);
    }
  }

  const resaleBlocks = transactionsByKey.size;
  if (unmatched.length / resaleBlocks > MAX_UNMATCHED_BLOCK_RATE) {
    const examples = unmatched.slice(0, 5).map((u) => `${u.block} ${u.street}`).join("; ");
    throw new PipelineError(
      `Only ${pct(resaleBlocks - unmatched.length, resaleBlocks)} of resale blocks matched ` +
        `${DATASET_A.name} on block + street (${n(unmatched.length)} unmatched, e.g. ${examples}). ` +
        "Street naming may have changed in one dataset.",
    );
  }
  const matched = resaleBlocks - unmatched.length;
  if (townMismatches.length / Math.max(matched, 1) > MAX_TOWN_MISMATCH_RATE) {
    throw new PipelineError(
      `${n(townMismatches.length)} matched blocks have a different town in each dataset ` +
        `(e.g. ${townMismatches.slice(0, 5).join("; ")}). Check the town code mapping in lib/towns.ts.`,
    );
  }

  return { transactionsByKey, unmatched, townMismatches };
}

function emptyCohortCounts(): Record<Cohort, number> {
  return { upcoming: 0, just_mopped: 0, mature: 0, later: 0 };
}

function toLocationFields(location: LocatedBlock | undefined): BlockLocation {
  if (!location) return { lat: null, lng: null, location_precision: null };
  return {
    lat: roundCoordinate(location.lat),
    lng: roundCoordinate(location.lng),
    location_precision: location.precision,
  };
}

function buildMeta(
  generatedAt: Date,
  context: DerivationContext,
  property: PropertyData,
  resale: ResaleData,
  buildings: BuildingData,
  derived: DerivedBlock[],
): DataMeta {
  const byCohort = {} as Record<Cohort, Record<MopStatus, number>>;
  for (const cohort of COHORTS) byCohort[cohort] = { confirmed: 0, estimated: 0 };
  for (const block of derived) byCohort[block.cohort][block.mop_status]++;

  const towns = TOWNS.map((town) => {
    const blocks = derived.filter((block) => block.town_code === town.code);
    const cohorts = emptyCohortCounts();
    const footprints: LatLng[] = [];
    for (const block of blocks) {
      cohorts[block.cohort]++;
      if (block.location_precision === "block" && block.lat !== null && block.lng !== null) {
        footprints.push({ lat: block.lat, lng: block.lng });
      }
    }
    if (footprints.length === 0) {
      throw new PipelineError(`${town.name} has no located blocks, so it has no map centre. Check ${DATASET_C.name}.`);
    }
    // Geolocation matches visitors against the centres shipped in lib/towns.ts, so they must track the data.
    const center = roundPoint(medianPoint(footprints));
    const drift = haversineKm(center, town.center);
    if (drift > MAX_TOWN_CENTRE_DRIFT_KM) {
      throw new PipelineError(
        `${town.name}'s centre is now ${center.lat}, ${center.lng}, ${drift.toFixed(2)} km from lib/towns.ts. ` +
          "Update its centre there so nearest-town matching stays accurate.",
      );
    }
    const confirmed = blocks.filter((block) => block.mop_status === "confirmed").length;
    return {
      code: town.code,
      name: town.name,
      slug: town.slug,
      blocks: blocks.length,
      confirmed,
      estimated: blocks.length - confirmed,
      cohorts,
      center,
    };
  });

  const withPrecision = (precision: DerivedBlock["location_precision"]) =>
    derived.filter((block) => block.location_precision === precision).length;
  const confirmed = derived.filter((block) => block.mop_status === "confirmed").length;

  return {
    schema_version: DATA_SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    current_month: formatMonth(context.currentMonth),
    latest_resale_month: formatMonth(context.latestResaleMonth),
    sources: {
      property_information: {
        id: DATASET_A.id,
        name: property.metadata.name,
        last_updated_at: property.metadata.lastUpdatedAt,
        records: property.blocks.length,
      },
      resale_prices: {
        id: DATASET_B.id,
        name: resale.metadata.name,
        last_updated_at: resale.metadata.lastUpdatedAt,
        records: resale.transactions.length,
      },
      buildings: {
        id: DATASET_C.id,
        name: buildings.metadata.name,
        last_updated_at: buildings.metadata.lastUpdatedAt,
        records: buildings.buildings.length,
      },
    },
    totals: {
      blocks: derived.length,
      confirmed,
      estimated: derived.length - confirmed,
      by_cohort: byCohort,
    },
    map: {
      located_blocks: withPrecision("block"),
      street_level_blocks: withPrecision("street"),
      unlocated_blocks: withPrecision(null),
    },
    towns,
  };
}

function toTransactionRow(tx: ResaleTransaction): TransactionRow {
  return [formatMonth(tx.month), tx.flatType, tx.storeyRange, tx.floorAreaSqm, tx.resalePrice, tx.remainingLeaseMonths];
}

function toMapPoint(block: DerivedBlock): MapPoint | null {
  if (block.lat === null || block.lng === null || block.location_precision === null) return null;
  return [
    block.id,
    block.town_code,
    block.lat,
    block.lng,
    block.mop_status,
    block.months_since_mop,
    block.year_completed,
    flatTypeMask(block.flat_type_mix),
    block.has_rental_units ? 1 : 0,
    block.resale_activity,
    block.location_precision,
  ];
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Writes to a staging directory, then swaps it in so a failed run never leaves mixed data. */
async function writeOutput(
  meta: DataMeta,
  derived: DerivedBlock[],
  transactionsById: Map<string, ResaleTransaction[]>,
): Promise<WrittenFile[]> {
  const staging = `${OUTPUT_DIR}.staging`;
  const previous = `${OUTPUT_DIR}.previous`;
  await rm(staging, { recursive: true, force: true });
  for (const directory of ["towns", "tx", "map"]) {
    await mkdir(path.join(staging, directory), { recursive: true });
  }

  const written: WrittenFile[] = [];
  const write = async (relativePath: string, data: unknown) => {
    const json = JSON.stringify(data);
    await writeFile(path.join(staging, relativePath), json);
    written.push({ file: relativePath, bytes: Buffer.byteLength(json) });
  };

  await write("meta.json", meta);

  for (const cohort of COHORTS) {
    const mapFile: MapPointsFile = {
      schema_version: DATA_SCHEMA_VERSION,
      cohort,
      current_month: meta.current_month,
      columns: MAP_POINT_COLUMNS,
      points: derived
        .filter((block) => block.cohort === cohort)
        .map(toMapPoint)
        .filter((point): point is MapPoint => point !== null),
    };
    await write(`map/${cohort}.json`, mapFile);
  }

  for (const town of TOWNS) {
    const blocks = derived
      .filter((block) => block.town_code === town.code)
      .sort((a, b) => Math.abs(a.months_since_mop) - Math.abs(b.months_since_mop) || a.id.localeCompare(b.id));

    const townFile: TownBlocksFile = {
      schema_version: DATA_SCHEMA_VERSION,
      town: { code: town.code, name: town.name, slug: town.slug },
      current_month: meta.current_month,
      latest_resale_month: meta.latest_resale_month,
      blocks,
    };
    await write(`towns/${town.slug}.json`, townFile);

    const transactionsFile: TownTransactionsFile = {
      schema_version: DATA_SCHEMA_VERSION,
      town_code: town.code,
      columns: TRANSACTION_COLUMNS,
      blocks: {},
    };
    for (const block of blocks) {
      const transactions = transactionsById.get(block.id);
      if (!transactions) continue;
      transactionsFile.blocks[block.id] = [...transactions]
        .sort((a, b) => b.month - a.month)
        .map(toTransactionRow);
    }
    await write(`tx/${town.slug}.json`, transactionsFile);
  }

  await rm(previous, { recursive: true, force: true });
  if (await pathExists(OUTPUT_DIR)) await rename(OUTPUT_DIR, previous);
  await rename(staging, OUTPUT_DIR);
  await rm(previous, { recursive: true, force: true });
  return written;
}

function table(headers: string[], rows: (string | number)[][]): string {
  const cells = [headers, ...rows.map((row) => row.map((cell) => (typeof cell === "number" ? n(cell) : cell)))];
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => String(row[column]).length)));
  const render = (row: (string | number)[]) =>
    "  " +
    row
      .map((cell, column) =>
        column === 0 ? String(cell).padEnd(widths[column]) : String(cell).padStart(widths[column]),
      )
      .join("  ");
  const rule = "  " + widths.map((width) => "─".repeat(width)).join("  ");
  return [render(cells[0]), rule, ...cells.slice(1).map(render)].join("\n");
}

function describeBlock(block: DerivedBlock): string {
  const town = townByCode(block.town_code)?.name ?? block.town_code;
  return `${block.blk_no} ${block.street}, ${town}`;
}

function describePrices(block: DerivedBlock): string {
  const entries = Object.entries(block.median_price_12mo);
  if (entries.length === 0) return "no resales in last 12 mo";
  return entries.map(([type, stat]) => `${type} median ${money(stat.median)} (n=${stat.count})`).join(", ");
}

function printSummary(args: {
  context: DerivationContext;
  property: PropertyData;
  resale: ResaleData;
  buildings: BuildingData;
  join: JoinResult;
  match: StreetCodeMatch;
  duplicateFootprints: number;
  derived: DerivedBlock[];
  meta: DataMeta;
  excluded: Record<ExclusionReason, number>;
  excludedWithResales: string[];
  written: WrittenFile[];
  elapsedMs: number;
}): void {
  const { context, property, resale, buildings, join, match, derived, meta, excluded, excludedWithResales, written } =
    args;
  const confirmed = derived.filter((block) => block.mop_status === "confirmed");
  const estimated = derived.filter((block) => block.mop_status === "estimated");
  const rule = "═".repeat(78);

  console.log(`\n${rule}\nMOP RADAR · DERIVATION SUMMARY\n${rule}`);
  console.log(
    `Run month ${formatMonth(context.currentMonth)} (SGT) · latest resale month ${formatMonth(context.latestResaleMonth)}`,
  );

  console.log("\nSources (IDs and names verified against data.gov.sg metadata)");
  console.log(`  ${DATASET_A.name}: ${n(property.blocks.length)} records · updated ${property.metadata.lastUpdatedAt}`);
  console.log(`  ${DATASET_B.name}: ${n(resale.transactions.length)} transactions · updated ${resale.metadata.lastUpdatedAt}`);
  console.log(`  ${DATASET_C.name}: ${n(buildings.buildings.length)} footprints · updated ${buildings.metadata.lastUpdatedAt}`);

  console.log("\nBlocks");
  console.log(`  ${n(property.blocks.length).padStart(7)}  in ${DATASET_A.name}`);
  console.log(`  ${("−" + n(excluded.non_residential)).padStart(7)}  non-residential`);
  console.log(`  ${("−" + n(excluded.no_sold_units)).padStart(7)}  residential with zero sold units (rental-only)`);
  console.log(`  ${("=" + n(derived.length)).padStart(7)}  eligible blocks`);

  const resaleBlocks = join.transactionsByKey.size;
  const matched = resaleBlocks - join.unmatched.length;
  console.log("\nResale join on block + street");
  console.log(
    `  ${n(resaleBlocks)} blocks with resales · ${n(matched)} matched (${pct(matched, resaleBlocks)}) · ` +
      `${n(join.unmatched.length)} unmatched · ${n(join.townMismatches.length)} town mismatches`,
  );
  for (const u of join.unmatched.slice(0, 10)) {
    console.log(`    unmatched: ${u.block} ${u.street} (${u.transactions} transactions, not published)`);
  }
  if (excludedWithResales.length > 0) {
    console.log(
      `  ${n(excludedWithResales.length)} blocks excluded as zero-sold still have resales on record (not published): ` +
        excludedWithResales.join("; "),
    );
  }

  const blockLevel = derived.filter((block) => block.location_precision === "block");
  const streetLevel = derived.filter((block) => block.location_precision === "street");
  const unlocated = derived.filter((block) => block.location_precision === null);
  console.log(`\nMap locations (${DATASET_C.name} street codes matched to street names)`);
  console.log(`  ${n(match.streetByCode.size)} of ${n(match.codes)} street codes matched`);
  for (const rejection of match.rejected) {
    console.log(
      `    unmatched ${rejection.code} (${rejection.buildings} buildings): ${REJECTION_LABELS[rejection.reason]}` +
        (rejection.closest ? `; closest ${rejection.closest}` : ""),
    );
  }
  console.log(`  ${n(blockLevel.length)} eligible blocks at their own footprint (${pct(blockLevel.length, derived.length)})`);
  console.log(`  ${n(streetLevel.length)} at street level (block not in footprint data yet; marked approximate)`);
  console.log(`  ${n(unlocated.length)} not on the map (list only)`);
  for (const block of [...streetLevel, ...unlocated]) {
    console.log(
      `    ${(block.location_precision ?? "none").padEnd(6)} ${describeBlock(block)} · completed ${block.year_completed} · ${block.cohort}`,
    );
  }
  if (args.duplicateFootprints > 0) {
    console.log(`  ${n(args.duplicateFootprints)} extra footprints for an already-located block ignored`);
  }
  console.log(
    "  on the map by cohort: " +
      COHORTS.map((cohort) => {
        const all = derived.filter((block) => block.cohort === cohort);
        const onMap = all.filter((block) => block.location_precision !== null).length;
        return `${cohort} ${n(onMap)}/${n(all.length)}`;
      }).join(" · "),
  );

  console.log("\nMOP status");
  console.log(`  confirmed  ${n(confirmed.length).padStart(7)}  ${pct(confirmed.length, derived.length).padStart(6)}  resale on record`);
  console.log(`  estimated  ${n(estimated.length).padStart(7)}  ${pct(estimated.length, derived.length).padStart(6)}  year_completed + 5`);

  console.log("\nCohort × status");
  const cohortRows = COHORTS.map((cohort) => {
    const counts = meta.totals.by_cohort[cohort];
    return [COHORT_LABELS[cohort], counts.confirmed, counts.estimated, counts.confirmed + counts.estimated];
  });
  cohortRows.push(["total", confirmed.length, estimated.length, derived.length]);
  console.log(table(["cohort", "confirmed", "estimated", "total"], cohortRows));

  console.log("\nEstimated blocks by estimated MOP year (mid-year assumed)");
  const byYear = new Map<number, { count: number; cohorts: Set<Cohort> }>();
  for (const block of estimated) {
    const entry = byYear.get(block.mop_year) ?? { count: 0, cohorts: new Set<Cohort>() };
    entry.count++;
    entry.cohorts.add(block.cohort);
    byYear.set(block.mop_year, entry);
  }
  const years = [...byYear.entries()].sort(([a], [b]) => a - b);
  const olderYears = years.filter(([year]) => year < 2024);
  const yearRows: (string | number)[][] = [];
  if (olderYears.length > 0) {
    yearRows.push(["before 2024", olderYears.reduce((sum, [, entry]) => sum + entry.count, 0), "mature"]);
  }
  for (const [year, entry] of years.filter(([y]) => y >= 2024)) {
    yearRows.push([String(year), entry.count, [...entry.cohorts].join(", ")]);
  }
  console.log(table(["MOP year", "blocks", "cohort"], yearRows));

  console.log("\nConfirmed-block sanity checks");
  const atDataStart = confirmed.filter((block) => block.first_transaction_at_data_start);
  console.log(`  ${n(atDataStart.length)} first resale in Jan–Mar 2017, the start of resale data (true MOP is earlier)`);
  const lateFirstResale = confirmed.filter(
    (block) =>
      !block.first_transaction_at_data_start &&
      parseMonth(block.first_transaction_month as string) - estimatedMopMonth(block.year_completed) >=
        FIRST_RESALE_MAX_LAG_MONTHS,
  );
  console.log(
    `  ${n(lateFirstResale.length)} more with first resale ${FIRST_RESALE_MAX_LAG_MONTHS}+ months after estimated MOP ` +
      "(MOP predates 2017 data, or thin trading): MOP clock uses the estimate",
  );
  const earlyResale = confirmed.filter(
    (block) =>
      estimatedMopMonth(block.year_completed) - parseMonth(block.first_transaction_month as string) >
      EARLY_RESALE_LEAD_MONTHS,
  );
  console.log(
    `  ${n(earlyResale.length)} first resale 12+ months BEFORE estimated MOP (year_completed likely late; resale date used):`,
  );
  for (const block of earlyResale.slice(0, 15)) {
    console.log(
      `    ${describeBlock(block)} · completed ${block.year_completed} · first resale ${block.first_transaction_month}`,
    );
  }

  const activity = { none: 0, light: 0, active: 0 };
  for (const block of confirmed) activity[block.resale_activity]++;
  console.log(
    `\nResale activity, confirmed blocks, ${formatMonth(context.latestResaleMonth - 11)} to ${formatMonth(context.latestResaleMonth)}`,
  );
  console.log(`  none ${n(activity.none)} · light (1–4) ${n(activity.light)} · active (5+) ${n(activity.active)}`);
  console.log(`  estimated blocks are all "none" (${n(estimated.length)})`);

  console.log("\nBy town");
  console.log(
    table(
      ["town", "blocks", "confirmed", "estimated", "upcoming", "just_mopped", "mature", "later", "map centre"],
      meta.towns.map((town) => [
        town.name,
        town.blocks,
        town.confirmed,
        town.estimated,
        town.cohorts.upcoming,
        town.cohorts.just_mopped,
        town.cohorts.mature,
        town.cohorts.later,
        `${town.center.lat.toFixed(4)}, ${town.center.lng.toFixed(4)}`,
      ]),
    ),
  );

  const sample = (title: string, blocks: DerivedBlock[], line: (block: DerivedBlock) => string) => {
    console.log(`\n${title}`);
    if (blocks.length === 0) console.log("  (none)");
    for (const block of blocks.slice(0, 8)) console.log(`  ${line(block)}`);
  };

  sample(
    "Sample · just passed MOP · CONFIRMED (most recent first resale)",
    confirmed
      .filter((block) => block.cohort === "just_mopped")
      .sort((a, b) => (b.first_transaction_month as string).localeCompare(a.first_transaction_month as string)),
    (block) =>
      `${describeBlock(block)} · completed ${block.year_completed} · first resale ${block.first_transaction_month} · ` +
      `${block.last_12mo_transaction_count} sales/12mo · ${describePrices(block)}`,
  );
  sample(
    "Sample · just passed MOP · ESTIMATED (no resale yet)",
    estimated.filter((block) => block.cohort === "just_mopped").sort((a, b) => a.months_since_mop - b.months_since_mop),
    (block) =>
      `${describeBlock(block)} · completed ${block.year_completed} · est. MOP ${block.mop_year} · ` +
      `${block.sold_units} sold units`,
  );
  sample(
    "Sample · coming up · ESTIMATED (soonest first)",
    estimated.filter((block) => block.cohort === "upcoming").sort((a, b) => b.months_since_mop - a.months_since_mop),
    (block) =>
      `${describeBlock(block)} · completed ${block.year_completed} · est. MOP ${block.mop_year} ` +
      `(${-block.months_since_mop} mo) · ${block.sold_units} sold units`,
  );

  const totalBytes = written.reduce((sum, file) => sum + file.bytes, 0);
  const kb = (bytes: number) => `${n(Math.round(bytes / 1024))} KB`;
  console.log(`\nOutput → public/data · ${n(written.length)} files · ${kb(totalBytes)} uncompressed`);
  console.log(`  map: ${written.filter((file) => file.file.startsWith("map/")).map((file) => `${file.file} ${kb(file.bytes)}`).join(" · ")}`);
  const largest = [...written].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  console.log(`  largest: ${largest.map((file) => `${file.file} ${kb(file.bytes)}`).join(" · ")}`);
  console.log(`\nDone in ${(args.elapsedMs / 1000).toFixed(1)}s`);
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const context: DerivationContext = { currentMonth: singaporeMonth(startedAt), latestResaleMonth: 0 };
  console.log(`MOP Radar data pipeline · run month ${formatMonth(context.currentMonth)} (SGT)`);

  const property = await loadProperty();
  const resale = await loadResales(context.currentMonth);
  const buildings = await loadBuildings();
  context.latestResaleMonth = resale.latestMonth;
  const join = joinResales(property.blocks, resale.transactions);

  const match = matchStreetCodes(buildings.buildings, buildStreets(property.blocks));
  const eligibleBlocks = property.blocks.filter((block) => exclusionReason(block) === null);
  const { locations, duplicateFootprints } = locateBlocks(eligibleBlocks, buildings.buildings, match.streetByCode);

  const excluded: Record<ExclusionReason, number> = { non_residential: 0, no_sold_units: 0 };
  const excludedWithResales: string[] = [];
  const derived: DerivedBlock[] = [];
  const transactionsById = new Map<string, ResaleTransaction[]>();
  const ids = new Set<string>();

  for (const block of property.blocks) {
    const key = blockKey(block.blkNo, block.street);
    const transactions = join.transactionsByKey.get(key) ?? [];
    const reason = exclusionReason(block);
    if (reason) {
      excluded[reason]++;
      if (transactions.length > 0) excludedWithResales.push(`${block.blkNo} ${block.street}`);
      continue;
    }
    const result = deriveBlock(block, transactions, context);
    if (ids.has(result.id)) {
      throw new PipelineError(
        `Block id collision "${result.id}" (${block.blkNo} ${block.street}). Adjust blockId() in lib/mop.ts.`,
      );
    }
    ids.add(result.id);
    derived.push({ ...result, ...toLocationFields(locations.get(key)) });
    if (transactions.length > 0) transactionsById.set(result.id, transactions);
  }

  const blockLevel = derived.filter((block) => block.location_precision === "block").length;
  if (blockLevel / derived.length < MIN_BLOCK_LOCATION_COVERAGE) {
    throw new PipelineError(
      `Only ${pct(blockLevel, derived.length)} of eligible blocks could be placed at their own footprint ` +
        `(minimum ${MIN_BLOCK_LOCATION_COVERAGE * 100}%). ${DATASET_C.name} street codes may have changed; ` +
        "see scripts/pipeline/geo-match.ts.",
    );
  }

  const meta = buildMeta(startedAt, context, property, resale, buildings, derived);
  const written = await writeOutput(meta, derived, transactionsById);
  printSummary({
    context,
    property,
    resale,
    buildings,
    join,
    match,
    duplicateFootprints,
    derived,
    meta,
    excluded,
    excludedWithResales,
    written,
    elapsedMs: Date.now() - startedAt.getTime(),
  });
}

main().catch((error: unknown) => {
  console.error("\n✖ MOP Radar data pipeline failed\n");
  console.error(error instanceof PipelineError ? error.message : error);
  console.error("\npublic/data was not replaced.");
  process.exitCode = 1;
});
