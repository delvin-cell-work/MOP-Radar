import type { Cohort } from "./data-contract";

/** MOP status colours for map dots, legend and cards. Never encode price or value in colour. */
export const COHORT_COLORS: Record<Cohort, string> = {
  just_mopped: "#0f766e",
  upcoming: "#c2410c",
  mature: "#64748b",
  later: "#7c3aed",
};

export const COHORT_LEGEND: Record<Cohort, string> = {
  just_mopped: "Passed MOP in the last 24 months",
  upcoming: "MOP in the next 24 months",
  mature: "Passed MOP 2+ years ago",
  later: "MOP more than 2 years away",
};
