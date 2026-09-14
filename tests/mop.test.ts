import { describe, expect, it } from "vitest";

import type { ResaleFlatTypeKey } from "../lib/flat-types";
import { parseMonth } from "../lib/months";
import {
  blockId,
  blockKey,
  cohortFor,
  deriveBlock,
  estimatedMopMonth,
  exclusionReason,
  median,
  resaleActivityFor,
  type BlockInput,
  type DerivationContext,
  type TransactionInput,
} from "../lib/mop";

const context: DerivationContext = {
  currentMonth: parseMonth("2026-09"),
  latestResaleMonth: parseMonth("2026-09"),
};

function makeBlock(overrides: Partial<BlockInput> = {}): BlockInput {
  return {
    blkNo: "123A",
    street: "ANCHORVALE RD",
    townCode: "SK",
    yearCompleted: 2020,
    maxFloorLvl: 16,
    totalDwellingUnits: 100,
    residential: true,
    sold: { "1room": 0, "2room": 0, "3room": 20, "4room": 60, "5room": 20, executive: 0, multigen: 0, studio: 0 },
    rental: { oneRoom: 0, twoRoom: 0, threeRoom: 0, other: 0 },
    amenities: {
      commercial: false,
      marketHawker: false,
      miscellaneous: false,
      multistoreyCarpark: false,
      precinctPavilion: false,
    },
    ...overrides,
  };
}

function sale(month: string, flatType: ResaleFlatTypeKey = "4room", resalePrice = 600_000): TransactionInput {
  return { month: parseMonth(month), flatType, resalePrice };
}

describe("exclusionReason", () => {
  it("excludes non-residential blocks", () => {
    expect(exclusionReason(makeBlock({ residential: false }))).toBe("non_residential");
  });

  it("excludes pure rental blocks with zero sold units", () => {
    const rentalOnly = makeBlock({
      sold: { "1room": 0, "2room": 0, "3room": 0, "4room": 0, "5room": 0, executive: 0, multigen: 0, studio: 0 },
      rental: { oneRoom: 80, twoRoom: 20, threeRoom: 0, other: 0 },
    });
    expect(exclusionReason(rentalOnly)).toBe("no_sold_units");
  });

  it("keeps a block with only studio apartments sold", () => {
    const studios = makeBlock({
      sold: { "1room": 0, "2room": 0, "3room": 0, "4room": 0, "5room": 0, executive: 0, multigen: 0, studio: 40 },
    });
    expect(exclusionReason(studios)).toBeNull();
  });

  it("keeps a normal sold block", () => {
    expect(exclusionReason(makeBlock())).toBeNull();
  });

  it("refuses to derive an excluded block", () => {
    expect(() => deriveBlock(makeBlock({ residential: false }), [], context)).toThrow(/excluded/);
  });
});

describe("cohortFor", () => {
  it.each([
    [-25, "later"],
    [-24, "upcoming"],
    [-1, "upcoming"],
    [0, "just_mopped"],
    [23, "just_mopped"],
    [24, "mature"],
    [300, "mature"],
  ] as const)("months_since_mop %i → %s", (months, cohort) => {
    expect(cohortFor(months)).toBe(cohort);
  });
});

describe("estimatedMopMonth", () => {
  it("is July of year_completed + 5", () => {
    expect(estimatedMopMonth(2021)).toBe(parseMonth("2026-07"));
  });
});

describe("deriveBlock · estimated", () => {
  it("marks a block with no resales as estimated from year_completed + 5", () => {
    const result = deriveBlock(makeBlock({ yearCompleted: 2021 }), [], context);
    expect(result.mop_status).toBe("estimated");
    expect(result.mop_date).toBeNull();
    expect(result.mop_year).toBe(2026);
    expect(result.months_since_mop).toBe(2);
    expect(result.cohort).toBe("just_mopped");
    expect(result.first_transaction_month).toBeNull();
    expect(result.first_transaction_at_data_start).toBe(false);
    expect(result.transaction_count).toBe(0);
    expect(result.last_12mo_transaction_count).toBe(0);
    expect(result.resale_activity).toBe("none");
    expect(result.median_price_12mo).toEqual({});
  });

  it("classes an estimate within 24 months ahead as upcoming", () => {
    const result = deriveBlock(makeBlock({ yearCompleted: 2023 }), [], context);
    expect(result.months_since_mop).toBe(-22);
    expect(result.cohort).toBe("upcoming");
  });

  it("classes an estimate more than 24 months ahead as later", () => {
    const result = deriveBlock(makeBlock({ yearCompleted: 2024 }), [], context);
    expect(result.months_since_mop).toBe(-34);
    expect(result.cohort).toBe("later");
  });

  it("classes an old block that has never resold as mature", () => {
    const result = deriveBlock(makeBlock({ yearCompleted: 1994 }), [], context);
    expect(result.mop_status).toBe("estimated");
    expect(result.cohort).toBe("mature");
  });
});

describe("deriveBlock · confirmed", () => {
  it("uses the earliest resale as mop_date regardless of input order", () => {
    const result = deriveBlock(
      makeBlock({ yearCompleted: 2020 }),
      [sale("2026-05"), sale("2025-12"), sale("2026-02")],
      context,
    );
    expect(result.mop_status).toBe("confirmed");
    expect(result.mop_date).toBe("2025-12");
    expect(result.first_transaction_month).toBe("2025-12");
    expect(result.transaction_count).toBe(3);
  });

  it("measures months_since_mop from a first resale that closely follows the estimate", () => {
    // Estimate 2025-07, first resale 2025-12.
    const result = deriveBlock(makeBlock({ yearCompleted: 2020 }), [sale("2025-12")], context);
    expect(result.months_since_mop).toBe(9);
    expect(result.cohort).toBe("just_mopped");
  });

  it("keeps a 2019 block first resold in Nov 2024 in just_mopped instead of ageing it to the estimate", () => {
    // Estimate 2024-07 is 26 months back; the first resale, 22 months back, is the better signal.
    const result = deriveBlock(makeBlock({ yearCompleted: 2019 }), [sale("2024-11")], context);
    expect(result.months_since_mop).toBe(22);
    expect(result.cohort).toBe("just_mopped");
  });

  it("switches to the estimate once the first resale lags it by 24 months", () => {
    // Estimate 2020-07. A first resale 23 months later is used; 24 months later is not.
    const within = deriveBlock(makeBlock({ yearCompleted: 2015 }), [sale("2022-06")], context);
    const beyond = deriveBlock(makeBlock({ yearCompleted: 2015 }), [sale("2022-07")], context);
    expect(within.months_since_mop).toBe(parseMonth("2026-09") - parseMonth("2022-06"));
    expect(beyond.months_since_mop).toBe(parseMonth("2026-09") - parseMonth("2020-07"));
  });

  it("does not class an old, thinly traded block as just_mopped because of a late first resale", () => {
    // Real case: 115 ALJUNIED AVE 2, completed 1978, first resale on record 2025-10.
    const result = deriveBlock(makeBlock({ yearCompleted: 1978 }), [sale("2025-10")], context);
    expect(result.mop_status).toBe("confirmed");
    expect(result.mop_date).toBe("2025-10");
    expect(result.cohort).toBe("mature");
  });

  it("lets a first resale earlier than the estimate win, since it is hard evidence", () => {
    // Real case: 440C CLEMENTI AVE 3, completed 2017 (estimate 2022-07), first resale 2020-07.
    const result = deriveBlock(makeBlock({ yearCompleted: 2017 }), [sale("2020-07")], context);
    expect(result.months_since_mop).toBe(parseMonth("2026-09") - parseMonth("2020-07"));
    expect(result.cohort).toBe("mature");
  });

  it("never classes a confirmed block as upcoming, even when the estimate is in the future", () => {
    const result = deriveBlock(makeBlock({ yearCompleted: 2022 }), [sale("2026-08")], context);
    expect(result.months_since_mop).toBe(1);
    expect(result.cohort).toBe("just_mopped");
  });

  it("flags a first resale in the first three months of resale data", () => {
    const atStart = deriveBlock(makeBlock({ yearCompleted: 1985 }), [sale("2017-03")], context);
    const afterStart = deriveBlock(makeBlock({ yearCompleted: 1985 }), [sale("2017-04")], context);
    expect(atStart.first_transaction_at_data_start).toBe(true);
    expect(afterStart.first_transaction_at_data_start).toBe(false);
  });

  it("rejects transactions after the latest resale month", () => {
    const early = { currentMonth: parseMonth("2026-09"), latestResaleMonth: parseMonth("2026-06") };
    expect(() => deriveBlock(makeBlock(), [sale("2026-07")], early)).toThrow(/after the latest resale month/);
  });
});

describe("deriveBlock · last 12 months", () => {
  it("counts resales in the 12 months ending at the latest resale month, inclusive", () => {
    const result = deriveBlock(
      makeBlock(),
      [sale("2025-09"), sale("2025-10"), sale("2026-09"), sale("2019-01")],
      context,
    );
    expect(result.transaction_count).toBe(4);
    expect(result.last_12mo_transaction_count).toBe(2);
  });

  it("computes median transacted price and count per flat type within the window only", () => {
    const result = deriveBlock(
      makeBlock(),
      [
        sale("2026-01", "4room", 500_000),
        sale("2026-02", "4room", 700_000),
        sale("2026-03", "4room", 600_000),
        sale("2026-04", "5room", 800_000),
        sale("2026-05", "5room", 801_001),
        sale("2025-09", "3room", 400_000),
      ],
      context,
    );
    expect(result.median_price_12mo).toEqual({
      "4room": { median: 600_000, count: 3 },
      "5room": { median: 800_501, count: 2 },
    });
  });

  it.each([
    [0, "none"],
    [1, "light"],
    [4, "light"],
    [5, "active"],
    [20, "active"],
  ] as const)("%i resales in 12 months → %s", (count, activity) => {
    expect(resaleActivityFor(count)).toBe(activity);
  });
});

describe("deriveBlock · composition", () => {
  it("reports only non-zero flat types, in canonical order", () => {
    const result = deriveBlock(
      makeBlock({
        sold: { "1room": 0, "2room": 5, "3room": 0, "4room": 60, "5room": 0, executive: 10, multigen: 0, studio: 0 },
      }),
      [],
      context,
    );
    expect(Object.entries(result.flat_type_mix)).toEqual([
      ["2room", 5],
      ["4room", 60],
      ["executive", 10],
    ]);
    expect(result.sold_units).toBe(75);
  });

  it("sets has_rental_units when any rental count is positive", () => {
    const withRental = deriveBlock(makeBlock({ rental: { oneRoom: 0, twoRoom: 0, threeRoom: 0, other: 3 } }), [], context);
    const withoutRental = deriveBlock(makeBlock(), [], context);
    expect(withRental.has_rental_units).toBe(true);
    expect(withRental.rental_units).toBe(3);
    expect(withoutRental.has_rental_units).toBe(false);
  });
});

describe("block identity", () => {
  it("joins block + street case- and whitespace-insensitively", () => {
    expect(blockKey(" 123a ", "anchorvale   rd")).toBe(blockKey("123A", "ANCHORVALE RD"));
    expect(blockKey("123A", "ANCHORVALE RD")).not.toBe(blockKey("123", "ANCHORVALE RD"));
  });

  it("builds URL-safe ids", () => {
    expect(blockId("12", "ST. GEORGE'S RD")).toBe("12-st-george-s-rd");
    expect(blockId("440C", "CLEMENTI AVE 3")).toBe("440c-clementi-ave-3");
  });
});

describe("median", () => {
  it("handles odd and even lengths without mutating input", () => {
    const values = [3, 1, 2];
    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("throws on an empty list", () => {
    expect(() => median([])).toThrow();
  });
});
