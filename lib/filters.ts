import { COHORTS, type Cohort, type DerivedBlock, type ResaleActivity } from "./data-contract";
import { FLAT_TYPES, flatTypeMask, maskHasFlatType, type FlatTypeKey } from "./flat-types";
import { COHORT_WINDOW_MONTHS } from "./mop";
import type { ResultsView } from "./views";

/** Steps for the MOP window slider, in months. */
export const MOP_WINDOW_STEPS: readonly number[] = [6, 12, 18, 24, 36, 48, 60];
export const DEFAULT_MOP_WINDOW_MONTHS = COHORT_WINDOW_MONTHS;

export type BlockAge = "any" | "under-10" | "10-20" | "20-30" | "over-30";

export const BLOCK_AGE_OPTIONS: readonly { value: BlockAge; label: string }[] = [
  { value: "any", label: "Any age" },
  { value: "under-10", label: "Under 10 years" },
  { value: "10-20", label: "10–20 years" },
  { value: "20-30", label: "20–30 years" },
  { value: "over-30", label: "Over 30 years" },
];

export const RESALE_ACTIVITY_OPTIONS: readonly { value: ResaleActivity; label: string }[] = [
  { value: "none", label: "No resales" },
  { value: "light", label: "1–4 resales" },
  { value: "active", label: "5+ resales" },
];

export interface Filters {
  /** Show blocks with at least one of these flat types. Empty means any. */
  flatTypes: FlatTypeKey[];
  /** Hide blocks that contain this flat type. */
  excludeFlatType: FlatTypeKey | null;
  excludeRental: boolean;
  /** How far from MOP the Just passed and Coming up tabs reach. */
  mopWindowMonths: number;
  blockAge: BlockAge;
  /** Resale activity in the last 12 months. Empty means any. */
  activity: ResaleActivity[];
}

export const DEFAULT_FILTERS: Filters = {
  flatTypes: [],
  excludeFlatType: null,
  excludeRental: false,
  mopWindowMonths: DEFAULT_MOP_WINDOW_MONTHS,
  blockAge: "any",
  activity: [],
};

/** The fields filters read. Map points (`MapBlock`) already have this shape. */
export interface FilterableBlock {
  monthsSinceMop: number;
  yearCompleted: number;
  flatTypeMask: number;
  hasRentalUnits: boolean;
  activity: ResaleActivity;
}

export function filterableBlock(block: DerivedBlock): FilterableBlock {
  return {
    monthsSinceMop: block.months_since_mop,
    yearCompleted: block.year_completed,
    flatTypeMask: flatTypeMask(block.flat_type_mix),
    hasRentalUnits: block.has_rental_units,
    activity: block.resale_activity,
  };
}

/** At the default 24-month window this is exactly the just_mopped and upcoming cohorts. */
export function matchesView(monthsSinceMop: number, view: ResultsView, windowMonths: number): boolean {
  if (view === "just_mopped") return monthsSinceMop >= 0 && monthsSinceMop < windowMonths;
  if (view === "upcoming") return monthsSinceMop < 0 && monthsSinceMop >= -windowMonths;
  return true;
}

/** The map point files that can hold matches for a view at this window. */
export function cohortsForView(view: ResultsView, windowMonths: number): Cohort[] {
  const wide = windowMonths > COHORT_WINDOW_MONTHS;
  if (view === "just_mopped") return wide ? ["just_mopped", "mature"] : ["just_mopped"];
  if (view === "upcoming") return wide ? ["upcoming", "later"] : ["upcoming"];
  return [...COHORTS];
}

function ageMatches(age: number, range: BlockAge): boolean {
  switch (range) {
    case "under-10":
      return age < 10;
    case "10-20":
      return age >= 10 && age < 20;
    case "20-30":
      return age >= 20 && age < 30;
    case "over-30":
      return age >= 30;
    default:
      return true;
  }
}

export function matchesFilters(block: FilterableBlock, filters: Filters, currentYear: number): boolean {
  if (filters.flatTypes.length > 0 && !filters.flatTypes.some((type) => maskHasFlatType(block.flatTypeMask, type))) {
    return false;
  }
  if (filters.excludeFlatType && maskHasFlatType(block.flatTypeMask, filters.excludeFlatType)) return false;
  if (filters.excludeRental && block.hasRentalUnits) return false;
  if (!ageMatches(currentYear - block.yearCompleted, filters.blockAge)) return false;
  if (filters.activity.length > 0 && !filters.activity.includes(block.activity)) return false;
  return true;
}

export function matchesViewAndFilters(
  block: FilterableBlock,
  view: ResultsView,
  filters: Filters,
  currentYear: number,
): boolean {
  return matchesView(block.monthsSinceMop, view, filters.mopWindowMonths) && matchesFilters(block, filters, currentYear);
}

/** Number of filter groups changed from their defaults. */
export function activeFilterCount(filters: Filters): number {
  return [
    filters.flatTypes.length > 0,
    filters.excludeFlatType !== null,
    filters.excludeRental,
    filters.mopWindowMonths !== DEFAULT_MOP_WINDOW_MONTHS,
    filters.blockAge !== "any",
    filters.activity.length > 0,
  ].filter(Boolean).length;
}

export function nextWiderWindow(windowMonths: number): number | null {
  return MOP_WINDOW_STEPS.find((step) => step > windowMonths) ?? null;
}

const FLAT_TYPE_KEYS = new Set<string>(FLAT_TYPES.map((type) => type.key));
const ACTIVITY_VALUES = new Set<string>(RESALE_ACTIVITY_OPTIONS.map((option) => option.value));

const isFlatType = (value: unknown): value is FlatTypeKey => typeof value === "string" && FLAT_TYPE_KEYS.has(value);
const isActivity = (value: unknown): value is ResaleActivity =>
  typeof value === "string" && ACTIVITY_VALUES.has(value);

/** Reads saved filters defensively: anything unrecognised falls back to its default. */
export function parseFilters(value: unknown): Filters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_FILTERS;
  const input = value as Record<string, unknown>;
  return {
    flatTypes: Array.isArray(input.flatTypes) ? [...new Set(input.flatTypes.filter(isFlatType))] : [],
    excludeFlatType: isFlatType(input.excludeFlatType) ? input.excludeFlatType : null,
    excludeRental: input.excludeRental === true,
    mopWindowMonths:
      typeof input.mopWindowMonths === "number" && MOP_WINDOW_STEPS.includes(input.mopWindowMonths)
        ? input.mopWindowMonths
        : DEFAULT_MOP_WINDOW_MONTHS,
    blockAge: BLOCK_AGE_OPTIONS.find((option) => option.value === input.blockAge)?.value ?? "any",
    activity: Array.isArray(input.activity) ? [...new Set(input.activity.filter(isActivity))] : [],
  };
}
