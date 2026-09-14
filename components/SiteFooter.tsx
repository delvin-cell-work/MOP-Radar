import { MOP_DISCLOSURE } from "@/lib/compliance";

/** Shared footer rendered by the root layout on every route. */
export function SiteFooter() {
  return (
    <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] leading-snug text-slate-600 sm:text-xs">
      <p>{MOP_DISCLOSURE}</p>
      {/* TODO(step 5): CEA salesperson name and registration number, agency name and licence number. */}
    </footer>
  );
}
