"use client";

import { formatNumber } from "@/lib/format";
import type { NeighbouringTown, ResultsView } from "@/lib/views";

export interface ViewAlternative {
  view: ResultsView;
  label: string;
  count: number;
}

interface EmptyStateProps {
  townName: string;
  views: readonly ViewAlternative[];
  towns: readonly NeighbouringTown[];
  onView: (view: ResultsView) => void;
  onTown: (slug: string) => void;
}

const OPTION_CLASS =
  "flex min-h-[44px] w-full items-center rounded-lg border border-slate-300 bg-white px-3 text-left font-medium text-teal-800 hover:bg-slate-50";

const blocks = (count: number) => `${formatNumber(count)} ${count === 1 ? "block" : "blocks"}`;

/** Shown under the sheet header, which already says there are no results. */
export function EmptyState({ townName, views, towns, onView, onTown }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm">
      {views.length > 0 && (
        <>
          <p className="font-semibold text-slate-900">Widen your search in {townName}</p>
          <ul className="mt-2 space-y-2">
            {views.map((option) => (
              <li key={option.view}>
                <button type="button" onClick={() => onView(option.view)} className={OPTION_CLASS}>
                  {option.label} · {blocks(option.count)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {towns.length > 0 && (
        <>
          <p className={`font-semibold text-slate-900 ${views.length > 0 ? "mt-4" : ""}`}>Or try a neighbouring town</p>
          <ul className="mt-2 space-y-2">
            {towns.map((town) => (
              <li key={town.slug}>
                <button type="button" onClick={() => onTown(town.slug)} className={OPTION_CLASS}>
                  {town.name} · {blocks(town.count)} · {town.km.toFixed(1)} km away
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {views.length === 0 && towns.length === 0 && (
        <p className="text-slate-700">Go back to all towns to pick another.</p>
      )}
    </div>
  );
}
