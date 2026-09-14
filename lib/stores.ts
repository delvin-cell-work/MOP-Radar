import { DEFAULT_FILTERS, parseFilters } from "./filters";
import { createLocalStore } from "./local-store";
import { parseWatchlist, type WatchlistEntry } from "./watchlist";

const NO_WATCHLIST: WatchlistEntry[] = [];

/** Per-device state. Never sent anywhere. */
export const filtersStore = createLocalStore("mop-radar:filters:v1", parseFilters, DEFAULT_FILTERS);
export const watchlistStore = createLocalStore("mop-radar:watchlist:v1", parseWatchlist, NO_WATCHLIST);
