"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import type { DataMeta, DerivedBlock, TownBlocksFile } from "@/lib/data-contract";
import { decodeMapPoints, loadMapCohort, loadMeta, loadTownBlocks, type MapBlock } from "@/lib/data-client";
import { describeStatusBreakdown, formatNumber, resaleWindowLabel } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import {
  BROWSE_TOWNS_MESSAGE,
  detectBrowserLocationFailure,
  failureFromPositionError,
  GEOLOCATION_OPTIONS,
  LOCATING_MESSAGE,
  LOCATION_FAILURE_MESSAGES,
  nearestTown,
  type LocationFailure,
} from "@/lib/location";
import { readSavedTownSlug, saveTown, subscribeToSavedTown } from "@/lib/saved-town";
import { TOWNS, townByCode, townBySlug } from "@/lib/towns";
import {
  blockMatchesView,
  DEFAULT_VIEW,
  neighbouringTowns,
  RESULTS_VIEWS,
  sortBlocksForView,
  townCountForView,
  viewOption,
  type ResultsView,
} from "@/lib/views";

import { BlockCard } from "./BlockCard";
import { EmptyState } from "./EmptyState";
import { MapLegend } from "./MapLegend";
import type { MapBlockFocus, MapFrame, TownMarker } from "./MopMap";
import { ResultsSheet, SHEET_FRACTIONS, type SheetSnap } from "./ResultsSheet";
import { TownOverview } from "./TownOverview";
import { ViewTabs } from "./ViewTabs";

// Leaflet touches `window` on import, so the map only ever renders in the browser.
const MopMap = dynamic(() => import("./MopMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-slate-100" aria-hidden="true" />,
});

// Fetch the map code as soon as this module runs rather than after hydration: map tiles are the largest paint.
if (typeof window !== "undefined") void import("./MopMap");

const PAGE_SIZE = 50;
const LIST_ID = "results-list";
const DESKTOP_QUERY = "(min-width: 1024px)";
const NO_MAP_BLOCKS: readonly MapBlock[] = [];

/**
 * Which place the map should frame. Until the visitor acts on the map or list
 * ("explicit"), it follows the current town, so a saved town or a location
 * fix moves the map. A tap on a dot in another town switches the list without
 * reframing the map the visitor is already looking at.
 */
interface FrameIntent {
  explicit: boolean;
  target: string | null;
  generation: number;
}

function subscribeToDesktop(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

const isDesktopInBrowser = () => window.matchMedia(DESKTOP_QUERY).matches;
const isDesktopOnServer = () => false;
const subscribeToNothing = () => () => {};
const nothingOnServer = () => null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function blocksLabel(count: number): string {
  return count === 0 ? "No blocks" : `${formatNumber(count)} ${count === 1 ? "block" : "blocks"}`;
}

function townSummaryFor(view: ResultsView, count: number, townName: string): string {
  const blocks = blocksLabel(count);
  if (view === "just_mopped") return `${blocks} in ${townName} passed MOP in the last 24 months`;
  if (view === "upcoming") return `${blocks} in ${townName} reach MOP in the next 24 months`;
  return `${blocks} in ${townName}`;
}

function nationalSummaryFor(view: ResultsView, meta: DataMeta): string {
  const count = viewOption(view).cohorts.reduce(
    (sum, cohort) => sum + meta.totals.by_cohort[cohort].confirmed + meta.totals.by_cohort[cohort].estimated,
    0,
  );
  const blocks = blocksLabel(count);
  if (view === "just_mopped") return `${blocks} across Singapore passed MOP in the last 24 months`;
  if (view === "upcoming") return `${blocks} across Singapore reach MOP in the next 24 months`;
  return `${blocks} across Singapore`;
}

function pointsInTown(blocks: readonly MapBlock[], slug: string): LatLng[] {
  const code = townBySlug(slug)?.code;
  return blocks.filter((block) => block.townCode === code).map((block) => ({ lat: block.lat, lng: block.lng }));
}

/** The control that was used unmounts on a town switch, so hand keyboard focus to the new list. */
function focusResultsList() {
  window.requestAnimationFrame(() => {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    list.scrollTop = 0;
    list.focus({ preventScroll: true });
  });
}

export default function ResultsScreen() {
  const [view, setView] = useState<ResultsView>(DEFAULT_VIEW);
  const savedTownSlug = useSyncExternalStore(subscribeToSavedTown, readSavedTownSlug, nothingOnServer);
  // Going back to all towns keeps the saved town, so a repeat visit still opens on it.
  const [browsingAllTowns, setBrowsingAllTowns] = useState(false);
  const townSlug = browsingAllTowns ? null : savedTownSlug;
  const locationUnsupported = useSyncExternalStore(subscribeToNothing, detectBrowserLocationFailure, nothingOnServer);
  const [locationError, setLocationError] = useState<LocationFailure | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [attempt, setAttempt] = useState(0);

  const [meta, setMeta] = useState<DataMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [townData, setTownData] = useState<{ slug: string; file: TownBlocksFile } | null>(null);
  const [townError, setTownError] = useState<{ slug: string; message: string } | null>(null);
  const [mapData, setMapData] = useState<{ view: ResultsView; blocks: MapBlock[] } | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  const [frameIntent, setFrameIntent] = useState<FrameIntent>({ explicit: false, target: null, generation: 0 });
  const [blockFocus, setBlockFocus] = useState<MapBlockFocus | null>(null);
  const isDesktop = useSyncExternalStore(subscribeToDesktop, isDesktopInBrowser, isDesktopOnServer);

  // Locate the visitor once, straight away, without holding up the national view. Skipped
  // when a town is already saved, and when the browser can't provide a location at all.
  useEffect(() => {
    if (readSavedTownSlug() !== null || detectBrowserLocationFailure() !== null) return;
    let active = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // A town picked while we waited wins over the location fix.
        if (!active || readSavedTownSlug() !== null) return;
        const town = nearestTown({ lat: position.coords.latitude, lng: position.coords.longitude }, TOWNS);
        if (town) saveTown(town.slug, "geolocation");
        else setLocationError("outside_singapore");
      },
      (error) => {
        if (active) setLocationError(failureFromPositionError(error.code));
      },
      GEOLOCATION_OPTIONS,
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadMeta().then(
      (data) => {
        if (active) setMeta(data);
      },
      (error: unknown) => {
        if (active) setMetaError(errorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (townSlug === null) return;
    let active = true;
    loadTownBlocks(townSlug).then(
      (file) => {
        if (active) setTownData({ slug: townSlug, file });
      },
      (error: unknown) => {
        if (active) setTownError({ slug: townSlug, message: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [townSlug, attempt]);

  useEffect(() => {
    let active = true;
    Promise.all(viewOption(view).cohorts.map(loadMapCohort)).then(
      (files) => {
        if (active) setMapData({ view, blocks: files.flatMap(decodeMapPoints) });
      },
      () => {
        if (active) setMapFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [view, attempt]);

  const town = townSlug ? (townBySlug(townSlug) ?? null) : null;
  const townName = town?.name ?? "Singapore";
  const townSummary = town && meta ? (meta.towns.find((summary) => summary.slug === town.slug) ?? null) : null;
  const townFile = townData && townData.slug === townSlug ? townData.file : null;
  const loadError = metaError ?? (townError && townError.slug === townSlug ? townError.message : null);
  const locationFailure = locationUnsupported ?? locationError;
  const mapBlocks = mapData?.blocks ?? NO_MAP_BLOCKS;
  const mapSettled = mapData !== null || mapFailed;

  const listBlocks = useMemo(
    () =>
      townFile
        ? sortBlocksForView(
            townFile.blocks.filter((block) => blockMatchesView(block, view)),
            view,
          )
        : null,
    [townFile, view],
  );

  const shownBlocks = useMemo(() => {
    if (!listBlocks) return [];
    const shown = listBlocks.slice(0, visibleCount);
    if (selectedId && !shown.some((block) => block.id === selectedId)) {
      const selected = listBlocks.find((block) => block.id === selectedId);
      if (selected) shown.push(selected);
    }
    return shown;
  }, [listBlocks, visibleCount, selectedId]);

  const townMarkers = useMemo<TownMarker[]>(
    () =>
      meta
        ? meta.towns
            .map((summary) => ({
              slug: summary.slug,
              name: summary.name,
              center: summary.center,
              count: townCountForView(summary, view),
              active: summary.slug === townSlug,
            }))
            .filter((marker) => marker.count > 0 || marker.active)
        : [],
    [meta, view, townSlug],
  );

  const frameTarget = frameIntent.explicit ? frameIntent.target : townSlug;
  const frameGeneration = frameIntent.generation;
  const frame = useMemo<MapFrame | null>(() => {
    const key = `${frameTarget ?? "singapore"}:${frameGeneration}`;
    if (frameTarget === null) return { key, points: null };
    const target = townBySlug(frameTarget);
    // Wait for this tab's map points so the town is framed once, not centred then refitted.
    if (!target || !mapSettled) return null;
    return { key, points: mapData ? pointsInTown(mapData.blocks, frameTarget) : [], center: target.center };
  }, [frameTarget, frameGeneration, mapSettled, mapData]);

  const bottomInsetFraction = isDesktop ? 0 : SHEET_FRACTIONS[snap];

  function openTown(slug: string) {
    saveTown(slug, "manual");
    setBrowsingAllTowns(false);
    setSelectedId(null);
    setVisibleCount(PAGE_SIZE);
  }

  function showTown(slug: string) {
    openTown(slug);
    setFrameIntent((intent) => ({ explicit: true, target: slug, generation: intent.generation + 1 }));
    focusResultsList();
  }

  function showAllTowns() {
    setBrowsingAllTowns(true);
    setSelectedId(null);
    setVisibleCount(PAGE_SIZE);
    setFrameIntent((intent) => ({ explicit: true, target: null, generation: intent.generation + 1 }));
    focusResultsList();
  }

  function showView(next: ResultsView) {
    setView(next);
    setSelectedId(null);
    setVisibleCount(PAGE_SIZE);
  }

  function selectMapBlock(block: MapBlock) {
    const slug = townByCode(block.townCode)?.slug;
    if (slug && slug !== townSlug) {
      const currentTarget = frameTarget;
      setFrameIntent((intent) => (intent.explicit ? intent : { ...intent, explicit: true, target: currentTarget }));
      openTown(slug);
    }
    setSelectedId(block.id);
    setSnap((current) => (current === "peek" ? "half" : current));
  }

  function selectListBlock(block: DerivedBlock) {
    setSelectedId(block.id);
    if (block.lat !== null && block.lng !== null) {
      const center = { lat: block.lat, lng: block.lng };
      setBlockFocus((previous) => ({ key: String((previous ? Number(previous.key) : 0) + 1), center }));
    }
    if (!isDesktop) setSnap((current) => (current === "full" ? "half" : current));
  }

  function retry() {
    setMetaError(null);
    setTownError(null);
    setMapFailed(false);
    setAttempt((count) => count + 1);
  }

  const withResales = listBlocks ? listBlocks.filter((block) => block.mop_status === "confirmed").length : 0;
  const latestResaleMonth = townFile?.latest_resale_month ?? meta?.latest_resale_month ?? null;
  const priceWindow = latestResaleMonth ? resaleWindowLabel(latestResaleMonth) : "";

  let headline: string;
  let subline: string | null = null;
  if (loadError) {
    headline = "Couldn't load results";
  } else if (townSlug === null) {
    headline = meta ? nationalSummaryFor(view, meta) : "Loading Singapore…";
    if (savedTownSlug !== null) subline = BROWSE_TOWNS_MESSAGE;
    else subline = locationFailure ? LOCATION_FAILURE_MESSAGES[locationFailure] : LOCATING_MESSAGE;
  } else if (listBlocks) {
    headline = townSummaryFor(view, listBlocks.length, townName);
    subline = describeStatusBreakdown(withResales, listBlocks.length);
  } else {
    headline = `Loading ${townName}…`;
  }

  // The fixed minimum height keeps the list from shifting when the header's lines change, and
  // keying the contents by town replaces them (rather than nudging them sideways) when the back
  // button appears after a location fix.
  const sheetHeader = (
    <div aria-live="polite" className="min-h-[3.75rem]">
      <div key={town ? `town:${town.slug}` : "all-towns"} className="flex items-start gap-1">
        {town && (
          <button
            type="button"
            onClick={showAllTowns}
            aria-label="Back to all towns"
            title="Back to all towns"
            className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
          >
            <svg viewBox="0 0 20 20" className="h-6 w-6" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">{headline}</h2>
          {subline && <p className="mt-0.5 text-xs text-slate-600">{subline}</p>}
        </div>
      </div>
    </div>
  );

  const skeleton = (
    <ul aria-hidden="true" className="space-y-3">
      {[0, 1, 2].map((index) => (
        <li key={index} className="h-44 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
      ))}
    </ul>
  );

  let sheetBody: ReactNode;
  if (loadError) {
    sheetBody = (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p>{loadError}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 min-h-[44px] rounded-lg bg-red-900 px-4 font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  } else if (townSlug === null) {
    sheetBody = meta ? <TownOverview towns={meta.towns} view={view} onPick={showTown} /> : skeleton;
  } else if (!listBlocks) {
    sheetBody = skeleton;
  } else if (listBlocks.length === 0) {
    sheetBody = (
      <EmptyState
        townName={townName}
        views={
          townSummary
            ? RESULTS_VIEWS.filter((option) => option.value !== view)
                .map((option) => ({
                  view: option.value,
                  label: option.label,
                  count: townCountForView(townSummary, option.value),
                }))
                .filter((option) => option.count > 0)
            : []
        }
        towns={meta ? neighbouringTowns(meta.towns, townSlug, view) : []}
        onView={showView}
        onTown={showTown}
      />
    );
  } else {
    sheetBody = (
      <>
        <ul className="space-y-3">
          {shownBlocks.map((block) => (
            <BlockCard
              key={block.id}
              block={block}
              townName={townName}
              priceWindow={priceWindow}
              selected={block.id === selectedId}
              onSelect={selectListBlock}
            />
          ))}
        </ul>
        {listBlocks.length > visibleCount && (
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            className="mt-3 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white font-semibold text-teal-800 hover:bg-slate-50"
          >
            Show {formatNumber(Math.min(PAGE_SIZE, listBlocks.length - visibleCount))} more
          </button>
        )}
      </>
    );
  }

  const mapInsetStyle = { "--map-inset": `${bottomInsetFraction * 100}%` } as CSSProperties;

  return (
    <div className="absolute inset-0 flex flex-col">
      <a
        href={`#${LIST_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[1100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-md"
      >
        Skip to results list
      </a>

      <header className="relative z-[1001] shrink-0 border-b border-slate-200 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">MOP Radar</p>
        <h1 className="truncate text-lg font-semibold leading-tight text-slate-900">{townName}</h1>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* The list comes before the map in the DOM so keyboard and screen reader users reach results first. */}
        <ResultsSheet
          snap={snap}
          onSnapChange={setSnap}
          listId={LIST_ID}
          controls={<ViewTabs view={view} onChange={showView} />}
          header={sheetHeader}
        >
          {sheetBody}
        </ResultsSheet>

        {/* z-0 keeps Leaflet's own z-indexes below the sheet; --map-inset lifts the attribution above it. */}
        <div className="absolute inset-0 z-0 lg:left-[420px]" style={mapInsetStyle}>
          <MopMap
            blocks={mapBlocks}
            towns={townMarkers}
            frame={frame}
            blockFocus={blockFocus}
            selectedId={selectedId}
            bottomInsetFraction={bottomInsetFraction}
            onSelectBlock={selectMapBlock}
            onSelectTown={showTown}
          />
          <MapLegend view={view} className="absolute left-3 top-3 z-[900]" />
          {mapFailed && (
            <div
              role="alert"
              className="absolute left-1/2 top-3 z-[900] flex -translate-x-1/2 items-center gap-3 rounded-lg bg-white px-3 py-2 text-xs shadow-md"
            >
              Map dots couldn&apos;t load.
              <button type="button" onClick={retry} className="font-semibold text-teal-800 underline">
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
