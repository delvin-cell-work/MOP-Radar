/**
 * Flat types in canonical display order. `resaleLabel` is Dataset B's
 * flat_type value; studio apartments never appear in resale data.
 */
export const FLAT_TYPES = [
  { key: "1room", label: "1-Room", resaleLabel: "1 ROOM" },
  { key: "2room", label: "2-Room", resaleLabel: "2 ROOM" },
  { key: "3room", label: "3-Room", resaleLabel: "3 ROOM" },
  { key: "4room", label: "4-Room", resaleLabel: "4 ROOM" },
  { key: "5room", label: "5-Room", resaleLabel: "5 ROOM" },
  { key: "executive", label: "Executive", resaleLabel: "EXECUTIVE" },
  { key: "multigen", label: "Multi-Generation", resaleLabel: "MULTI-GENERATION" },
  { key: "studio", label: "Studio Apartment", resaleLabel: null },
] as const;

export type FlatType = (typeof FLAT_TYPES)[number];
export type FlatTypeKey = FlatType["key"];
export type ResaleFlatType = Extract<FlatType, { resaleLabel: string }>;
export type ResaleFlatTypeKey = ResaleFlatType["key"];

export const RESALE_FLAT_TYPES: readonly ResaleFlatType[] = FLAT_TYPES.filter(
  (type): type is ResaleFlatType => type.resaleLabel !== null,
);

const BY_RESALE_LABEL = new Map<string, ResaleFlatTypeKey>(
  RESALE_FLAT_TYPES.map((type) => [type.resaleLabel, type.key]),
);

export function resaleFlatTypeByLabel(label: string): ResaleFlatTypeKey | undefined {
  return BY_RESALE_LABEL.get(label);
}

/** Bit i is set when FLAT_TYPES[i] has sold units. Used by the compact map files. */
export function flatTypeMask(mix: Partial<Record<FlatTypeKey, number>>): number {
  return FLAT_TYPES.reduce((mask, type, index) => ((mix[type.key] ?? 0) > 0 ? mask | (1 << index) : mask), 0);
}

export function maskHasFlatType(mask: number, key: FlatTypeKey): boolean {
  const index = FLAT_TYPES.findIndex((type) => type.key === key);
  return index >= 0 && (mask & (1 << index)) !== 0;
}
