import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  cohortsForView,
  DEFAULT_FILTERS,
  filterableBlock,
  matchesFilters,
  matchesView,
  matchesViewAndFilters,
  nextWiderWindow,
  parseFilters,
  type FilterableBlock,
  type Filters,
} from "../lib/filters";
import { flatTypeMask } from "../lib/flat-types";

const YEAR = 2026;

function block(overrides: Partial<FilterableBlock> = {}): FilterableBlock {
  return {
    monthsSinceMop: 3,
    yearCompleted: 2021,
    flatTypeMask: flatTypeMask({ "4room": 60, "5room": 20 }),
    hasRentalUnits: false,
    activity: "light",
    ...overrides,
  };
}

const withFilters = (overrides: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...overrides });

describe("matchesView", () => {
  it.each([
    ["just_mopped", 0, 24, true],
    ["just_mopped", 23, 24, true],
    ["just_mopped", 24, 24, false],
    ["just_mopped", -1, 24, false],
    ["just_mopped", 30, 36, true],
    ["just_mopped", 6, 6, false],
    ["upcoming", -1, 24, true],
    ["upcoming", -24, 24, true],
    ["upcoming", -25, 24, false],
    ["upcoming", 0, 24, false],
    ["upcoming", -6, 6, true],
    ["upcoming", -7, 6, false],
    ["all", 500, 6, true],
    ["all", -500, 6, true],
  ] as const)("%s, %i months since MOP, %i-month window → %s", (view, months, window, expected) => {
    expect(matchesView(months, view, window)).toBe(expected);
  });
});

describe("cohortsForView", () => {
  it("loads only the matching cohort within 24 months", () => {
    expect(cohortsForView("just_mopped", 24)).toEqual(["just_mopped"]);
    expect(cohortsForView("upcoming", 12)).toEqual(["upcoming"]);
  });

  it("adds the neighbouring cohort once the window reaches past 24 months", () => {
    expect(cohortsForView("just_mopped", 36)).toEqual(["just_mopped", "mature"]);
    expect(cohortsForView("upcoming", 60)).toEqual(["upcoming", "later"]);
  });

  it("loads every cohort for all blocks", () => {
    expect(cohortsForView("all", 6)).toEqual(["upcoming", "just_mopped", "mature", "later"]);
  });
});

describe("matchesFilters", () => {
  it("keeps every block with default filters", () => {
    expect(matchesFilters(block(), DEFAULT_FILTERS, YEAR)).toBe(true);
  });

  it("keeps blocks with any of the chosen flat types", () => {
    expect(matchesFilters(block(), withFilters({ flatTypes: ["3room", "5room"] }), YEAR)).toBe(true);
    expect(matchesFilters(block(), withFilters({ flatTypes: ["3room"] }), YEAR)).toBe(false);
  });

  it("hides blocks that contain the excluded flat type", () => {
    expect(matchesFilters(block(), withFilters({ excludeFlatType: "5room" }), YEAR)).toBe(false);
    expect(matchesFilters(block(), withFilters({ excludeFlatType: "3room" }), YEAR)).toBe(true);
  });

  it("hides blocks with rental flats only when asked", () => {
    const rental = block({ hasRentalUnits: true });
    expect(matchesFilters(rental, withFilters({ excludeRental: true }), YEAR)).toBe(false);
    expect(matchesFilters(rental, DEFAULT_FILTERS, YEAR)).toBe(true);
  });

  it.each([
    [2021, "under-10", true],
    [2016, "under-10", false],
    [2016, "10-20", true],
    [2007, "10-20", true],
    [2006, "20-30", true],
    [1997, "20-30", true],
    [1996, "over-30", true],
    [1997, "over-30", false],
  ] as const)("completed %i with block age %s → %s", (yearCompleted, blockAge, expected) => {
    expect(matchesFilters(block({ yearCompleted }), withFilters({ blockAge }), YEAR)).toBe(expected);
  });

  it("keeps only the chosen resale activity levels", () => {
    expect(matchesFilters(block({ activity: "light" }), withFilters({ activity: ["active"] }), YEAR)).toBe(false);
    expect(matchesFilters(block({ activity: "light" }), withFilters({ activity: ["none", "light"] }), YEAR)).toBe(true);
  });

  it("requires every filter to pass", () => {
    const filters = withFilters({ flatTypes: ["4room"], excludeRental: true, blockAge: "under-10", activity: ["light"] });
    expect(matchesFilters(block(), filters, YEAR)).toBe(true);
    expect(matchesFilters(block({ hasRentalUnits: true }), filters, YEAR)).toBe(false);
  });
});

describe("matchesViewAndFilters", () => {
  it("applies the MOP window from the filters", () => {
    const passed30MonthsAgo = block({ monthsSinceMop: 30 });
    expect(matchesViewAndFilters(passed30MonthsAgo, "just_mopped", DEFAULT_FILTERS, YEAR)).toBe(false);
    expect(matchesViewAndFilters(passed30MonthsAgo, "just_mopped", withFilters({ mopWindowMonths: 36 }), YEAR)).toBe(true);
  });
});

describe("filterableBlock", () => {
  it("reads the filter fields from a derived block", () => {
    expect(
      filterableBlock({
        months_since_mop: -4,
        year_completed: 2022,
        flat_type_mix: { "3room": 10, executive: 4 },
        has_rental_units: true,
        resale_activity: "none",
      } as Parameters<typeof filterableBlock>[0]),
    ).toEqual({
      monthsSinceMop: -4,
      yearCompleted: 2022,
      flatTypeMask: flatTypeMask({ "3room": 10, executive: 4 }),
      hasRentalUnits: true,
      activity: "none",
    });
  });
});

describe("activeFilterCount", () => {
  it("counts changed filter groups", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        flatTypes: ["4room"],
        excludeFlatType: "1room",
        excludeRental: true,
        mopWindowMonths: 12,
        blockAge: "under-10",
        activity: ["active"],
      }),
    ).toBe(6);
  });
});

describe("nextWiderWindow", () => {
  it.each([
    [6, 12],
    [24, 36],
    [48, 60],
    [60, null],
  ])("%i months → %s", (window, next) => {
    expect(nextWiderWindow(window)).toBe(next);
  });
});

describe("parseFilters", () => {
  it.each([null, "4room", 42, [], undefined])("falls back to defaults for %j", (value) => {
    expect(parseFilters(value)).toEqual(DEFAULT_FILTERS);
  });

  it("round-trips valid filters", () => {
    const filters: Filters = {
      flatTypes: ["4room", "5room"],
      excludeFlatType: "2room",
      excludeRental: true,
      mopWindowMonths: 36,
      blockAge: "10-20",
      activity: ["none"],
    };
    expect(parseFilters(JSON.parse(JSON.stringify(filters)))).toEqual(filters);
  });

  it("drops unknown or repeated values and resets invalid ones", () => {
    expect(
      parseFilters({
        flatTypes: ["4room", "penthouse", "4room"],
        excludeFlatType: "castle",
        excludeRental: "yes",
        mopWindowMonths: 25,
        blockAge: "ancient",
        activity: ["busy", "active"],
      }),
    ).toEqual({ ...DEFAULT_FILTERS, flatTypes: ["4room"], activity: ["active"] });
  });
});
