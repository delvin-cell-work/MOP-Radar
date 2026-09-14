"use client";

import { useEffect, useRef } from "react";

import type { DerivedBlock } from "@/lib/data-contract";
import { blockTitle } from "@/lib/format";

import { BlockSummary } from "./BlockSummary";
import { MopStatusChip } from "./MopStatusChip";
import { WatchStar } from "./WatchStar";

interface BlockCardProps {
  block: DerivedBlock;
  townName: string;
  /** e.g. "Oct 2025 – Sep 2026" */
  priceWindow: string;
  /** The block last opened, outlined so it's easy to find again after closing its detail. */
  selected: boolean;
  watched: boolean;
  onOpen: (block: DerivedBlock) => void;
  onToggleWatch: (block: DerivedBlock) => void;
}

export function BlockCard({ block, townName, priceWindow, selected, watched, onOpen, onToggleWatch }: BlockCardProps) {
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const title = blockTitle(block);
  const titleId = `block-${block.id}`;

  return (
    <li>
      <article
        ref={cardRef}
        aria-labelledby={titleId}
        className={`relative rounded-xl border bg-white p-4 shadow-sm focus-within:ring-2 focus-within:ring-teal-700 ${
          selected ? "border-teal-700 ring-2 ring-teal-700" : "border-slate-200"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="min-w-0 pt-0.5 text-base font-semibold leading-snug text-slate-900">
            <button
              type="button"
              onClick={() => onOpen(block)}
              className="text-left after:absolute after:inset-0 after:rounded-xl focus:outline-none"
            >
              {title}
            </button>
          </h3>
          <div className="-mr-2 -mt-2 flex shrink-0 items-center gap-1">
            <MopStatusChip status={block.mop_status} />
            <WatchStar watched={watched} title={title} onToggle={() => onToggleWatch(block)} />
          </div>
        </div>
        <p className="mt-0.5 text-sm text-slate-600">
          {townName} · completed {block.year_completed}
        </p>

        <BlockSummary block={block} priceWindow={priceWindow} />
      </article>
    </li>
  );
}
