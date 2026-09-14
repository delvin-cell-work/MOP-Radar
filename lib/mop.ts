import type { Cohort, BlockDerivation, MopStatus, PriceStat, ResaleActivity } from "./data-contract";
import { FLAT_TYPES, RESALE_FLAT_TYPES, type FlatTypeKey, type ResaleFlatTypeKey } from "./flat-types";
import { formatMonth, monthOf, type MonthIndex } from "./months";

/**
 * MOP derivation. HDB publishes no key-collection dates, so MOP is inferred
 * from two public signals:
 *
 * - confirmed: the block has at least one resale since Jan 2017. A flat cannot
 *   be resold before MOP, so MOP had passed by the first resale month.
 * - estimated: no resale on record. MOP is assumed to fall mid-way through
 *   year_completed + 5, because year_completed carries no month.
 *
 * months_since_mop counts from the first resale when it lands less than 24
 * months after the estimate. Beyond that the first resale says little about
 * when MOP happened: resale data only starts in 2017, and thinly traded blocks
 * can go years without a sale, so the estimate is used instead. Without this, a
 * block completed in 1978 and first resold in 2025 would look "just MOP'd".
 * A first resale EARLIER than the estimate is always used: it is hard evidence.
 */

export const MOP_YEARS = 5;
export const ESTIMATED_MOP_MONTH = 7;
export const COHORT_WINDOW_MONTHS = 24;
/** A first resale this many months or more after the estimate is not treated as the MOP date. */
export const FIRST_RESALE_MAX_LAG_MONTHS = 24;
export const RESALE_WINDOW_MONTHS = 12;
/** p90 of last-12-month resales per block was 5 in Sep 2026. */
export const ACTIVE_RESALE_MIN_TRANSACTIONS = 5;
export const RESALE_DATA_START: MonthIndex = monthOf(2017, 1);
export const DATA_START_GRACE_MONTHS = 3;

export interface BlockInput {
  blkNo: string;
  street: string;
  townCode: string;
  yearCompleted: number;
  maxFloorLvl: number;
  totalDwellingUnits: number;
  residential: boolean;
  sold: Record<FlatTypeKey, number>;
  rental: { oneRoom: number; twoRoom: number; threeRoom: number; other: number };
  amenities: {
    commercial: boolean;
    marketHawker: boolean;
    miscellaneous: boolean;
    multistoreyCarpark: boolean;
    precinctPavilion: boolean;
  };
}

export interface TransactionInput {
  month: MonthIndex;
  flatType: ResaleFlatTypeKey;
  resalePrice: number;
}

export interface DerivationContext {
  /** Month the derivation runs for, in Singapore time. */
  currentMonth: MonthIndex;
  /** Latest month in the resale data; anchors the 12-month activity window. */
  latestResaleMonth: MonthIndex;
}

export type ExclusionReason = "non_residential" | "no_sold_units";

export function soldUnits(block: BlockInput): number {
  return FLAT_TYPES.reduce((sum, type) => sum + block.sold[type.key], 0);
}

export function rentalUnits(block: BlockInput): number {
  const { oneRoom, twoRoom, threeRoom, other } = block.rental;
  return oneRoom + twoRoom + threeRoom + other;
}

export function exclusionReason(block: BlockInput): ExclusionReason | null {
  if (!block.residential) return "non_residential";
  if (soldUnits(block) === 0) return "no_sold_units";
  return null;
}

export function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Join key between Dataset A (blk_no, street) and Dataset B (block, street_name). */
export function blockKey(blkNo: string, street: string): string {
  return `${normaliseName(blkNo)}|${normaliseName(street)}`;
}

export function blockId(blkNo: string, street: string): string {
  return `${blkNo}-${street}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function estimatedMopMonth(yearCompleted: number): MonthIndex {
  return monthOf(yearCompleted + MOP_YEARS, ESTIMATED_MOP_MONTH);
}

/** The month months_since_mop counts from. See the module comment. */
export function mopAnchorMonth(yearCompleted: number, firstResale: MonthIndex | null): MonthIndex {
  const estimate = estimatedMopMonth(yearCompleted);
  if (firstResale === null) return estimate;
  return firstResale - estimate < FIRST_RESALE_MAX_LAG_MONTHS ? firstResale : estimate;
}

export function cohortFor(monthsSinceMop: number): Cohort {
  if (monthsSinceMop >= COHORT_WINDOW_MONTHS) return "mature";
  if (monthsSinceMop >= 0) return "just_mopped";
  if (monthsSinceMop >= -COHORT_WINDOW_MONTHS) return "upcoming";
  return "later";
}

export function resaleActivityFor(last12MonthTransactions: number): ResaleActivity {
  if (last12MonthTransactions === 0) return "none";
  return last12MonthTransactions >= ACTIVE_RESALE_MIN_TRANSACTIONS ? "active" : "light";
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median() of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function deriveBlock(
  block: BlockInput,
  transactions: readonly TransactionInput[],
  context: DerivationContext,
): BlockDerivation {
  const reason = exclusionReason(block);
  if (reason) {
    throw new Error(`Cannot derive MOP for excluded block ${block.blkNo} ${block.street}: ${reason}`);
  }
  if (context.latestResaleMonth > context.currentMonth) {
    throw new Error("latestResaleMonth cannot be after currentMonth");
  }

  const windowStart = context.latestResaleMonth - RESALE_WINDOW_MONTHS + 1;
  const recentPrices = new Map<ResaleFlatTypeKey, number[]>();
  let firstResale: MonthIndex | null = null;
  let recentCount = 0;

  for (const transaction of transactions) {
    if (transaction.month > context.latestResaleMonth) {
      throw new Error(`Transaction in ${formatMonth(transaction.month)} is after the latest resale month`);
    }
    if (firstResale === null || transaction.month < firstResale) firstResale = transaction.month;
    if (transaction.month >= windowStart) {
      recentCount++;
      const prices = recentPrices.get(transaction.flatType);
      if (prices) prices.push(transaction.resalePrice);
      else recentPrices.set(transaction.flatType, [transaction.resalePrice]);
    }
  }

  const status: MopStatus = firstResale === null ? "estimated" : "confirmed";
  const monthsSinceMop = context.currentMonth - mopAnchorMonth(block.yearCompleted, firstResale);

  const flatTypeMix: Partial<Record<FlatTypeKey, number>> = {};
  for (const type of FLAT_TYPES) {
    if (block.sold[type.key] > 0) flatTypeMix[type.key] = block.sold[type.key];
  }

  const medianPrices: Partial<Record<ResaleFlatTypeKey, PriceStat>> = {};
  for (const type of RESALE_FLAT_TYPES) {
    const prices = recentPrices.get(type.key);
    if (prices) medianPrices[type.key] = { median: Math.round(median(prices)), count: prices.length };
  }

  const rental = rentalUnits(block);
  const firstResaleMonth = firstResale === null ? null : formatMonth(firstResale);

  return {
    id: blockId(block.blkNo, block.street),
    blk_no: block.blkNo,
    street: block.street,
    town_code: block.townCode,
    year_completed: block.yearCompleted,
    max_floor_lvl: block.maxFloorLvl,
    total_dwelling_units: block.totalDwellingUnits,
    mop_status: status,
    mop_date: firstResaleMonth,
    mop_year: block.yearCompleted + MOP_YEARS,
    months_since_mop: monthsSinceMop,
    cohort: cohortFor(monthsSinceMop),
    first_transaction_month: firstResaleMonth,
    first_transaction_at_data_start:
      firstResale !== null && firstResale < RESALE_DATA_START + DATA_START_GRACE_MONTHS,
    transaction_count: transactions.length,
    last_12mo_transaction_count: recentCount,
    median_price_12mo: medianPrices,
    flat_type_mix: flatTypeMix,
    sold_units: soldUnits(block),
    rental_units: rental,
    has_rental_units: rental > 0,
    resale_activity: resaleActivityFor(recentCount),
    amenities: {
      commercial: block.amenities.commercial,
      market_hawker: block.amenities.marketHawker,
      multistorey_carpark: block.amenities.multistoreyCarpark,
      precinct_pavilion: block.amenities.precinctPavilion,
      miscellaneous: block.amenities.miscellaneous,
    },
  };
}
