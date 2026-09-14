import type { FlatTypeKey, ResaleFlatTypeKey } from "./flat-types";
import type { LatLng } from "./geo";

/**
 * Shape of the static JSON the pipeline writes to public/data/ and the app
 * reads at runtime. Field names are snake_case to match the product spec.
 * Bump DATA_SCHEMA_VERSION on any breaking change.
 */
export const DATA_SCHEMA_VERSION = 1;

export type MopStatus = "confirmed" | "estimated";

/**
 * upcoming: MOP in the next 24 months · just_mopped: MOP in the last 24 months
 * mature: MOP 24+ months ago · later: MOP more than 24 months away
 */
export type Cohort = "upcoming" | "just_mopped" | "mature" | "later";

export const COHORTS: readonly Cohort[] = ["upcoming", "just_mopped", "mature", "later"];

export type ResaleActivity = "none" | "light" | "active";

/** "block": the block's own footprint. "street": median of located blocks on its street. */
export type LocationPrecision = "block" | "street";

export interface PriceStat {
  median: number;
  count: number;
}

export interface BlockAmenities {
  commercial: boolean;
  market_hawker: boolean;
  multistorey_carpark: boolean;
  precinct_pavilion: boolean;
  miscellaneous: boolean;
}

/** Everything lib/mop.ts derives for a block. */
export interface BlockDerivation {
  /** URL-safe, globally unique: slug of block number + street. */
  id: string;
  blk_no: string;
  street: string;
  town_code: string;
  year_completed: number;
  max_floor_lvl: number;
  total_dwelling_units: number;
  mop_status: MopStatus;
  /** Confirmed only: first resale month, by which MOP had passed. Null for estimates. */
  mop_date: string | null;
  /** year_completed + 5. The sole basis of an estimate. */
  mop_year: number;
  /** Negative = upcoming. See lib/mop.ts for the anchor month. */
  months_since_mop: number;
  cohort: Cohort;
  first_transaction_month: string | null;
  /** First resale falls in the first months of the resale dataset, so MOP was earlier still. */
  first_transaction_at_data_start: boolean;
  transaction_count: number;
  last_12mo_transaction_count: number;
  /** Historical transacted prices only. Never present these as a valuation. */
  median_price_12mo: Partial<Record<ResaleFlatTypeKey, PriceStat>>;
  flat_type_mix: Partial<Record<FlatTypeKey, number>>;
  sold_units: number;
  rental_units: number;
  has_rental_units: boolean;
  resale_activity: ResaleActivity;
  amenities: BlockAmenities;
}

export interface BlockLocation {
  /** WGS84, 5 decimal places (~1 m). Null when neither the block nor its street has a footprint. */
  lat: number | null;
  lng: number | null;
  location_precision: LocationPrecision | null;
}

export interface DerivedBlock extends BlockDerivation, BlockLocation {}

export interface TownSummary {
  code: string;
  name: string;
  slug: string;
  blocks: number;
  confirmed: number;
  estimated: number;
  cohorts: Record<Cohort, number>;
  /** Median of the town's block footprints: map label position and nearest-town reference. */
  center: LatLng;
}

export interface SourceInfo {
  id: string;
  name: string;
  last_updated_at: string;
  records: number;
}

export interface DataMeta {
  schema_version: number;
  generated_at: string;
  current_month: string;
  latest_resale_month: string;
  sources: {
    property_information: SourceInfo;
    resale_prices: SourceInfo;
    buildings: SourceInfo;
  };
  totals: {
    blocks: number;
    confirmed: number;
    estimated: number;
    by_cohort: Record<Cohort, Record<MopStatus, number>>;
  };
  map: {
    located_blocks: number;
    street_level_blocks: number;
    unlocated_blocks: number;
  };
  towns: TownSummary[];
}

export interface TownBlocksFile {
  schema_version: number;
  town: { code: string; name: string; slug: string };
  current_month: string;
  latest_resale_month: string;
  blocks: DerivedBlock[];
}

export const TRANSACTION_COLUMNS = [
  "month",
  "flat_type",
  "storey_range",
  "floor_area_sqm",
  "resale_price",
  "remaining_lease_months",
] as const;

export type TransactionRow = [
  month: string,
  flatType: ResaleFlatTypeKey,
  storeyRange: string,
  floorAreaSqm: number,
  resalePrice: number,
  remainingLeaseMonths: number,
];

/** Per-town transaction file; rows per block are sorted newest first. */
export interface TownTransactionsFile {
  schema_version: number;
  town_code: string;
  columns: typeof TRANSACTION_COLUMNS;
  blocks: Record<string, TransactionRow[]>;
}

export const MAP_POINT_COLUMNS = [
  "id",
  "town_code",
  "lat",
  "lng",
  "mop_status",
  "months_since_mop",
  "year_completed",
  "flat_type_mask",
  "has_rental_units",
  "resale_activity",
  "location_precision",
] as const;

/**
 * One located block on the national map, carrying every field the filters
 * need. flat_type_mask: bit i set when FLAT_TYPES[i] has sold units.
 */
export type MapPoint = [
  id: string,
  townCode: string,
  lat: number,
  lng: number,
  mopStatus: MopStatus,
  monthsSinceMop: number,
  yearCompleted: number,
  flatTypeMask: number,
  hasRentalUnits: 0 | 1,
  resaleActivity: ResaleActivity,
  locationPrecision: LocationPrecision,
];

/** public/data/map/<cohort>.json. Blocks without a location are omitted (list view only). */
export interface MapPointsFile {
  schema_version: number;
  cohort: Cohort;
  current_month: string;
  columns: typeof MAP_POINT_COLUMNS;
  points: MapPoint[];
}
