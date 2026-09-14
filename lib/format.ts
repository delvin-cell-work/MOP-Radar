import type { BlockDerivation } from "./data-contract";
import { FLAT_TYPES, type FlatTypeKey } from "./flat-types";
import { formatMonth, parseMonth } from "./months";

/**
 * Display formatting. Deliberately avoids Intl so output is identical on the
 * server, in every supported browser, and in tests.
 */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08" → "Aug 2026". */
export function formatMonthLabel(month: string): string {
  const index = parseMonth(month);
  return `${MONTH_NAMES[index % 12]} ${Math.floor(index / 12)}`;
}

export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatPrice(value: number): string {
  return `$${formatNumber(value)}`;
}

/** "BT BATOK WEST AVE 6" → "Bt Batok West Ave 6". Keeps HDB's abbreviations. */
export function formatStreet(street: string): string {
  return street
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}

/** "4-Room (92) · 5-Room (40)", in canonical flat type order. */
export function describeFlatMix(mix: Partial<Record<FlatTypeKey, number>>): string {
  return FLAT_TYPES.filter((type) => (mix[type.key] ?? 0) > 0)
    .map((type) => `${type.label} (${formatNumber(mix[type.key] ?? 0)})`)
    .join(" · ");
}

/** The 12-month window ending at the latest resale month: "Oct 2025 – Sep 2026". */
export function resaleWindowLabel(latestResaleMonth: string): string {
  const end = parseMonth(latestResaleMonth);
  return `${formatMonthLabel(formatMonth(end - 11))} – ${formatMonthLabel(latestResaleMonth)}`;
}

export type MopDescriptionInput = Pick<
  BlockDerivation,
  | "mop_status"
  | "first_transaction_month"
  | "first_transaction_at_data_start"
  | "year_completed"
  | "mop_year"
  | "months_since_mop"
>;

/**
 * Headline and supporting detail for a block's MOP. Estimates name only a
 * half-year: year_completed has no month, so anything finer is false precision.
 */
export function describeMop(block: MopDescriptionInput): { headline: string; detail: string } {
  if (block.mop_status === "confirmed" && block.first_transaction_month) {
    return {
      headline: "MOP passed",
      detail: block.first_transaction_at_data_start
        ? `Completed ${block.year_completed} · resales on record since 2017`
        : `First resale ${formatMonthLabel(block.first_transaction_month)}`,
    };
  }
  if (block.months_since_mop < 0) {
    return {
      headline: `MOP expected mid-${block.mop_year}`,
      detail: `Completed ${block.year_completed} · no resales yet`,
    };
  }
  return {
    headline: `MOP estimated mid-${block.mop_year}`,
    detail: `Completed ${block.year_completed} · no resales on record`,
  };
}

/** One line under the results count, e.g. "33 with resales on record · 9 estimated". */
export function describeStatusBreakdown(withResales: number, total: number): string | null {
  if (total === 0) return null;
  if (withResales === 0) return "All estimated from completion year · no resales yet";
  if (withResales === total) return "All with resales on record";
  return `${formatNumber(withResales)} with resales on record · ${formatNumber(total - withResales)} estimated`;
}

/** "Blk 622B Tampines Ave 12". */
export function blockTitle(block: { blk_no: string; street: string }): string {
  return `Blk ${block.blk_no} ${formatStreet(block.street)}`;
}

/** 1133 → "94 yrs 5 mths". */
export function formatRemainingLease(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months - years * 12;
  const yearsLabel = `${years} ${years === 1 ? "yr" : "yrs"}`;
  return rest === 0 ? yearsLabel : `${yearsLabel} ${rest} ${rest === 1 ? "mth" : "mths"}`;
}

/** "01 TO 03" → "1–3". */
export function formatStoreyRange(range: string): string {
  const match = /^(\d+) TO (\d+)$/.exec(range.trim());
  return match ? `${Number(match[1])}–${Number(match[2])}` : range;
}

export function formatArea(sqm: number): string {
  return `${Number.isInteger(sqm) ? sqm : sqm.toFixed(1)} m²`;
}

/** The time-window half of a results summary, e.g. "passed MOP in the last 24 months". */
export function mopWindowPhrase(view: "just_mopped" | "upcoming" | "all", months: number): string | null {
  if (view === "just_mopped") return `passed MOP in the last ${months} months`;
  if (view === "upcoming") return `reach MOP in the next ${months} months`;
  return null;
}
