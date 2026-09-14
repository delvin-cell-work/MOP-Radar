"use client";

import type { TownSummary } from "@/lib/data-contract";
import { formatNumber } from "@/lib/format";

interface TownOverviewProps {
  towns: readonly TownSummary[];
  /** Results per town slug for the current tab and filters. */
  counts: Readonly<Record<string, number>>;
  onPick: (slug: string) => void;
}

/**
 * The national view's list: every town ranked by results for the current tab
 * and filters. Useful before a town is known, and doubles as the town picker
 * when location is unavailable.
 */
export function TownOverview({ towns, counts, onPick }: TownOverviewProps) {
  const ranked = towns
    .map((town) => ({ slug: town.slug, name: town.name, count: counts[town.slug] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {ranked.map((town) => (
        <li key={town.slug}>
          <button
            type="button"
            onClick={() => onPick(town.slug)}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left hover:bg-slate-50"
          >
            <span className="font-medium text-slate-900">{town.name}</span>
            <span className="shrink-0 text-sm tabular-nums text-slate-600">
              {formatNumber(town.count)} {town.count === 1 ? "block" : "blocks"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
