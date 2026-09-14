export interface LatLng {
  lat: number;
  lng: number;
}

/** Bounding box used to decide whether a coordinate is in Singapore. */
export const SINGAPORE_BOUNDS = { south: 1.15, north: 1.48, west: 103.6, east: 104.1 } as const;

/** The main island, for framing the national map view (SINGAPORE_BOUNDS includes open sea). */
export const SINGAPORE_ISLAND_BOUNDS = { south: 1.236, north: 1.471, west: 103.605, east: 104.03 } as const;

const EARTH_RADIUS_KM = 6371.0088;

export function isInSingapore({ lat, lng }: LatLng): boolean {
  return (
    lat >= SINGAPORE_BOUNDS.south &&
    lat <= SINGAPORE_BOUNDS.north &&
    lng >= SINGAPORE_BOUNDS.west &&
    lng <= SINGAPORE_BOUNDS.east
  );
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Component-wise median: robust to a few stray points, unlike the mean. */
export function medianPoint(points: readonly LatLng[]): LatLng {
  if (points.length === 0) throw new Error("medianPoint() of an empty list");
  return { lat: medianOf(points.map((point) => point.lat)), lng: medianOf(points.map((point) => point.lng)) };
}
