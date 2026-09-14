import { describe, expect, it } from "vitest";

import { MOP_DISCLOSURE } from "../lib/compliance";
import {
  describeFlatMix,
  describeMop,
  formatMonthLabel,
  formatNumber,
  formatPrice,
  formatStreet,
  resaleWindowLabel,
  type MopDescriptionInput,
} from "../lib/format";

describe("MOP_DISCLOSURE", () => {
  it("matches the product brief word for word", () => {
    expect(MOP_DISCLOSURE).toBe(
      "MOP dates are derived from public HDB completion and resale data, not official HDB records. " +
        "Estimates can be off by several months. Confirm with HDB before making any decision.",
    );
  });
});

describe("formatMonthLabel", () => {
  it.each([
    ["2026-08", "Aug 2026"],
    ["2017-01", "Jan 2017"],
    ["2025-12", "Dec 2025"],
  ])("%s → %s", (month, label) => {
    expect(formatMonthLabel(month)).toBe(label);
  });

  it("rejects malformed months", () => {
    expect(() => formatMonthLabel("2026-13")).toThrow();
  });
});

describe("formatNumber and formatPrice", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [1050000, "1,050,000"],
    [800501.4, "800,501"],
  ])("%d → %s", (value, formatted) => {
    expect(formatNumber(value)).toBe(formatted);
  });

  it("prefixes prices with a dollar sign", () => {
    expect(formatPrice(1454444)).toBe("$1,454,444");
  });
});

describe("formatStreet", () => {
  it.each([
    ["BT BATOK WEST AVE 6", "Bt Batok West Ave 6"],
    ["ST. GEORGE'S RD", "St. George's Rd"],
    ["C'WEALTH CRES", "C'wealth Cres"],
    ["BIDADARI PK DR", "Bidadari Pk Dr"],
  ])("%s → %s", (street, formatted) => {
    expect(formatStreet(street)).toBe(formatted);
  });
});

describe("describeFlatMix", () => {
  it("lists sold flat types in canonical order", () => {
    expect(describeFlatMix({ "5room": 40, "4room": 92, studio: 0 })).toBe("4-Room (92) · 5-Room (40)");
  });
});

describe("resaleWindowLabel", () => {
  it("spans the 12 months ending at the latest resale month", () => {
    expect(resaleWindowLabel("2026-09")).toBe("Oct 2025 – Sep 2026");
    expect(resaleWindowLabel("2026-01")).toBe("Feb 2025 – Jan 2026");
  });
});

describe("describeMop", () => {
  const base: MopDescriptionInput = {
    mop_status: "confirmed",
    first_transaction_month: "2026-08",
    first_transaction_at_data_start: false,
    year_completed: 2021,
    mop_year: 2026,
    months_since_mop: 1,
  };

  it("names the first resale for a block with a recent resale", () => {
    expect(describeMop(base)).toEqual({ headline: "MOP passed", detail: "First resale Aug 2026" });
  });

  it("does not present the start of resale data as a MOP date", () => {
    const result = describeMop({
      ...base,
      first_transaction_month: "2017-01",
      first_transaction_at_data_start: true,
      year_completed: 1985,
    });
    expect(result).toEqual({ headline: "MOP passed", detail: "Completed 1985 · resales on record since 2017" });
  });

  it("gives only a half-year for an upcoming estimate", () => {
    const result = describeMop({
      ...base,
      mop_status: "estimated",
      first_transaction_month: null,
      year_completed: 2022,
      mop_year: 2027,
      months_since_mop: -10,
    });
    expect(result).toEqual({ headline: "MOP expected mid-2027", detail: "Completed 2022 · no resales yet" });
  });

  it("describes a past estimate without claiming MOP was confirmed", () => {
    const result = describeMop({ ...base, mop_status: "estimated", first_transaction_month: null, months_since_mop: 2 });
    expect(result).toEqual({ headline: "MOP estimated mid-2026", detail: "Completed 2021 · no resales on record" });
  });
});
