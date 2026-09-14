import {
  DATA_SCHEMA_VERSION,
  type Cohort,
  type DataMeta,
  type LocationPrecision,
  type MapPointsFile,
  type MopStatus,
  type ResaleActivity,
  type TownBlocksFile,
} from "./data-contract";

/**
 * Browser-side loaders for the static JSON in public/data/. Requests are
 * shared and cached for the session; a failed request is dropped from the
 * cache so a retry fetches again.
 */

export const dataUrl = {
  meta: () => "/data/meta.json",
  town: (slug: string) => `/data/towns/${slug}.json`,
  map: (cohort: Cohort) => `/data/map/${cohort}.json`,
};

const requests = new Map<string, Promise<unknown>>();

function loadJson<T extends { schema_version: number }>(url: string): Promise<T> {
  const cached = requests.get(url);
  if (cached) return cached as Promise<T>;

  const request = fetch(url)
    .catch(() => {
      throw new Error("Couldn't reach MOP Radar. Check your connection and try again.");
    })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Couldn't load results (HTTP ${response.status}).`);
      const data = (await response.json()) as T;
      if (data.schema_version !== DATA_SCHEMA_VERSION) {
        throw new Error("Results data has changed since this page loaded. Reload the page.");
      }
      return data;
    });

  requests.set(url, request);
  request.catch(() => requests.delete(url));
  return request;
}

export const loadMeta = () => loadJson<DataMeta>(dataUrl.meta());
export const loadTownBlocks = (slug: string) => loadJson<TownBlocksFile>(dataUrl.town(slug));
export const loadMapCohort = (cohort: Cohort) => loadJson<MapPointsFile>(dataUrl.map(cohort));

export interface MapBlock {
  id: string;
  townCode: string;
  lat: number;
  lng: number;
  cohort: Cohort;
  status: MopStatus;
  monthsSinceMop: number;
  yearCompleted: number;
  flatTypeMask: number;
  hasRentalUnits: boolean;
  activity: ResaleActivity;
  precision: LocationPrecision;
}

export function decodeMapPoints(file: MapPointsFile): MapBlock[] {
  return file.points.map(
    ([id, townCode, lat, lng, status, monthsSinceMop, yearCompleted, flatTypeMask, hasRentalUnits, activity, precision]) => ({
      id,
      townCode,
      lat,
      lng,
      cohort: file.cohort,
      status,
      monthsSinceMop,
      yearCompleted,
      flatTypeMask,
      hasRentalUnits: hasRentalUnits === 1,
      activity,
      precision,
    }),
  );
}
