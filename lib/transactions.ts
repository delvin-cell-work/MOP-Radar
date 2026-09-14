import type { TransactionRow } from "./data-contract";
import { RESALE_FLAT_TYPES, type ResaleFlatTypeKey } from "./flat-types";

export interface Transaction {
  /** "YYYY-MM", the registration month. */
  month: string;
  flatType: ResaleFlatTypeKey;
  storeyRange: string;
  floorAreaSqm: number;
  resalePrice: number;
  remainingLeaseMonths: number;
}

export function decodeTransactions(rows: readonly TransactionRow[]): Transaction[] {
  return rows.map(([month, flatType, storeyRange, floorAreaSqm, resalePrice, remainingLeaseMonths]) => ({
    month,
    flatType,
    storeyRange,
    floorAreaSqm,
    resalePrice,
    remainingLeaseMonths,
  }));
}

export const SPARKLINE_MIN_POINTS = 5;

export interface PriceSeries {
  flatType: ResaleFlatTypeKey;
  /** Oldest first. */
  points: { month: string; price: number }[];
}

/**
 * Prices over time for the block's most-traded flat type, which needs at least
 * five resales. One flat type only, because mixing sizes on one line would
 * read as price movement that isn't there. Ties go to the smaller flat type.
 */
export function sparklineSeries(transactions: readonly Transaction[]): PriceSeries | null {
  let best: { flatType: ResaleFlatTypeKey; count: number } | null = null;
  for (const type of RESALE_FLAT_TYPES) {
    const count = transactions.filter((transaction) => transaction.flatType === type.key).length;
    if (!best || count > best.count) best = { flatType: type.key, count };
  }
  if (!best || best.count < SPARKLINE_MIN_POINTS) return null;
  const flatType = best.flatType;
  const points = transactions
    .filter((transaction) => transaction.flatType === flatType)
    .map((transaction) => ({ month: transaction.month, price: transaction.resalePrice }))
    .sort((a, b) => a.month.localeCompare(b.month));
  return { flatType, points };
}
