import { townBySlug } from "./towns";

/** Stored per block with its town, so the watchlist can load each town's data file. */
export interface WatchlistEntry {
  id: string;
  town: string;
  addedAt: string;
}

/** Block ids are lowercase slugs, e.g. "622b-tampines-ave-12". */
export const BLOCK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseWatchlist(value: unknown): WatchlistEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: WatchlistEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, town, addedAt } = item as Record<string, unknown>;
    if (typeof id !== "string" || !BLOCK_ID_PATTERN.test(id) || seen.has(id)) continue;
    if (typeof town !== "string" || !townBySlug(town)) continue;
    seen.add(id);
    entries.push({ id, town, addedAt: typeof addedAt === "string" ? addedAt : "" });
  }
  return entries;
}

export function isWatched(entries: readonly WatchlistEntry[], id: string): boolean {
  return entries.some((entry) => entry.id === id);
}

/** Removes the block if it's watched; otherwise adds it to the top. */
export function toggleWatched(
  entries: readonly WatchlistEntry[],
  block: { id: string; town: string },
  addedAt: string,
): WatchlistEntry[] {
  if (isWatched(entries, block.id)) return entries.filter((entry) => entry.id !== block.id);
  return [{ id: block.id, town: block.town, addedAt }, ...entries];
}
