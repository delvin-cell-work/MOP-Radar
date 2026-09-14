import { townBySlug } from "./towns";
import { BLOCK_ID_PATTERN } from "./watchlist";

/**
 * Block detail lives in the URL (`?town=<slug>&block=<id>`) so it can be shared
 * and closed with the browser's back gesture. Read through useSyncExternalStore
 * rather than Next's useSearchParams, which would client-render the whole page.
 */

export interface BlockLink {
  town: string;
  block: string;
}

const CHANGE_EVENT = "mop-radar:url-change";
const PUSHED_STATE_KEY = "mopRadarBlock";

export function parseBlockLink(search: string): BlockLink | null {
  const params = new URLSearchParams(search);
  const town = params.get("town");
  const block = params.get("block");
  if (!town || !block || !townBySlug(town) || !BLOCK_ID_PATTERN.test(block)) return null;
  return { town, block };
}

export function blockLinkSearch(link: BlockLink): string {
  return `?${new URLSearchParams({ town: link.town, block: link.block }).toString()}`;
}

export const readLocationSearch = () => window.location.search;
export const noSearchOnServer = () => "";

export function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function openedInApp(): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return Boolean(state && state[PUSHED_STATE_KEY]);
}

/**
 * Opens detail as a new history entry, so Back closes it. With `replace`
 * (switching from one open block to another) the current entry is reused, so
 * Back still returns to the results rather than stepping through each block.
 */
export function openBlockLink(link: BlockLink, { replace = false }: { replace?: boolean } = {}) {
  if (replace) {
    window.history.replaceState({ [PUSHED_STATE_KEY]: openedInApp() }, "", blockLinkSearch(link));
  } else {
    window.history.pushState({ [PUSHED_STATE_KEY]: true }, "", blockLinkSearch(link));
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Returns true when it went back through history (detail was opened in-app);
 * false when it cleared a link that was opened directly, e.g. from a shared URL.
 */
export function closeBlockLink(): boolean {
  if (openedInApp()) {
    window.history.back();
    return true;
  }
  window.history.replaceState(null, "", window.location.pathname);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return false;
}
