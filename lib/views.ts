import { COHORTS, type Cohort, type TownSummary } from "./data-contract";
import { haversineKm } from "./geo";

export type ResultsView = "just_mopped" | "upcoming" | "all";

export interface ResultsViewOption {
  value: ResultsView;
  label: string;
  cohorts: readonly Cohort[];
}

export const RESULTS_VIEWS: readonly ResultsViewOption[] = [
  { value: "just_mopped", label: "Just passed MOP", cohorts: ["just_mopped"] },
  { value: "upcoming", label: "Coming up", cohorts: ["upcoming"] },
  { value: "all", label: "All", cohorts: COHORTS },
];

export const DEFAULT_VIEW: ResultsView = "just_mopped";

export function viewOption(view: ResultsView): ResultsViewOption {
  const option = RESULTS_VIEWS.find((candidate) => candidate.value === view);
  if (!option) throw new Error(`Unknown results view "${view}"`);
  return option;
}

export function blockMatchesView(block: { cohort: Cohort }, view: ResultsView): boolean {
  return viewOption(view).cohorts.includes(block.cohort);
}

export function townCountForView(town: Pick<TownSummary, "cohorts">, view: ResultsView): number {
  return viewOption(view).cohorts.reduce((sum, cohort) => sum + town.cohorts[cohort], 0);
}

/**
 * just_mopped: most recent MOP first · upcoming: soonest MOP first ·
 * all: closest to MOP in either direction first.
 */
export function sortBlocksForView<T extends { months_since_mop: number; id: string }>(
  blocks: readonly T[],
  view: ResultsView,
): T[] {
  const key = (block: T) =>
    view === "just_mopped"
      ? block.months_since_mop
      : view === "upcoming"
        ? -block.months_since_mop
        : Math.abs(block.months_since_mop);
  return [...blocks].sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
}

export interface NeighbouringTown {
  slug: string;
  name: string;
  count: number;
  km: number;
}

/** Nearest other towns (centre to centre) that have results, counted by `countFor`. */
export function neighbouringTowns(
  towns: readonly TownSummary[],
  fromSlug: string,
  countFor: (town: TownSummary) => number,
  limit = 3,
): NeighbouringTown[] {
  const from = towns.find((town) => town.slug === fromSlug);
  if (!from) return [];
  return towns
    .filter((town) => town.slug !== fromSlug)
    .map((town) => ({
      slug: town.slug,
      name: town.name,
      count: countFor(town),
      km: haversineKm(from.center, town.center),
    }))
    .filter((town) => town.count > 0)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
