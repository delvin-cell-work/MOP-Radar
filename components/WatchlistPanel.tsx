"use client";

import type { ReactNode } from "react";

import type { DerivedBlock } from "@/lib/data-contract";
import { townByCode, townBySlug } from "@/lib/towns";
import type { WatchlistEntry } from "@/lib/watchlist";

import { BlockCard } from "./BlockCard";

export interface WatchlistItem {
  entry: WatchlistEntry;
  /** Undefined while its town loads; null if the block is no longer in the data. */
  block: DerivedBlock | null | undefined;
}

interface WatchlistPanelProps {
  items: readonly WatchlistItem[];
  priceWindow: string;
  lastViewedId: string | null;
  onOpen: (block: DerivedBlock) => void;
  onToggleWatch: (block: DerivedBlock) => void;
  onRemove: (id: string) => void;
  /** Rendered under the list, e.g. the email alert signup. */
  footer?: ReactNode;
}

export function WatchlistPanel({
  items,
  priceWindow,
  lastViewedId,
  onOpen,
  onToggleWatch,
  onRemove,
  footer,
}: WatchlistPanelProps) {
  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">No blocks saved yet</p>
          <p className="mt-1">
            Tap the star on any block to save it here. Your watchlist is kept on this device only, with no account.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map(({ entry, block }) => {
            if (block === undefined) {
              return (
                <li
                  key={entry.id}
                  aria-hidden="true"
                  className="h-44 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none"
                />
              );
            }
            if (block === null) {
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 text-sm"
                >
                  <span className="text-slate-700">
                    A block in {townBySlug(entry.town)?.name ?? "this town"} is no longer in the latest data.
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(entry.id)}
                    className="min-h-[44px] shrink-0 rounded-lg border border-slate-300 px-3 font-semibold text-teal-800"
                  >
                    Remove
                  </button>
                </li>
              );
            }
            return (
              <BlockCard
                key={entry.id}
                block={block}
                townName={townByCode(block.town_code)?.name ?? ""}
                priceWindow={priceWindow}
                selected={block.id === lastViewedId}
                watched
                onOpen={onOpen}
                onToggleWatch={onToggleWatch}
              />
            );
          })}
        </ul>
      )}
      {footer}
    </div>
  );
}
