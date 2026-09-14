"use client";

import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

export type SheetSnap = "peek" | "half" | "full";

/** Share of the map area the sheet covers on mobile. */
export const SHEET_FRACTIONS: Record<SheetSnap, number> = { peek: 0.3, half: 0.56, full: 1 };

const SNAPS: readonly SheetSnap[] = ["peek", "half", "full"];
const MIN_HEIGHT_PX = 96;
const DRAG_THRESHOLD_PX = 6;

export function nearestSnap(fraction: number): SheetSnap {
  return SNAPS.reduce((best, snap) =>
    Math.abs(SHEET_FRACTIONS[snap] - fraction) < Math.abs(SHEET_FRACTIONS[best] - fraction) ? snap : best,
  );
}

interface DragState {
  startY: number;
  startHeight: number;
  areaHeight: number;
  moved: boolean;
}

interface ResultsSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  listId: string;
  /** Always-visible controls above the header, such as the results tabs. */
  controls: ReactNode;
  header: ReactNode;
  children: ReactNode;
}

/**
 * Bottom sheet on mobile (drag the handle, or tap it to step through sizes);
 * a fixed side panel from the lg breakpoint. Height is a CSS variable, so the
 * desktop layout never sees the mobile height and nothing shifts on hydration.
 */
export function ResultsSheet({ snap, onSnapChange, listId, controls, header, children }: ResultsSheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  const heightAt = (state: DragState, clientY: number) =>
    Math.min(state.areaHeight, Math.max(MIN_HEIGHT_PX, state.startHeight + state.startY - clientY));

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    const sheet = sheetRef.current;
    const area = sheet?.parentElement;
    if (!sheet || !area) return;
    suppressClickRef.current = false;
    dragRef.current = {
      startY: event.clientY,
      startHeight: sheet.getBoundingClientRect().height,
      areaHeight: area.getBoundingClientRect().height,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    if (!state) return;
    if (!state.moved && Math.abs(state.startY - event.clientY) < DRAG_THRESHOLD_PX) return;
    state.moved = true;
    setDragHeight(heightAt(state, event.clientY));
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    dragRef.current = null;
    if (!state || !state.moved) return;
    suppressClickRef.current = true;
    setDragHeight(null);
    onSnapChange(nearestSnap(heightAt(state, event.clientY) / state.areaHeight));
  }

  function handlePointerCancel() {
    dragRef.current = null;
    setDragHeight(null);
  }

  function handleClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSnapChange(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");
  }

  const style = {
    "--sheet-height": dragHeight === null ? `${SHEET_FRACTIONS[snap] * 100}%` : `${dragHeight}px`,
  } as CSSProperties;

  return (
    <section
      ref={sheetRef}
      aria-label="Results"
      style={style}
      className={`absolute inset-x-0 bottom-0 z-[1000] flex h-[var(--sheet-height)] flex-col rounded-t-2xl bg-white shadow-sheet lg:inset-y-0 lg:left-0 lg:right-auto lg:h-auto lg:w-[420px] lg:rounded-none lg:border-r lg:border-slate-200 lg:shadow-none ${
        dragHeight === null ? "transition-[height] duration-200 ease-out motion-reduce:transition-none" : ""
      }`}
    >
      <button
        type="button"
        aria-controls={listId}
        aria-expanded={snap !== "peek"}
        aria-label={snap === "full" ? "Collapse results list" : "Expand results list"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        className="flex h-8 w-full shrink-0 touch-none items-center justify-center rounded-t-2xl lg:hidden"
      >
        <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-slate-300" />
      </button>
      <div className="shrink-0 px-4 pb-3 lg:pt-4">{controls}</div>
      <div className="shrink-0 border-b border-slate-100 px-4 pb-3">{header}</div>
      <div id={listId} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 focus:outline-none">
        {children}
      </div>
    </section>
  );
}
