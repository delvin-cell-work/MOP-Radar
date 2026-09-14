"use client";

import { useEffect, useRef } from "react";

import { COHORT_COLORS } from "@/lib/cohort-style";
import type { DerivedBlock } from "@/lib/data-contract";
import { RESALE_FLAT_TYPES } from "@/lib/flat-types";
import { describeFlatMix, describeMop, formatNumber, formatPrice, formatStreet } from "@/lib/format";

import { MopStatusChip } from "./MopStatusChip";

interface BlockCardProps {
  block: DerivedBlock;
  townName: string;
  /** e.g. "Oct 2025 – Sep 2026" */
  priceWindow: string;
  selected: boolean;
  onSelect: (block: DerivedBlock) => void;
}

export function BlockCard({ block, townName, priceWindow, selected, onSelect }: BlockCardProps) {
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const mop = describeMop(block);
  const titleId = `block-${block.id}`;
  const prices = RESALE_FLAT_TYPES.flatMap((type) => {
    const stat = block.median_price_12mo[type.key];
    return stat ? [{ label: type.label, median: stat.median, count: stat.count }] : [];
  });

  return (
    <li>
      <article
        ref={cardRef}
        aria-labelledby={titleId}
        className={`relative rounded-xl border bg-white p-4 shadow-sm focus-within:ring-2 focus-within:ring-teal-700 ${
          selected ? "border-teal-700 ring-2 ring-teal-700" : "border-slate-200"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id={titleId} className="text-base font-semibold leading-snug text-slate-900">
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(block)}
              className="text-left after:absolute after:inset-0 after:rounded-xl focus:outline-none"
            >
              Blk {block.blk_no} {formatStreet(block.street)}
            </button>
          </h3>
          <MopStatusChip status={block.mop_status} />
        </div>
        <p className="mt-0.5 text-sm text-slate-600">
          {townName} · completed {block.year_completed}
        </p>

        <p className="mt-3 flex items-start gap-2 text-sm text-slate-800">
          <span
            aria-hidden="true"
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: COHORT_COLORS[block.cohort] }}
          />
          <span>
            <span className="font-semibold">{mop.headline}</span> · {mop.detail}
          </span>
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-slate-500">Flat types sold</dt>
            <dd className="text-slate-800">{describeFlatMix(block.flat_type_mix)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Units</dt>
            <dd className="text-slate-800">
              {formatNumber(block.sold_units)} sold
              {block.has_rental_units ? ` · ${formatNumber(block.rental_units)} rental` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Resales, last 12 months</dt>
            <dd className="text-slate-800">{formatNumber(block.last_12mo_transaction_count)}</dd>
          </div>
        </dl>

        {prices.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500">Median resale price, {priceWindow}</p>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-800">
              {prices.map((price) => (
                <li key={price.label} className="flex justify-between gap-3">
                  <span>{price.label}</span>
                  <span className="tabular-nums">
                    {formatPrice(price.median)}{" "}
                    <span className="text-slate-500">
                      ({price.count} {price.count === 1 ? "resale" : "resales"})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>
    </li>
  );
}
