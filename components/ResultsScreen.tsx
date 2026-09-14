"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { agentContact } from "@/lib/agent";
import type { Cohort, DataMeta, DerivedBlock, TownBlocksFile, TownTransactionsFile } from "@/lib/data-contract";
import {
  decodeMapPoints,
  loadMapCohort,
  loadMeta,
  loadTownBlocks,
  loadTownTransactions,
  type MapBlock,
} from "@/lib/data-client";
import {
  activeFilterCount,
  cohortsForView,
  DEFAULT_FILTERS,
  filterableBlock,
  matchesViewAndFilters,
  MOP_WINDOW_STEPS,
  type Filters,
} from "@/lib/filters";
import { flatTypeMask } from "@/lib/flat-types";
import { blockTitle, describeStatusBreakdown, formatNumber, mopWindowPhrase, resaleWindowLabel } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import {
  BROWSE_TOWNS_MESSAGE,
  detectBrowserLocationFailure,
  failureFromPositionError,
  GEOLOCATION_OPTIONS,
  LOCATE_ME_MESSAGES,
  LOCATING_MESSAGE,
  LOCATION_FAILURE_MESSAGES,
  nearestTown,
  type LocationFailure,
} from "@/lib/location";
import { readSavedTownSlug, saveTown, subscribeToSavedTown } from "@/lib/saved-town";
import { filtersStore, watchlistStore } from "@/lib/stores";
import { TOWNS, townByCode, townBySlug } from "@/lib/towns";
import { decodeTransactions } from "@/lib/transactions";
import {
  closeBlockLink,
  noSearchOnServer,
  openBlockLink,
  parseBlockLink,
  readLocationSearch,
  subscribeToLocation,
} from "@/lib/url-state";
import { DEFAULT_VIEW, neighbouringTowns, RESULTS_VIEWS, sortBlocksForView, type ResultsView } from "@/lib/views";
import { isWatched, toggleWatched } from "@/lib/watchlist";

import { AlertSignup } from "./AlertSignup";
import { BlockCard } from "./BlockCard";
import { BlockDetail } from "./BlockDetail";
import { EmptyState } from "./EmptyState";
import { FilterSheet } from "./FilterSheet";
import { MapLegend } from "./MapLegend";
import type { MapFrame, TownMarker, UserLocation } from "./MopMap";
import { ResultsSheet, SHEET_FRACTIONS, type SheetSnap } from "./ResultsSheet";
import { TownOverview } from "./TownOverview";
import { ViewTabs } from "./ViewTabs";
import { WatchlistPanel, type WatchlistItem } from "./WatchlistPanel";
import { WatchStar } from "./WatchStar";

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
const NO_IDS: readonly string[] = [];
const AGENT = agentContact();

type Panel = "list" | "watchlist";

/**
 * Which place the map should frame in the results list. Until the visitor acts
 * on the map or list ("explicit"), it follows the current town, so a saved town
 * or a location fix moves the map. A tap on a dot in another town switches the
 * list without reframing the map the visitor is already looking at.
 */
interface FrameIntent {
  explicit: boolean;
  target: string | null;
  generation: number;
  /** Also fit the visitor's location (after "Locate me"). */
  includeUser: boolean;
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

/** "212 blocks across Singapore passed MOP in the last 24 months". */
function resultsSummary(view: ResultsView, count: number, townName: string | null, windowMonths: number): string {
  const where = townName ? `in ${townName}` : "across Singapore";
  const phrase = mopWindowPhrase(view, windowMonths);
  return `${blocksLabel(count)} ${where}${phrase ? ` ${phrase}` : ""}`;
}

function yearOf(month: string | undefined): number {
  return month ? Number(month.slice(0, 4)) : 0;
}

function locationOf(block: { lat: number | null; lng: number | null }): LatLng | null {
  return block.lat !== null && block.lng !== null ? { lat: block.lat, lng: block.lng } : null;
}

/** Map dot for a block that isn't in the loaded map points, e.g. a watchlist block outside the current tab. */
function toMapBlock(block: DerivedBlock): MapBlock | null {
  const location = locationOf(block);
  if (!location) return null;
  return {
    id: block.id,
    townCode: block.town_code,
    lat: location.lat,
    lng: location.lng,
    cohort: block.cohort,
    status: block.mop_status,
    monthsSinceMop: block.months_since_mop,
    yearCompleted: block.year_completed,
    flatTypeMask: flatTypeMask(block.flat_type_mix),
    hasRentalUnits: block.has_rental_units,
    activity: block.resale_activity,
    precision: block.location_precision ?? "block",
  };
}

/** The control that was used often unmounts when the panel changes, so hand keyboard focus to the new content. */
function focusResultsList(resetScroll = true) {
  window.requestAnimationFrame(() => {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    if (resetScroll) list.scrollTop = 0;
    list.focus({ preventScroll: true });
  });
}

const BACK_ICON = (
  <svg viewBox="0 0 20 20" className="h-6 w-6" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
      clipRule="evenodd"
    />
  </svg>
);

const HEADER_BUTTON_CLASS =
  "flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50";

interface ResultsScreenProps {
  /** True when the email alert store is configured for this deployment. */
  alertsEnabled: boolean;
}

export default function ResultsScreen({ alertsEnabled }: ResultsScreenProps) {
  const [view, setView] = useState<ResultsView>(DEFAULT_VIEW);
  const savedTownSlug = useSyncExternalStore(subscribeToSavedTown, readSavedTownSlug, nothingOnServer);
  const filters = useSyncExternalStore(filtersStore.subscribe, filtersStore.read, filtersStore.serverSnapshot);
  const watchlist = useSyncExternalStore(watchlistStore.subscribe, watchlistStore.read, watchlistStore.serverSnapshot);
  const search = useSyncExternalStore(subscribeToLocation, readLocationSearch, noSearchOnServer);
  const blockLink = useMemo(() => parseBlockLink(search), [search]);
  // Going back to all towns keeps the saved town, so a repeat visit still opens on it.
  const [browsingAllTowns, setBrowsingAllTowns] = useState(false);
  const listTownSlug = browsingAllTowns ? null : savedTownSlug;
  const [panel, setPanel] = useState<Panel>("list");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const locationUnsupported = useSyncExternalStore(subscribeToNothing, detectBrowserLocationFailure, nothingOnServer);
  const [locationError, setLocationError] = useState<LocationFailure | null>(null);
  // The visitor's position is kept for this visit only, never stored.
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const [lastViewedId, setLastViewedId] = useState<string | null>(null);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [attempt, setAttempt] = useState(0);

  const [meta, setMeta] = useState<DataMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [townFiles, setTownFiles] = useState<Record<string, TownBlocksFile>>({});
  const [townErrors, setTownErrors] = useState<Record<string, string>>({});
  const [transactionFiles, setTransactionFiles] = useState<Record<string, TownTransactionsFile>>({});
  const [transactionErrors, setTransactionErrors] = useState<Record<string, string>>({});
  const [mapData, setMapData] = useState<{ key: string; currentMonth: string; blocks: MapBlock[] } | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  const [frameIntent, setFrameIntent] = useState<FrameIntent>({
    explicit: false,
    target: null,
    generation: 0,
    includeUser: false,
  });
  // Separate counters, so closing detail never re-frames the watchlist or town behind it.
  const [focusGenerations, setFocusGenerations] = useState({ detail: 0, watchlist: 0 });
  const isDesktop = useSyncExternalStore(subscribeToDesktop, isDesktopInBrowser, isDesktopOnServer);

  // Locate the visitor once, straight away, without holding up the national view. Skipped
  // when a town is already saved, when the page opened on a shared block, and when the
  // browser can't provide a location at all.
  useEffect(() => {
    if (
      readSavedTownSlug() !== null ||
      detectBrowserLocationFailure() !== null ||
      parseBlockLink(window.location.search) !== null
    ) {
      return;
    }
    let active = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!active) return;
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const town = nearestTown(point, TOWNS);
        if (town) setUserLocation({ ...point, accuracy: position.coords.accuracy });
        // A town picked while we waited wins over the location fix.
        if (readSavedTownSlug() !== null) return;
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

  // Town files for the list, the open block and, in the watchlist, every saved block's town.
  const neededTownSlugs = useMemo(() => {
    const slugs = new Set<string>();
    if (listTownSlug) slugs.add(listTownSlug);
    if (blockLink) slugs.add(blockLink.town);
    if (panel === "watchlist") watchlist.forEach((entry) => slugs.add(entry.town));
    return Array.from(slugs).sort().join(",");
  }, [listTownSlug, blockLink, panel, watchlist]);

  useEffect(() => {
    if (!neededTownSlugs) return;
    let active = true;
    for (const slug of neededTownSlugs.split(",")) {
      loadTownBlocks(slug).then(
        (file) => {
          if (active) setTownFiles((files) => (files[slug] === file ? files : { ...files, [slug]: file }));
        },
        (error: unknown) => {
          if (active) setTownErrors((errors) => ({ ...errors, [slug]: errorMessage(error) }));
        },
      );
    }
    return () => {
      active = false;
    };
  }, [neededTownSlugs, attempt]);

  const detailTownSlug = blockLink?.town ?? null;
  useEffect(() => {
    if (detailTownSlug === null) return;
    let active = true;
    loadTownTransactions(detailTownSlug).then(
      (file) => {
        if (active) {
          setTransactionFiles((files) =>
            files[detailTownSlug] === file ? files : { ...files, [detailTownSlug]: file },
          );
        }
      },
      (error: unknown) => {
        if (active) setTransactionErrors((errors) => ({ ...errors, [detailTownSlug]: errorMessage(error) }));
      },
    );
    return () => {
      active = false;
    };
  }, [detailTownSlug, attempt]);

  const windowMonths = filters.mopWindowMonths;
  const cohortKey = cohortsForView(view, windowMonths).join(",");
  useEffect(() => {
    let active = true;
    const cohorts = cohortKey.split(",") as Cohort[];
    Promise.all(cohorts.map(loadMapCohort)).then(
      (files) => {
        if (active) {
          setMapData({ key: cohortKey, currentMonth: files[0].current_month, blocks: files.flatMap(decodeMapPoints) });
        }
      },
      () => {
        if (active) setMapFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [cohortKey, attempt]);

  const year = yearOf(meta?.current_month ?? mapData?.currentMonth);
  const filterCount = activeFilterCount(filters);
  const currentMapData = mapData && mapData.key === cohortKey ? mapData : null;
  const mapSettled = currentMapData !== null || mapFailed;
  const locationFailure = locationUnsupported ?? locationError;
  const detailOpen = blockLink !== null;
  const watchlistOpen = panel === "watchlist" && !detailOpen;

  const townSlug = blockLink?.town ?? listTownSlug;
  const town = townSlug ? (townBySlug(townSlug) ?? null) : null;
  const townName = town?.name ?? "Singapore";
  const listTown = listTownSlug ? (townBySlug(listTownSlug) ?? null) : null;
  const listTownFile = listTownSlug ? (townFiles[listTownSlug] ?? null) : null;

  // Dots stay on screen from the previous tab until the new tab's points arrive.
  const visibleMapBlocks = useMemo(
    () => (mapData ? mapData.blocks.filter((block) => matchesViewAndFilters(block, view, filters, year)) : NO_MAP_BLOCKS),
    [mapData, view, filters, year],
  );

  /**
   * Results per town for the tab and filters. With default filters the counts come from
   * meta.json, which also counts the few blocks without a map location.
   */
  const townCounts = useMemo<Record<string, number> | null>(() => {
    if (!meta) return null;
    if (filterCount === 0) {
      return Object.fromEntries(
        meta.towns.map((summary) => [
          summary.slug,
          cohortsForView(view, windowMonths).reduce((sum, cohort) => sum + summary.cohorts[cohort], 0),
        ]),
      );
    }
    if (!currentMapData) return null;
    const counts: Record<string, number> = Object.fromEntries(meta.towns.map((summary) => [summary.slug, 0]));
    for (const block of visibleMapBlocks) {
      const slug = townByCode(block.townCode)?.slug;
      if (slug) counts[slug] += 1;
    }
    return counts;
  }, [meta, filterCount, view, windowMonths, currentMapData, visibleMapBlocks]);

  const nationalCount = townCounts ? Object.values(townCounts).reduce((sum, count) => sum + count, 0) : null;

  const listBlocks = useMemo(
    () =>
      listTownFile
        ? sortBlocksForView(
            listTownFile.blocks.filter((block) => matchesViewAndFilters(filterableBlock(block), view, filters, year)),
            view,
          )
        : null,
    [listTownFile, view, filters, year],
  );

  const shownBlocks = useMemo(() => {
    if (!listBlocks) return [];
    const shown = listBlocks.slice(0, visibleCount);
    if (lastViewedId && !shown.some((block) => block.id === lastViewedId)) {
      const lastViewed = listBlocks.find((block) => block.id === lastViewedId);
      if (lastViewed) shown.push(lastViewed);
    }
    return shown;
  }, [listBlocks, visibleCount, lastViewedId]);

  const detailTownFile = blockLink ? (townFiles[blockLink.town] ?? null) : null;
  const detailBlock = useMemo(
    () => (blockLink && detailTownFile ? (detailTownFile.blocks.find((block) => block.id === blockLink.block) ?? null) : null),
    [blockLink, detailTownFile],
  );
  const detailTransactions = useMemo(() => {
    const file = blockLink ? transactionFiles[blockLink.town] : undefined;
    return blockLink && file ? decodeTransactions(file.blocks[blockLink.block] ?? []) : null;
  }, [blockLink, transactionFiles]);
  const detailError = blockLink ? (metaError ?? townErrors[blockLink.town] ?? null) : null;
  const transactionsError = blockLink ? (transactionErrors[blockLink.town] ?? null) : null;

  const watchlistItems = useMemo<WatchlistItem[]>(
    () =>
      watchlist.map((entry) => {
        const file = townFiles[entry.town];
        return { entry, block: file ? (file.blocks.find((block) => block.id === entry.id) ?? null) : undefined };
      }),
    [watchlist, townFiles],
  );
  const watchlistError = watchlistOpen ? (watchlist.map((entry) => townErrors[entry.town]).find(Boolean) ?? null) : null;
  const watchedIdsOnMap = useMemo(
    () => (watchlistOpen ? watchlist.map((entry) => entry.id) : NO_IDS),
    [watchlistOpen, watchlist],
  );

  // The open block and watchlist blocks always get a dot, even when the tab or filters hide them.
  const mapBlocks = useMemo(() => {
    const pinned: DerivedBlock[] = [];
    if (detailBlock) pinned.push(detailBlock);
    if (watchlistOpen) {
      watchlistItems.forEach((item) => {
        if (item.block) pinned.push(item.block);
      });
    }
    if (pinned.length === 0) return visibleMapBlocks;
    const present = new Set(visibleMapBlocks.map((block) => block.id));
    const extra: MapBlock[] = [];
    for (const block of pinned) {
      if (present.has(block.id)) continue;
      const dot = toMapBlock(block);
      if (!dot) continue;
      present.add(block.id);
      extra.push(dot);
    }
    return extra.length > 0 ? [...visibleMapBlocks, ...extra] : visibleMapBlocks;
  }, [detailBlock, watchlistOpen, watchlistItems, visibleMapBlocks]);

  const townMarkers = useMemo<TownMarker[]>(
    () =>
      meta && townCounts
        ? meta.towns
            .map((summary) => ({
              slug: summary.slug,
              name: summary.name,
              center: summary.center,
              count: townCounts[summary.slug] ?? 0,
              active: summary.slug === listTownSlug,
            }))
            .filter((marker) => marker.count > 0 || marker.active)
        : [],
    [meta, townCounts, listTownSlug],
  );

  const frameTarget = frameIntent.explicit ? frameIntent.target : listTownSlug;
  const frameIncludesUser = frameIntent.explicit ? frameIntent.includeUser : true;
  const frameGeneration = frameIntent.generation;

  const detailCenter = useMemo<LatLng | null>(() => {
    if (!blockLink) return null;
    const dot = mapData?.blocks.find((block) => block.id === blockLink.block);
    if (dot) return { lat: dot.lat, lng: dot.lng };
    return detailBlock ? locationOf(detailBlock) : null;
  }, [blockLink, mapData, detailBlock]);

  const watchlistPoints = useMemo<LatLng[] | null>(() => {
    if (!watchlistOpen || watchlistItems.some((item) => item.block === undefined)) return null;
    return watchlistItems.flatMap((item) => {
      const location = item.block ? locationOf(item.block) : null;
      return location ? [location] : [];
    });
  }, [watchlistOpen, watchlistItems]);

  const frame = useMemo<MapFrame | null>(() => {
    if (blockLink) {
      return detailCenter
        ? { kind: "block", key: `block:${blockLink.block}:${focusGenerations.detail}`, center: detailCenter }
        : null;
    }
    if (panel === "watchlist") {
      return watchlistPoints && watchlistPoints.length > 0
        ? { kind: "points", key: `watchlist:${focusGenerations.watchlist}`, points: watchlistPoints }
        : null;
    }
    const key = `${frameTarget ?? "singapore"}:${frameGeneration}`;
    if (frameTarget === null) return { kind: "island", key };
    const target = townBySlug(frameTarget);
    // Wait for this tab's map points so the town is framed once, not centred then refitted.
    if (!target || !mapSettled) return null;
    const points: LatLng[] = visibleMapBlocks
      .filter((block) => block.townCode === target.code)
      .map((block) => ({ lat: block.lat, lng: block.lng }));
    if (frameIncludesUser && userLocation) points.push({ lat: userLocation.lat, lng: userLocation.lng });
    return { kind: "points", key, points, center: target.center };
  }, [
    blockLink,
    detailCenter,
    focusGenerations,
    panel,
    watchlistPoints,
    frameTarget,
    frameGeneration,
    mapSettled,
    visibleMapBlocks,
    frameIncludesUser,
    userLocation,
  ]);

  const bottomInsetFraction = isDesktop ? 0 : SHEET_FRACTIONS[snap];

  function raiseSheet() {
    if (!isDesktop) setSnap((current) => (current === "peek" ? "half" : current));
  }

  function openTown(slug: string) {
    saveTown(slug, "manual");
    setBrowsingAllTowns(false);
    setLastViewedId(null);
    setVisibleCount(PAGE_SIZE);
  }

  function showTown(slug: string) {
    if (blockLink) closeBlockLink();
    setPanel("list");
    openTown(slug);
    setFrameIntent((intent) => ({ explicit: true, target: slug, generation: intent.generation + 1, includeUser: false }));
    focusResultsList();
  }

  function showAllTowns() {
    setBrowsingAllTowns(true);
    setLastViewedId(null);
    setVisibleCount(PAGE_SIZE);
    setFrameIntent((intent) => ({ explicit: true, target: null, generation: intent.generation + 1, includeUser: false }));
    focusResultsList();
  }

  function showView(next: ResultsView) {
    setView(next);
    setLastViewedId(null);
    setVisibleCount(PAGE_SIZE);
  }

  function updateFilters(next: Filters) {
    filtersStore.write(next);
    setVisibleCount(PAGE_SIZE);
  }

  function openBlock(block: { id: string; townCode: string }) {
    const slug = townByCode(block.townCode)?.slug;
    if (!slug) return;
    setLastViewedId(block.id);
    setFocusGenerations((generations) => ({ ...generations, detail: generations.detail + 1 }));
    raiseSheet();
    // Switching straight from one block to another reuses the history entry, so Back returns to the list.
    openBlockLink({ town: slug, block: block.id }, { replace: blockLink !== null });
    focusResultsList();
  }

  function openListBlock(block: DerivedBlock) {
    openBlock({ id: block.id, townCode: block.town_code });
  }

  function selectMapBlock(block: MapBlock) {
    const slug = townByCode(block.townCode)?.slug;
    if (slug && !blockLink && panel === "list" && slug !== listTownSlug) {
      const currentTarget = frameTarget;
      setFrameIntent((intent) => (intent.explicit ? intent : { ...intent, explicit: true, target: currentTarget }));
      saveTown(slug, "manual");
      setBrowsingAllTowns(false);
      setVisibleCount(PAGE_SIZE);
    }
    openBlock(block);
  }

  function closeBlock() {
    const link = blockLink;
    if (!link) return;
    // A block opened from a shared link has no in-app history to go back to: show its town instead.
    if (!closeBlockLink() && panel === "list") {
      saveTown(link.town, "manual");
      setBrowsingAllTowns(false);
      setVisibleCount(PAGE_SIZE);
    }
    focusResultsList(false);
  }

  function openWatchlist() {
    if (blockLink) closeBlockLink();
    setPanel("watchlist");
    setFocusGenerations((generations) => ({ ...generations, watchlist: generations.watchlist + 1 }));
    raiseSheet();
    focusResultsList();
  }

  function closeWatchlist() {
    if (blockLink) closeBlockLink();
    setPanel("list");
    const target = listTownSlug;
    setFrameIntent((intent) => ({ explicit: true, target, generation: intent.generation + 1, includeUser: false }));
    focusResultsList();
  }

  function toggleWatch(block: DerivedBlock) {
    const slug = townByCode(block.town_code)?.slug;
    if (!slug) return;
    watchlistStore.write(toggleWatched(watchlist, { id: block.id, town: slug }, new Date().toISOString()));
  }

  function removeWatched(id: string) {
    watchlistStore.write(watchlist.filter((entry) => entry.id !== id));
  }

  function locateMe() {
    const unsupported = detectBrowserLocationFailure();
    if (unsupported) {
      setLocateNote(LOCATE_ME_MESSAGES[unsupported]);
      return;
    }
    setLocating(true);
    setLocateNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const nearest = nearestTown(point, TOWNS);
        if (!nearest) {
          setLocateNote(LOCATE_ME_MESSAGES.outside_singapore);
          return;
        }
        setUserLocation({ ...point, accuracy: position.coords.accuracy });
        if (blockLink) closeBlockLink();
        setPanel("list");
        saveTown(nearest.slug, "geolocation");
        setBrowsingAllTowns(false);
        setLastViewedId(null);
        setVisibleCount(PAGE_SIZE);
        setFrameIntent((intent) => ({
          explicit: true,
          target: nearest.slug,
          generation: intent.generation + 1,
          includeUser: true,
        }));
      },
      (error) => {
        setLocating(false);
        setLocateNote(LOCATE_ME_MESSAGES[failureFromPositionError(error.code)]);
      },
      GEOLOCATION_OPTIONS,
    );
  }

  function retry() {
    setMetaError(null);
    setTownErrors({});
    setTransactionErrors({});
    setMapFailed(false);
    setAttempt((count) => count + 1);
  }

  const latestResaleMonth = meta?.latest_resale_month ?? listTownFile?.latest_resale_month ?? null;
  const priceWindow = latestResaleMonth ? resaleWindowLabel(latestResaleMonth) : "";

  const skeleton = (
    <ul aria-hidden="true" className="space-y-3">
      {[0, 1, 2].map((index) => (
        <li key={index} className="h-44 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
      ))}
    </ul>
  );

  const errorAlert = (message: string) => (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p>{message}</p>
      <button type="button" onClick={retry} className="mt-3 min-h-[44px] rounded-lg bg-red-900 px-4 font-semibold text-white">
        Try again
      </button>
    </div>
  );

  let headerKey: string;
  let backButton: { label: string; onClick: () => void } | null = null;
  let headline: string;
  let subline: string | null = null;
  let headerAction: ReactNode = null;
  let sheetBody: ReactNode;

  if (blockLink) {
    headerKey = `block:${blockLink.block}`;
    backButton = { label: panel === "watchlist" ? "Back to watchlist" : "Back to results", onClick: closeBlock };
    if (detailBlock) {
      const title = blockTitle(detailBlock);
      headline = title;
      subline = `${townName} · completed ${detailBlock.year_completed}`;
      headerAction = (
        <WatchStar
          watched={isWatched(watchlist, detailBlock.id)}
          title={title}
          onToggle={() => toggleWatch(detailBlock)}
          className="-mr-2"
        />
      );
      sheetBody = (
        <BlockDetail
          block={detailBlock}
          townName={townName}
          priceWindow={priceWindow}
          transactions={detailTransactions}
          transactionsError={transactionsError}
          onRetry={retry}
          agent={AGENT}
        />
      );
    } else if (detailError) {
      headline = "Couldn't load this block";
      sheetBody = errorAlert(detailError);
    } else if (detailTownFile) {
      headline = "Block not found";
      subline = `It may have been removed from the latest data for ${townName}.`;
      sheetBody = (
        <button
          type="button"
          onClick={closeBlock}
          className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white font-semibold text-teal-800 hover:bg-slate-50"
        >
          See blocks in {townName}
        </button>
      );
    } else {
      headline = "Loading block…";
      sheetBody = skeleton;
    }
  } else if (panel === "watchlist") {
    headerKey = "watchlist";
    backButton = { label: "Back to results", onClick: closeWatchlist };
    headline = "Watchlist";
    subline =
      watchlist.length > 0
        ? `${blocksLabel(watchlist.length)} saved on this device`
        : "Saved on this device, no account needed";
    sheetBody = watchlistError ? (
      errorAlert(watchlistError)
    ) : (
      <WatchlistPanel
        items={watchlistItems}
        priceWindow={priceWindow}
        lastViewedId={lastViewedId}
        onOpen={openListBlock}
        onToggleWatch={toggleWatch}
        onRemove={removeWatched}
        footer={alertsEnabled && watchlist.length > 0 ? <AlertSignup watchlist={watchlist} town={listTownSlug} /> : null}
      />
    );
  } else {
    const listError = metaError ?? (listTownSlug ? (townErrors[listTownSlug] ?? null) : null);
    headerKey = listTown ? `town:${listTown.slug}` : "all-towns";
    if (listTown) backButton = { label: "Back to all towns", onClick: showAllTowns };

    const filterBar =
      filterCount > 0 ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-teal-50 pl-3 pr-1 text-sm text-teal-900">
          <span>
            {filterCount} {filterCount === 1 ? "filter" : "filters"} on
          </span>
          <button
            type="button"
            onClick={() => updateFilters(DEFAULT_FILTERS)}
            className="min-h-[44px] rounded-lg px-2 font-semibold underline"
          >
            Clear filters
          </button>
        </div>
      ) : null;

    if (listError) {
      headline = "Couldn't load results";
      sheetBody = errorAlert(listError);
    } else if (!listTown) {
      headline = nationalCount !== null ? resultsSummary(view, nationalCount, null, windowMonths) : "Loading Singapore…";
      if (savedTownSlug !== null) subline = BROWSE_TOWNS_MESSAGE;
      else subline = locationFailure ? LOCATION_FAILURE_MESSAGES[locationFailure] : LOCATING_MESSAGE;
      sheetBody =
        meta && townCounts ? (
          <>
            {filterBar}
            <TownOverview towns={meta.towns} counts={townCounts} onPick={showTown} />
          </>
        ) : (
          skeleton
        );
    } else if (!listBlocks || !listTownFile) {
      headline = `Loading ${listTown.name}…`;
      sheetBody = skeleton;
    } else {
      const withResales = listBlocks.filter((block) => block.mop_status === "confirmed").length;
      headline = resultsSummary(view, listBlocks.length, listTown.name, windowMonths);
      subline = describeStatusBreakdown(withResales, listBlocks.length);

      if (listBlocks.length === 0) {
        const countWith = (candidateView: ResultsView, candidateFilters: Filters) =>
          listTownFile.blocks.filter((block) =>
            matchesViewAndFilters(filterableBlock(block), candidateView, candidateFilters, year),
          ).length;
        let widerWindow: { months: number; count: number } | null = null;
        if (view !== "all") {
          for (const months of MOP_WINDOW_STEPS) {
            if (months <= windowMonths) continue;
            const count = countWith(view, { ...filters, mopWindowMonths: months });
            if (count > 0) {
              widerWindow = { months, count };
              break;
            }
          }
        }
        const withoutFilters = filterCount > 0 ? countWith(view, DEFAULT_FILTERS) : 0;
        sheetBody = (
          <>
            {filterBar}
            <EmptyState
              townName={listTown.name}
              widerWindow={widerWindow}
              withoutFilters={withoutFilters > 0 ? withoutFilters : null}
              views={RESULTS_VIEWS.filter((option) => option.value !== view)
                .map((option) => ({ view: option.value, label: option.label, count: countWith(option.value, filters) }))
                .filter((option) => option.count > 0)}
              towns={
                meta && townCounts
                  ? neighbouringTowns(meta.towns, listTown.slug, (summary) => townCounts[summary.slug] ?? 0)
                  : []
              }
              onWidenWindow={(months) => updateFilters({ ...filters, mopWindowMonths: months })}
              onClearFilters={() => updateFilters(DEFAULT_FILTERS)}
              onView={showView}
              onTown={showTown}
            />
          </>
        );
      } else {
        sheetBody = (
          <>
            {filterBar}
            <ul className="space-y-3">
              {shownBlocks.map((block) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  townName={listTown.name}
                  priceWindow={priceWindow}
                  selected={block.id === lastViewedId}
                  watched={isWatched(watchlist, block.id)}
                  onOpen={openListBlock}
                  onToggleWatch={toggleWatch}
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
    }
  }

  const filterResultCount = listTown ? (listBlocks?.length ?? null) : nationalCount;

  // The fixed minimum height keeps the list from shifting when the header's lines change, and
  // keying the contents replaces them (rather than nudging them sideways) when the back
  // button appears after a location fix.
  const sheetHeader = (
    <div aria-live="polite" className="min-h-[3.75rem]">
      <div key={headerKey} className="flex items-start gap-1">
        {backButton && (
          <button
            type="button"
            onClick={backButton.onClick}
            aria-label={backButton.label}
            title={backButton.label}
            className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
          >
            {BACK_ICON}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">{headline}</h2>
          {subline && <p className="mt-0.5 text-xs text-slate-600">{subline}</p>}
        </div>
        {headerAction}
      </div>
    </div>
  );

  const mapInsetStyle = { "--map-inset": `${bottomInsetFraction * 100}%` } as CSSProperties;

  return (
    <div className="absolute inset-0 flex flex-col">
      <a
        href={`#${LIST_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[1100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-md"
      >
        Skip to results list
      </a>

      <header className="relative z-[1001] flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">MOP Radar</p>
          <h1 className="truncate text-lg font-semibold leading-tight text-slate-900">{townName}</h1>
        </div>
        <button type="button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" className={HEADER_BUTTON_CLASS}>
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d="M3 5.75A.75.75 0 0 1 3.75 5h7.6a2.25 2.25 0 0 1 4.3 0h.6a.75.75 0 0 1 0 1.5h-.6a2.25 2.25 0 0 1-4.3 0h-7.6A.75.75 0 0 1 3 5.75Zm0 8.5a.75.75 0 0 1 .75-.75h.6a2.25 2.25 0 0 1 4.3 0h7.6a.75.75 0 0 1 0 1.5h-7.6a2.25 2.25 0 0 1-4.3 0h-.6a.75.75 0 0 1-.75-.75Z" />
          </svg>
          <span className="sr-only min-[400px]:not-sr-only">Filters</span>
          {filterCount > 0 && (
            <span className="rounded-full bg-teal-700 px-1.5 text-xs leading-5 text-white">
              {filterCount}
              <span className="sr-only"> on</span>
            </span>
          )}
        </button>
        <button
          type="button"
          aria-pressed={watchlistOpen}
          onClick={watchlistOpen ? closeWatchlist : openWatchlist}
          className={`${HEADER_BUTTON_CLASS} ${watchlistOpen ? "border-teal-700 bg-teal-50" : ""}`}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-5 w-5 ${watchlist.length > 0 ? "fill-amber-400 stroke-amber-600" : "fill-none stroke-current"}`}
            strokeWidth="1.75"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5z" />
          </svg>
          <span className="sr-only min-[400px]:not-sr-only">Watchlist</span>
          {watchlist.length > 0 && (
            <span className="rounded-full bg-slate-800 px-1.5 text-xs leading-5 text-white">
              {watchlist.length}
              <span className="sr-only"> saved</span>
            </span>
          )}
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* The list comes before the map in the DOM so keyboard and screen reader users reach results first. */}
        <ResultsSheet
          snap={snap}
          onSnapChange={setSnap}
          listId={LIST_ID}
          controls={panel === "list" && !detailOpen ? <ViewTabs view={view} onChange={showView} /> : undefined}
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
            selectedId={blockLink?.block ?? lastViewedId}
            watchedIds={watchedIdsOnMap}
            userLocation={userLocation}
            bottomInsetFraction={bottomInsetFraction}
            onSelectBlock={selectMapBlock}
            onSelectTown={showTown}
          />
          <MapLegend
            cohorts={cohortsForView(view, windowMonths)}
            showWatchlist={watchedIdsOnMap.length > 0}
            showUserLocation={userLocation !== null}
            className="absolute left-3 top-3 z-[900]"
          />
          {/* Below Leaflet's zoom buttons (10 px margin + two 30 px buttons with borders). */}
          {!locationUnsupported && (
            <div className="absolute right-[10px] top-[84px] z-[900] flex flex-row-reverse items-start gap-2">
              <button
                type="button"
                onClick={locateMe}
                disabled={locating}
                aria-busy={locating}
                aria-label="Show my location"
                title="Show my location"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded border-2 border-black/20 bg-white bg-clip-padding text-slate-800 hover:bg-slate-50 disabled:cursor-wait"
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`h-5 w-5 ${locating ? "animate-pulse motion-reduce:animate-none" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="2.5" fill="currentColor" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
              </button>
              <div role="status" aria-live="polite">
                {locateNote && (
                  <div className="flex max-w-[15rem] items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-800 shadow-md">
                    <span>{locateNote}</span>
                    <button
                      type="button"
                      onClick={() => setLocateNote(null)}
                      className="shrink-0 font-semibold text-teal-800 underline"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
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

      {filtersOpen && (
        <FilterSheet
          filters={filters}
          view={view}
          resultCount={filterResultCount}
          onChange={updateFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  );
}
