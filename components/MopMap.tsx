"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useRef } from "react";

import { COHORT_COLORS } from "@/lib/cohort-style";
import type { Cohort } from "@/lib/data-contract";
import type { MapBlock } from "@/lib/data-client";
import { SINGAPORE_BOUNDS, SINGAPORE_ISLAND_BOUNDS, type LatLng } from "@/lib/geo";

/** A request to frame part of Singapore. Applied when `key` changes. */
export interface MapFrame {
  key: string;
  /** Points to fit, or null for the whole island. */
  points: readonly LatLng[] | null;
  /** Where to centre when there are no points, e.g. a town with no results in this tab. */
  center?: LatLng;
}

/** A request to pan to one block. Applied when `key` changes. */
export interface MapBlockFocus {
  key: string;
  center: LatLng;
}

export interface TownMarker {
  slug: string;
  name: string;
  center: LatLng;
  count: number;
  active: boolean;
}

interface MopMapProps {
  blocks: readonly MapBlock[];
  towns: readonly TownMarker[];
  frame: MapFrame | null;
  blockFocus: MapBlockFocus | null;
  selectedId: string | null;
  /** Share of the map's height hidden behind the results sheet (0 on desktop). */
  bottomInsetFraction: number;
  onSelectBlock: (block: MapBlock) => void;
  onSelectTown: (slug: string) => void;
}

const TILE_URL = "https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png";
/** OneMap requires its logo and attribution on every map using its basemap. */
const ONEMAP_ATTRIBUTION =
  '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="" width="20" height="20" style="display:inline-block;height:20px;width:20px;vertical-align:middle" />&nbsp;' +
  '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a>&nbsp;&copy;&nbsp;contributors&nbsp;&#124;&nbsp;' +
  '<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>';
const LEAFLET_PREFIX = '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>';

/** OneMap Grey tiles exist from zoom 10 (whole island on a phone) to 19. */
const MIN_ZOOM = 10;
/** Side padding used when working out how far the map may zoom out. */
const MIN_ZOOM_PADDING_PX = 8;
const MAX_ZOOM = 19;
/** Town count bubbles show at this zoom and below; block dots show at every zoom. */
const TOWN_BUBBLE_MAX_ZOOM = 13;
const HIGHLIGHT_EXTRA_RADIUS = 6;
const NATIONAL_MAX_ZOOM = 12;
const TOWN_ZOOM = 14;
const BLOCK_ZOOM = 16;
const FIT_MAX_ZOOM = 16;
const FIT_PADDING_PX = 24;
/** Clears the map key in the top-left corner. */
const FIT_PADDING_TOP_PX = 60;
/** The whole-island view only needs to clear the top edge; the map key then overlaps open sea. */
const NATIONAL_PADDING_TOP_PX = 16;

/** Busier cohorts draw first so the ones buyers care about sit on top. */
const DRAW_ORDER: Record<Cohort, number> = { mature: 0, later: 1, upcoming: 2, just_mopped: 3 };

function dotRadius(zoom: number): number {
  if (zoom <= 12) return 3;
  if (zoom <= 14) return 4.5;
  if (zoom <= 16) return 6;
  return 8;
}

function dotStyle(block: MapBlock, radius: number, renderer: L.Canvas): L.CircleMarkerOptions {
  const color = COHORT_COLORS[block.cohort];
  const estimated = block.status === "estimated";
  const approximate = block.precision === "street";
  return {
    renderer,
    radius,
    color: estimated || approximate ? color : "#ffffff",
    weight: estimated || approximate ? 2 : 1,
    fillColor: estimated ? "#ffffff" : color,
    fillOpacity: 0.95,
    opacity: 1,
    dashArray: approximate ? "3 3" : undefined,
    bubblingMouseEvents: false,
  };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** Centre that puts `target` in the middle of the part of the map the sheet doesn't cover. */
function centerAbove(map: L.Map, target: LatLng, zoom: number, insetPx: number): L.LatLng {
  const point = map.project([target.lat, target.lng], zoom).add([0, insetPx / 2]);
  return map.unproject(point, zoom);
}

function islandBounds(): L.LatLngBounds {
  return L.latLngBounds(
    [SINGAPORE_ISLAND_BOUNDS.south, SINGAPORE_ISLAND_BOUNDS.west],
    [SINGAPORE_ISLAND_BOUNDS.north, SINGAPORE_ISLAND_BOUNDS.east],
  );
}

/**
 * Zoom and pan limits for the map's current size.
 *
 * - The furthest zoom-out is the zoom that fits the whole island, so wider screens can't zoom
 *   out into the blank area beyond OneMap's tile coverage (phones stay at zoom 10).
 * - The pan limit is Singapore plus one map-size of slack on every side. Leaflet re-centres any
 *   view larger than its pan limit, and a fixed limit smaller than a tall screen at the
 *   furthest zoom dragged the island down behind the results sheet.
 */
function updateViewLimits(map: L.Map) {
  map.setMinZoom(MIN_ZOOM);
  const padding = L.point(MIN_ZOOM_PADDING_PX * 2, MIN_ZOOM_PADDING_PX * 2);
  const minZoom = Math.max(MIN_ZOOM, map.getBoundsZoom(islandBounds(), false, padding));
  const size = map.getSize();
  const southWest = map.project([SINGAPORE_BOUNDS.south, SINGAPORE_BOUNDS.west], minZoom).add([-size.x, size.y]);
  const northEast = map.project([SINGAPORE_BOUNDS.north, SINGAPORE_BOUNDS.east], minZoom).add([size.x, -size.y]);
  map.setMaxBounds(L.latLngBounds(map.unproject(southWest, minZoom), map.unproject(northEast, minZoom)));
  map.setMinZoom(minZoom);
}

function applyFrame(map: L.Map, frame: Pick<MapFrame, "points" | "center">, insetFraction: number, animate: boolean) {
  const insetPx = map.getSize().y * insetFraction;
  const padding: L.FitBoundsOptions = {
    paddingTopLeft: [FIT_PADDING_PX, FIT_PADDING_TOP_PX],
    paddingBottomRight: [FIT_PADDING_PX, insetPx + FIT_PADDING_PX],
    animate,
  };

  if (frame.points === null) {
    map.fitBounds(islandBounds(), {
      ...padding,
      paddingTopLeft: [FIT_PADDING_PX, NATIONAL_PADDING_TOP_PX],
      maxZoom: NATIONAL_MAX_ZOOM,
    });
    return;
  }
  if (frame.points.length > 1) {
    const bounds = L.latLngBounds(frame.points.map((point): L.LatLngTuple => [point.lat, point.lng]));
    map.fitBounds(bounds, { ...padding, maxZoom: FIT_MAX_ZOOM });
    return;
  }
  const target = frame.points.length === 1 ? frame.points[0] : frame.center;
  if (!target) return;
  const zoom = frame.points.length === 1 ? FIT_MAX_ZOOM : TOWN_ZOOM;
  map.setView(centerAbove(map, target, zoom, insetPx), zoom, { animate });
}

export default function MopMap({
  blocks,
  towns,
  frame,
  blockFocus,
  selectedId,
  bottomInsetFraction,
  onSelectBlock,
  onSelectTown,
}: MopMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const blockLayerRef = useRef<L.LayerGroup | null>(null);
  const townLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.CircleMarker>());
  const highlightRef = useRef<L.CircleMarker | null>(null);
  const lastFrameKeyRef = useRef<string | null>(null);
  const lastBlockFocusKeyRef = useRef<string | null>(null);
  const insetFractionRef = useRef(bottomInsetFraction);
  const handlersRef = useRef({ onSelectBlock, onSelectTown });

  useEffect(() => {
    insetFractionRef.current = bottomInsetFraction;
    handlersRef.current = { onSelectBlock, onSelectTown };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const animate = !prefersReducedMotion();

    const map = L.map(container, {
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBoundsViscosity: 1,
      zoomControl: false,
      zoomAnimation: animate,
      fadeAnimation: animate,
      markerZoomAnimation: animate,
      inertia: animate,
    });
    // A provisional view lets Leaflet measure zoom levels; no tiles load until the tile layer is added.
    map.setView(islandBounds().getCenter(), MIN_ZOOM, { animate: false });
    updateViewLimits(map);
    // Start on the national view before any tiles load, so none are fetched for a throwaway view.
    applyFrame(map, { points: null }, insetFractionRef.current, false);
    map.attributionControl.setPrefix(LEAFLET_PREFIX);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer(TILE_URL, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, attribution: ONEMAP_ATTRIBUTION }).addTo(map);

    const renderer = L.canvas({ padding: 0.5, tolerance: 8 }) as L.Canvas & {
      _ctx?: CanvasRenderingContext2D;
      _redraw: () => void;
    };
    // Leaflet 1.9.4 bug: an immediate redraw forgets an already-scheduled redraw frame, so
    // map.remove() can't cancel it, and it later runs against the deleted canvas context
    // ("Cannot read properties of undefined (reading 'save')"). React Strict Mode's
    // mount → unmount → mount in development triggers it. Skip redraws once the canvas is gone.
    const redraw = renderer._redraw;
    renderer._redraw = function (this: typeof renderer) {
      if (this._ctx) redraw.call(this);
    };
    const blockLayer = L.layerGroup().addTo(map);
    const townLayer = L.layerGroup().addTo(map);
    const markers = markersRef.current;
    let currentRadius = dotRadius(map.getZoom());

    const handleZoom = () => {
      const zoom = map.getZoom();
      container.setAttribute("data-zoom", String(zoom));
      const radius = dotRadius(zoom);
      if (radius !== currentRadius) {
        currentRadius = radius;
        markers.forEach((marker) => marker.setRadius(radius));
        highlightRef.current?.setRadius(radius + HIGHLIGHT_EXTRA_RADIUS);
      }
      if (zoom > TOWN_BUBBLE_MAX_ZOOM) map.removeLayer(townLayer);
      else if (!map.hasLayer(townLayer)) townLayer.addTo(map);
    };
    map.on("zoomend", handleZoom);
    handleZoom();
    const handleResize = () => updateViewLimits(map);
    map.on("resize", handleResize);

    mapRef.current = map;
    rendererRef.current = renderer;
    blockLayerRef.current = blockLayer;
    townLayerRef.current = townLayer;

    return () => {
      map.off("zoomend", handleZoom);
      map.off("resize", handleResize);
      map.remove();
      markers.clear();
      mapRef.current = null;
      rendererRef.current = null;
      blockLayerRef.current = null;
      townLayerRef.current = null;
      highlightRef.current = null;
      lastFrameKeyRef.current = null;
      lastBlockFocusKeyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = blockLayerRef.current;
    const renderer = rendererRef.current;
    if (!map || !layer || !renderer) return;

    layer.clearLayers();
    markersRef.current.clear();
    const radius = dotRadius(map.getZoom());
    const ordered = [...blocks].sort((a, b) => DRAW_ORDER[a.cohort] - DRAW_ORDER[b.cohort]);
    for (const block of ordered) {
      const marker = L.circleMarker([block.lat, block.lng], dotStyle(block, radius, renderer));
      marker.on("click", () => handlersRef.current.onSelectBlock(block));
      layer.addLayer(marker);
      markersRef.current.set(block.id, marker);
    }
  }, [blocks]);

  useEffect(() => {
    const layer = townLayerRef.current;
    if (!layer) return;

    layer.clearLayers();
    for (const town of towns) {
      const label = `${town.name}: ${town.count} ${town.count === 1 ? "block" : "blocks"}`;
      const marker = L.marker([town.center.lat, town.center.lng], {
        icon: L.divIcon({
          className: "town-marker",
          iconSize: [0, 0],
          html:
            `<span class="town-marker__bubble${town.active ? " is-active" : ""}">` +
            `<span class="town-marker__count">${town.count}</span>` +
            `<span class="town-marker__name">${escapeHtml(town.name)}</span></span>`,
        }),
        title: label,
        alt: label,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: town.active ? 1000 : 0,
      });
      marker.on("click", () => handlersRef.current.onSelectTown(town.slug));
      layer.addLayer(marker);
    }
  }, [towns]);

  useEffect(() => {
    const map = mapRef.current;
    const renderer = rendererRef.current;
    if (!map || !renderer) return;

    highlightRef.current?.remove();
    highlightRef.current = null;
    const marker = selectedId ? markersRef.current.get(selectedId) : undefined;
    if (!marker) return;
    highlightRef.current = L.circleMarker(marker.getLatLng(), {
      renderer,
      radius: dotRadius(map.getZoom()) + HIGHLIGHT_EXTRA_RADIUS,
      color: "#0f172a",
      weight: 3,
      fill: false,
      interactive: false,
    }).addTo(map);
  }, [selectedId, blocks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frame || frame.key === lastFrameKeyRef.current) return;
    const isFirst = lastFrameKeyRef.current === null;
    lastFrameKeyRef.current = frame.key;
    applyFrame(map, frame, insetFractionRef.current, !isFirst && !prefersReducedMotion());
  }, [frame]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !blockFocus || blockFocus.key === lastBlockFocusKeyRef.current) return;
    lastBlockFocusKeyRef.current = blockFocus.key;
    const zoom = Math.max(BLOCK_ZOOM, map.getZoom());
    const insetPx = map.getSize().y * insetFractionRef.current;
    map.setView(centerAbove(map, blockFocus.center, zoom, insetPx), zoom, { animate: !prefersReducedMotion() });
  }, [blockFocus]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Map of HDB blocks by MOP status. The results list shows the same blocks."
      className="absolute inset-0"
    />
  );
}
