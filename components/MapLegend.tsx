import { COHORT_COLORS, COHORT_LEGEND } from "@/lib/cohort-style";
import type { Cohort } from "@/lib/data-contract";

interface MapLegendProps {
  cohorts: readonly Cohort[];
  showWatchlist: boolean;
  showUserLocation: boolean;
  className?: string;
}

export function MapLegend({ cohorts, showWatchlist, showUserLocation, className = "" }: MapLegendProps) {
  return (
    <details className={`max-w-[16rem] rounded-lg bg-white text-xs text-slate-800 shadow-md ${className}`}>
      <summary className="cursor-pointer select-none px-3 py-2 font-semibold">Map key</summary>
      <ul className="space-y-1.5 px-3 pb-3">
        {cohorts.map((cohort) => (
          <li key={cohort} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: COHORT_COLORS[cohort] }}
            />
            {COHORT_LEGEND[cohort]}
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-slate-100 pt-1.5">
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-slate-500" />
          Resale on record
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border-2 border-slate-500 bg-white" />
          Estimated, no resale yet
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-full border-2 border-dashed border-slate-500 bg-white"
          />
          Approximate location
        </li>
        {showWatchlist && (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-amber-500 bg-white" />
            On your watchlist
          </li>
        )}
        {showUserLocation && (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="user-location__dot user-location__dot--legend" />
            You, roughly (shaded area shows accuracy)
          </li>
        )}
      </ul>
    </details>
  );
}
