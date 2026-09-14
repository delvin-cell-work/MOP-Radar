import { haversineKm, isInSingapore, type LatLng } from "./geo";

/** From the product brief: coarse and fast, and a cached fix up to 10 minutes old is fine. */
export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 5000,
  maximumAge: 600000,
};

export type LocationFailure = "insecure" | "unsupported" | "denied" | "unavailable" | "timeout" | "outside_singapore";

export const LOCATING_MESSAGE = "Finding your nearest town… or pick one below.";

/** Shown when the visitor has gone back from a town to browse all towns. */
export const BROWSE_TOWNS_MESSAGE = "Pick a town to see its blocks.";

/** One-line explainer above the town picker. Never an error toast. */
export const LOCATION_FAILURE_MESSAGES: Record<LocationFailure, string> = {
  insecure: "Pick a town below to see its blocks.",
  unsupported: "Pick a town below to see its blocks.",
  denied: "Location access is off. Pick a town below to see its blocks.",
  unavailable: "We couldn't find your location. Pick a town below.",
  timeout: "Finding your location took too long. Pick a town below.",
  outside_singapore: "You seem to be outside Singapore. Pick a town below.",
};

/**
 * The town whose centre is nearest by great-circle distance, or null when the
 * point is outside Singapore's bounding box (or not a number). Ties keep the
 * earlier town in the table.
 */
export function nearestTown<T extends { center: LatLng }>(point: LatLng, towns: readonly T[]): T | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !isInSingapore(point)) return null;
  let nearest: T | null = null;
  let nearestKm = Infinity;
  for (const town of towns) {
    const km = haversineKm(point, town.center);
    if (km < nearestKm) {
      nearest = town;
      nearestKm = km;
    }
  }
  return nearest;
}

/** GeolocationPositionError codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT. */
export function failureFromPositionError(code: number): LocationFailure {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

/** Why geolocation can't even be attempted. iOS Safari blocks it outright on non-HTTPS pages. */
export function locationSupportFailure(environment: {
  isSecureContext: boolean;
  hasGeolocation: boolean;
}): LocationFailure | null {
  if (!environment.isSecureContext) return "insecure";
  if (!environment.hasGeolocation) return "unsupported";
  return null;
}

export function detectBrowserLocationFailure(): LocationFailure | null {
  if (typeof window === "undefined") return null;
  return locationSupportFailure({
    isSecureContext: window.isSecureContext !== false,
    hasGeolocation: typeof navigator.geolocation?.getCurrentPosition === "function",
  });
}
