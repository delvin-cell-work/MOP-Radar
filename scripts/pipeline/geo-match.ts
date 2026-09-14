import type { LocationPrecision } from "../../lib/data-contract";
import { haversineKm, medianPoint, type LatLng } from "../../lib/geo";
import { blockKey, normaliseName, type BlockInput } from "../../lib/mop";
import type { BuildingGeometry } from "./schemas";

/**
 * Places blocks on the map using HDB Existing Building footprints.
 *
 * Footprints identify streets by code ("TOP02W") while HDB Property Information
 * uses abbreviated names ("LOR 1 TOA PAYOH"), and no public table links them.
 * Each code is matched to the street whose block numbers contain the code's
 * block numbers. Candidates are gated on the code's first letter, which is the
 * initial of one of the street's words (codes skip words such as JALAN and
 * LORONG, so "JLN BT MERAH" is BUM03D). A match whose buildings sit outside
 * that street's town is rejected.
 *
 * Sep 2026: 653 of 660 codes matched, 99.7% of eligible blocks placed at their
 * own footprint, none outside their town.
 */

export interface Building extends LatLng {
  /** Normalised block number. */
  blkNo: string;
  streetCode: string;
}

export interface Street {
  /** Normalised street name. */
  name: string;
  townCode: string;
  blocks: ReadonlySet<string>;
}

/** Share of a code's block numbers that must exist on the matched street. */
export const MIN_CONTAINMENT = 0.8;
export const TOWN_RADIUS_PERCENTILE = 0.95;
export const TOWN_RADIUS_SLACK_KM = 1.5;

export type RejectionReason = "no_candidate" | "tie" | "low_containment" | "outside_town";

export interface StreetCodeRejection {
  code: string;
  reason: RejectionReason;
  closest: string | null;
  buildings: number;
}

export interface StreetCodeMatch {
  codes: number;
  streetByCode: Map<string, string>;
  rejected: StreetCodeRejection[];
}

export interface LocatedBlock extends LatLng {
  precision: LocationPrecision;
}

/** First letter of each word that doesn't start with a digit. A street code starts with one of these. */
export function streetInitials(street: string): Set<string> {
  const initials = new Set<string>();
  for (const word of normaliseName(street).split(" ")) {
    const first = word.charAt(0);
    if (first >= "A" && first <= "Z") initials.add(first);
  }
  return initials;
}

/** Groups Property Information blocks into streets; a street's town is its most common town code. */
export function buildStreets(blocks: readonly Pick<BlockInput, "blkNo" | "street" | "townCode">[]): Street[] {
  const byName = new Map<string, { blocks: Set<string>; towns: Map<string, number> }>();
  for (const block of blocks) {
    const name = normaliseName(block.street);
    const entry = byName.get(name) ?? { blocks: new Set<string>(), towns: new Map<string, number>() };
    entry.blocks.add(normaliseName(block.blkNo));
    entry.towns.set(block.townCode, (entry.towns.get(block.townCode) ?? 0) + 1);
    byName.set(name, entry);
  }
  return [...byName].map(([name, entry]) => ({
    name,
    blocks: entry.blocks,
    townCode: [...entry.towns].sort((a, b) => b[1] - a[1])[0][0],
  }));
}

/** Vertex average of the outer ring; for a MultiPolygon, of the ring with the most vertices. */
export function polygonCentroid(geometry: BuildingGeometry): LatLng {
  const rings =
    geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((polygon) => polygon[0]);
  const ring = rings.reduce((largest, candidate) => (candidate.length > largest.length ? candidate : largest));
  const first = ring[0];
  const last = ring[ring.length - 1];
  const vertices = first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  let lat = 0;
  let lng = 0;
  for (const position of vertices) {
    lng += position[0];
    lat += position[1];
  }
  return { lat: lat / vertices.length, lng: lng / vertices.length };
}

interface Candidate {
  street: Street;
  containment: number;
  jaccard: number;
}

function rankCandidates(
  code: string,
  blocks: ReadonlySet<string>,
  streetsByBlock: ReadonlyMap<string, Street[]>,
): Candidate[] {
  const initial = code.charAt(0);
  const seen = new Set<Street>();
  const candidates: Candidate[] = [];
  for (const blkNo of blocks) {
    for (const street of streetsByBlock.get(blkNo) ?? []) {
      if (seen.has(street)) continue;
      seen.add(street);
      if (!streetInitials(street.name).has(initial)) continue;
      let shared = 0;
      for (const candidateBlock of blocks) if (street.blocks.has(candidateBlock)) shared++;
      candidates.push({
        street,
        containment: shared / blocks.size,
        jaccard: shared / (blocks.size + street.blocks.size - shared),
      });
    }
  }
  return candidates.sort((a, b) => b.containment - a.containment || b.jaccard - a.jaccard);
}

export function matchStreetCodes(buildings: readonly Building[], streets: readonly Street[]): StreetCodeMatch {
  const streetsByBlock = new Map<string, Street[]>();
  for (const street of streets) {
    for (const blkNo of street.blocks) {
      const list = streetsByBlock.get(blkNo);
      if (list) list.push(street);
      else streetsByBlock.set(blkNo, [street]);
    }
  }

  const buildingsByCode = new Map<string, Building[]>();
  for (const building of buildings) {
    const group = buildingsByCode.get(building.streetCode);
    if (group) group.push(building);
    else buildingsByCode.set(building.streetCode, [building]);
  }

  const rejected: StreetCodeRejection[] = [];
  const provisional: { code: string; street: Street; group: Building[] }[] = [];
  for (const [code, group] of buildingsByCode) {
    const candidates = rankCandidates(code, new Set(group.map((building) => building.blkNo)), streetsByBlock);
    const best = candidates[0] as Candidate | undefined;
    const runnerUp = candidates[1] as Candidate | undefined;
    const reject = (reason: RejectionReason) =>
      rejected.push({ code, reason, closest: best ? best.street.name : null, buildings: group.length });

    if (!best) reject("no_candidate");
    else if (runnerUp && runnerUp.containment === best.containment && runnerUp.jaccard === best.jaccard) reject("tie");
    else if (best.containment < MIN_CONTAINMENT) reject("low_containment");
    else provisional.push({ code, street: best.street, group });
  }

  // Each town's extent from all provisional matches, so a code matched to a
  // street in the wrong part of Singapore stands out.
  const pointsByTown = new Map<string, LatLng[]>();
  for (const { street, group } of provisional) {
    const points = pointsByTown.get(street.townCode) ?? [];
    for (const building of group) if (street.blocks.has(building.blkNo)) points.push(building);
    pointsByTown.set(street.townCode, points);
  }
  const townAreas = new Map<string, { center: LatLng; radiusKm: number }>();
  for (const [townCode, points] of pointsByTown) {
    if (points.length === 0) continue;
    const center = medianPoint(points);
    const distances = points.map((point) => haversineKm(center, point)).sort((a, b) => a - b);
    townAreas.set(townCode, {
      center,
      radiusKm: distances[Math.floor(TOWN_RADIUS_PERCENTILE * (distances.length - 1))],
    });
  }

  const streetByCode = new Map<string, string>();
  for (const { code, street, group } of provisional) {
    const area = townAreas.get(street.townCode);
    if (area && haversineKm(area.center, medianPoint(group)) > area.radiusKm + TOWN_RADIUS_SLACK_KM) {
      rejected.push({ code, reason: "outside_town", closest: street.name, buildings: group.length });
      continue;
    }
    streetByCode.set(code, street.name);
  }

  rejected.sort((a, b) => a.code.localeCompare(b.code));
  return { codes: buildingsByCode.size, streetByCode, rejected };
}

/**
 * Locates each block at its own footprint, or failing that at the median of
 * located blocks on the same street (typically a block completed after the
 * footprint data was last updated). Keys are blockKey(blkNo, street).
 */
export function locateBlocks(
  blocks: readonly Pick<BlockInput, "blkNo" | "street">[],
  buildings: readonly Building[],
  streetByCode: ReadonlyMap<string, string>,
): { locations: Map<string, LocatedBlock>; duplicateFootprints: number } {
  const footprints = new Map<string, LatLng>();
  let duplicateFootprints = 0;
  for (const building of buildings) {
    const street = streetByCode.get(building.streetCode);
    if (!street) continue;
    const key = blockKey(building.blkNo, street);
    if (footprints.has(key)) duplicateFootprints++;
    else footprints.set(key, { lat: building.lat, lng: building.lng });
  }

  const locations = new Map<string, LocatedBlock>();
  const placedByStreet = new Map<string, LatLng[]>();
  for (const block of blocks) {
    const key = blockKey(block.blkNo, block.street);
    const footprint = footprints.get(key);
    if (!footprint) continue;
    locations.set(key, { ...footprint, precision: "block" });
    const street = normaliseName(block.street);
    const placed = placedByStreet.get(street) ?? [];
    placed.push(footprint);
    placedByStreet.set(street, placed);
  }

  for (const block of blocks) {
    const key = blockKey(block.blkNo, block.street);
    if (locations.has(key)) continue;
    const placed = placedByStreet.get(normaliseName(block.street));
    if (placed) locations.set(key, { ...medianPoint(placed), precision: "street" });
  }

  return { locations, duplicateFootprints };
}
