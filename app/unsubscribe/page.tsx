import type { Metadata } from "next";
import Link from "next/link";

import { UnsubscribeForm } from "@/components/UnsubscribeForm";

export const metadata: Metadata = {
  title: "Unsubscribe · MOP Radar",
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return (
    <main className="absolute inset-0 overflow-y-auto px-4 pb-8 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto max-w-md">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">MOP Radar</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Unsubscribe from MOP alerts</h1>
        <UnsubscribeForm />
        <Link href="/" className="mt-6 inline-flex min-h-[44px] items-center font-semibold text-teal-800 underline">
          Back to MOP Radar
        </Link>
      </div>
    </main>
  );
}
