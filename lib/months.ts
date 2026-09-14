/**
 * Calendar months as integers (year * 12 + zero-based month), so month
 * arithmetic never touches Date objects, timezones or day-of-month rollover.
 */
export type MonthIndex = number;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(value: string): MonthIndex {
  const match = MONTH_RE.exec(value);
  if (!match) throw new Error(`Invalid month "${value}", expected YYYY-MM`);
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

export function formatMonth(index: MonthIndex): string {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthOf(year: number, month: number): MonthIndex {
  return year * 12 + month - 1;
}

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The calendar month in Singapore (UTC+8, no daylight saving). */
export function singaporeMonth(date: Date): MonthIndex {
  const shifted = new Date(date.getTime() + SGT_OFFSET_MS);
  return shifted.getUTCFullYear() * 12 + shifted.getUTCMonth();
}
