import { COHORT_COLORS, COHORT_LEGEND } from "@/lib/cohort-style";
import { viewOption, type ResultsView } from "@/lib/views";

export function MapLegend({ view, className = "" }: { view: ResultsView; className?: string }) {
  return (
    <details className={`max-w-[16rem] rounded-lg bg-white text-xs text-slate-800 shadow-md ${className}`}>
      <summary className="cursor-pointer select-none px-3 py-2 font-semibold">Map key</summary>
      <ul className="space-y-1.5 px-3 pb-3">
        {viewOption(view).cohorts.map((cohort) => (
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
      </ul>
    </details>
  );
}
