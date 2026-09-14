"use client";

import { useState } from "react";

import { FLAT_TYPES } from "@/lib/flat-types";
import {
  formatArea,
  formatMonthLabel,
  formatNumber,
  formatPrice,
  formatRemainingLease,
  formatStoreyRange,
} from "@/lib/format";
import type { Transaction } from "@/lib/transactions";

const INITIAL_ROWS = 20;

const flatTypeLabel = (key: string) => FLAT_TYPES.find((type) => type.key === key)?.label ?? key;

/** Every resale on record for the block, newest first. */
export function TransactionTable({ transactions }: { transactions: readonly Transaction[] }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? transactions : transactions.slice(0, INITIAL_ROWS);

  return (
    <div>
      {/* Outside the scrolling table, so it wraps to the panel width instead of scrolling with the columns. */}
      <p aria-hidden="true" className="mb-1 text-xs text-slate-500">
        {formatNumber(transactions.length)} {transactions.length === 1 ? "resale" : "resales"} since Jan 2017, newest
        first. Month is when the resale was registered.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <caption className="sr-only">
            {formatNumber(transactions.length)} {transactions.length === 1 ? "resale" : "resales"} since Jan 2017, newest
            first. Month is when the resale was registered.
          </caption>
          <thead className="text-xs text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Month
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Flat type
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Storey
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Area
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Price
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Lease left
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums text-slate-800">
            {rows.map((transaction, index) => (
              <tr key={index}>
                <td className="px-3 py-2">{formatMonthLabel(transaction.month)}</td>
                <td className="px-3 py-2">{flatTypeLabel(transaction.flatType)}</td>
                <td className="px-3 py-2">{formatStoreyRange(transaction.storeyRange)}</td>
                <td className="px-3 py-2">{formatArea(transaction.floorAreaSqm)}</td>
                <td className="px-3 py-2 text-right">{formatPrice(transaction.resalePrice)}</td>
                <td className="px-3 py-2">{formatRemainingLease(transaction.remainingLeaseMonths)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && transactions.length > INITIAL_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white font-semibold text-teal-800 hover:bg-slate-50"
        >
          Show all {formatNumber(transactions.length)} resales
        </button>
      )}
    </div>
  );
}
