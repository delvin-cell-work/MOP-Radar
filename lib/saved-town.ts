import { townBySlug } from "./towns";

/**
 * The visitor's town, persisted in localStorage so repeat visits skip the
 * location prompt. Shaped for useSyncExternalStore. Falls back to memory when
 * storage is unavailable (private browsing, blocked site data).
 */

const STORAGE_KEY = "mop-radar:town";
const CHANGE_EVENT = "mop-radar:town-change";

export type TownSource = "geolocation" | "manual";

interface SavedTown {
  slug: string;
  source: TownSource;
  savedAt: string;
}

let memoryFallback: string | null = null;

export function parseSavedTown(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedTown> | null;
    return value && typeof value.slug === "string" && townBySlug(value.slug) ? value.slug : null;
  } catch {
    return null;
  }
}

export function readSavedTownSlug(): string | null {
  try {
    return parseSavedTown(window.localStorage.getItem(STORAGE_KEY)) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

export function saveTown(slug: string, source: TownSource): void {
  const record: SavedTown = { slug, source, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    memoryFallback = null;
  } catch {
    memoryFallback = slug;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToSavedTown(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
