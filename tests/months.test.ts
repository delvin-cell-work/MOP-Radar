import { describe, expect, it } from "vitest";

import { formatMonth, monthOf, parseMonth, singaporeMonth } from "../lib/months";

describe("months", () => {
  it("round-trips YYYY-MM", () => {
    for (const value of ["2017-01", "2026-09", "1978-12"]) {
      expect(formatMonth(parseMonth(value))).toBe(value);
    }
  });

  it("does month arithmetic across year boundaries", () => {
    expect(formatMonth(parseMonth("2026-01") - 1)).toBe("2025-12");
    expect(parseMonth("2026-09") - parseMonth("2025-10")).toBe(11);
    expect(monthOf(2026, 7)).toBe(parseMonth("2026-07"));
  });

  it.each(["2026-13", "2026-00", "2026-9", "26-09", "2026/09", ""])("rejects %j", (value) => {
    expect(() => parseMonth(value)).toThrow();
  });

  it("resolves the month in Singapore time, not UTC", () => {
    // 00:30 on 1 Sep 2026 in Singapore is still 31 Aug in UTC.
    expect(formatMonth(singaporeMonth(new Date("2026-08-31T16:30:00Z")))).toBe("2026-09");
    expect(formatMonth(singaporeMonth(new Date("2026-08-31T15:59:59Z")))).toBe("2026-08");
  });
});
