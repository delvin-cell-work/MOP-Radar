"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import {
  activeFilterCount,
  BLOCK_AGE_OPTIONS,
  DEFAULT_FILTERS,
  MOP_WINDOW_STEPS,
  RESALE_ACTIVITY_OPTIONS,
  type Filters,
} from "@/lib/filters";
import { FLAT_TYPES, type FlatTypeKey } from "@/lib/flat-types";
import { formatNumber } from "@/lib/format";
import type { ResultsView } from "@/lib/views";

interface FilterSheetProps {
  filters: Filters;
  view: ResultsView;
  /** Matching blocks for the current place and tab, or null while loading. */
  resultCount: number | null;
  onChange: (filters: Filters) => void;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const windowLabel = (months: number) => (months % 12 === 0 && months >= 24 ? `${months / 12} years` : `${months} months`);

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

const GROUP_CLASS = "border-t border-slate-100 px-4 py-4";
const LEGEND_CLASS = "text-sm font-semibold text-slate-900";
const CHECK_CLASS = "h-5 w-5 shrink-0 accent-teal-700";
const OPTION_CLASS = "flex min-h-[44px] items-center gap-3 text-sm text-slate-800";

/**
 * Filters apply as they change; the footer button closes the sheet. A bottom
 * sheet on mobile and a panel over the results list from lg. Not <dialog>,
 * which needs Safari 15.4.
 */
export function FilterSheet({ filters, view, resultCount, onChange, onClose }: FilterSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const set = (changes: Partial<Filters>) => onChange({ ...filters, ...changes });
  const windowIndex = Math.max(0, MOP_WINDOW_STEPS.indexOf(filters.mopWindowMonths));
  const windowApplies = view !== "all";
  const activeCount = activeFilterCount(filters);

  return (
    <div className="fixed inset-0 z-[1200]">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-title"
        onKeyDown={handleKeyDown}
        className="absolute inset-x-0 bottom-0 flex max-h-[85%] flex-col rounded-t-2xl bg-white shadow-sheet lg:inset-y-0 lg:left-0 lg:right-auto lg:max-h-none lg:w-[420px] lg:rounded-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 py-2 pl-4 pr-2">
          <h2 id="filters-title" className="text-base font-semibold text-slate-900">
            Filters
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="px-4 py-4">
            <label htmlFor="filter-mop-window" className={LEGEND_CLASS}>
              MOP window: within {windowLabel(filters.mopWindowMonths)}
            </label>
            <p id="filter-mop-window-help" className="mt-0.5 text-xs text-slate-600">
              {windowApplies
                ? "How far back “Just passed MOP” and how far ahead “Coming up” reach."
                : "Applies to the “Just passed MOP” and “Coming up” tabs."}
            </p>
            <input
              id="filter-mop-window"
              type="range"
              min={0}
              max={MOP_WINDOW_STEPS.length - 1}
              step={1}
              value={windowIndex}
              aria-valuetext={windowLabel(filters.mopWindowMonths)}
              aria-describedby="filter-mop-window-help"
              onChange={(event) => set({ mopWindowMonths: MOP_WINDOW_STEPS[Number(event.target.value)] })}
              className="mt-3 h-11 w-full accent-teal-700"
            />
            <div aria-hidden="true" className="flex justify-between text-[11px] text-slate-500">
              <span>{windowLabel(MOP_WINDOW_STEPS[0])}</span>
              <span>{windowLabel(MOP_WINDOW_STEPS[MOP_WINDOW_STEPS.length - 1])}</span>
            </div>
          </div>

          <fieldset className={GROUP_CLASS}>
            <legend className={`${LEGEND_CLASS} float-left w-full`}>Flat types</legend>
            <p className="clear-both pt-0.5 text-xs text-slate-600">Show blocks with any of these. None ticked shows all.</p>
            <div className="mt-1 grid grid-cols-1 gap-x-4 min-[360px]:grid-cols-2">
              {FLAT_TYPES.map((type) => (
                <label key={type.key} className={OPTION_CLASS}>
                  <input
                    type="checkbox"
                    checked={filters.flatTypes.includes(type.key)}
                    onChange={() => set({ flatTypes: toggle(filters.flatTypes, type.key) })}
                    className={CHECK_CLASS}
                  />
                  {type.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className={GROUP_CLASS}>
            <label htmlFor="filter-exclude-type" className={LEGEND_CLASS}>
              Leave out blocks with
            </label>
            <select
              id="filter-exclude-type"
              value={filters.excludeFlatType ?? ""}
              onChange={(event) => set({ excludeFlatType: (event.target.value || null) as FlatTypeKey | null })}
              className="mt-2 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900"
            >
              <option value="">No flat type left out</option>
              {FLAT_TYPES.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label} flats
                </option>
              ))}
            </select>
            <label className={`${OPTION_CLASS} mt-2`}>
              <input
                type="checkbox"
                checked={filters.excludeRental}
                onChange={(event) => set({ excludeRental: event.target.checked })}
                className={CHECK_CLASS}
              />
              Leave out blocks with rental flats
            </label>
          </div>

          <fieldset className={GROUP_CLASS}>
            <legend className={`${LEGEND_CLASS} float-left w-full`}>Block age</legend>
            <div className="clear-both mt-1 grid grid-cols-1 gap-x-4 min-[360px]:grid-cols-2">
              {BLOCK_AGE_OPTIONS.map((option) => (
                <label key={option.value} className={OPTION_CLASS}>
                  <input
                    type="radio"
                    name="filter-block-age"
                    value={option.value}
                    checked={filters.blockAge === option.value}
                    onChange={() => set({ blockAge: option.value })}
                    className={CHECK_CLASS}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={GROUP_CLASS}>
            <legend className={`${LEGEND_CLASS} float-left w-full`}>Resales in the last 12 months</legend>
            <p className="clear-both pt-0.5 text-xs text-slate-600">None ticked shows all.</p>
            <div className="mt-1 grid grid-cols-1 gap-x-4 min-[360px]:grid-cols-2">
              {RESALE_ACTIVITY_OPTIONS.map((option) => (
                <label key={option.value} className={OPTION_CLASS}>
                  <input
                    type="checkbox"
                    checked={filters.activity.includes(option.value)}
                    onChange={() => set({ activity: toggle(filters.activity, option.value) })}
                    className={CHECK_CLASS}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-200 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            disabled={activeCount === 0}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-lg bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800"
          >
            {resultCount === null
              ? "Show results"
              : `Show ${formatNumber(resultCount)} ${resultCount === 1 ? "block" : "blocks"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
