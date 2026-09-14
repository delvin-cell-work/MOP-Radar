"use client";

import { RESULTS_VIEWS, type ResultsView } from "@/lib/views";

interface ViewTabsProps {
  view: ResultsView;
  onChange: (view: ResultsView) => void;
  className?: string;
}

/** Segmented control built from native radio inputs, so arrow keys and screen readers work as expected. */
export function ViewTabs({ view, onChange, className = "" }: ViewTabsProps) {
  return (
    <fieldset className={`min-w-0 ${className}`}>
      <legend className="sr-only">Results to show</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {RESULTS_VIEWS.map((option) => (
          <label key={option.value} className="block">
            <input
              type="radio"
              name="results-view"
              value={option.value}
              checked={view === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="flex h-10 cursor-pointer items-center justify-center rounded-lg px-1 text-center text-sm font-medium leading-tight text-slate-700 peer-checked:bg-white peer-checked:font-semibold peer-checked:text-slate-900 peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-teal-700">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
