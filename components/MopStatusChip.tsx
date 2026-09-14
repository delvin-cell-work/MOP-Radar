import type { MopStatus } from "@/lib/data-contract";

/**
 * "Resale on record" rather than "Confirmed": the status comes from public
 * resale data, and must never read as confirmation from HDB.
 */
export function MopStatusChip({ status }: { status: MopStatus }) {
  if (status === "estimated") {
    return (
      <span className="shrink-0 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
        Estimated
      </span>
    );
  }
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900">
      Resale on record
    </span>
  );
}
