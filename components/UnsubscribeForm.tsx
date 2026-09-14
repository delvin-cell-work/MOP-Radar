"use client";

import { useState, useSyncExternalStore } from "react";

import { UNSUBSCRIBE_TOKEN_PATTERN } from "@/lib/alerts";
import { noSearchOnServer, readLocationSearch, subscribeToLocation } from "@/lib/url-state";

type Status = "idle" | "sending" | "done" | "error";

const subscribeToNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

/** Reads the token from the link, so the page itself stays static. */
export function UnsubscribeForm() {
  // False on the server and during hydration, so both render the same (empty) markup before the token is read.
  const hydrated = useSyncExternalStore(subscribeToNothing, onClient, onServer);
  const search = useSyncExternalStore(subscribeToLocation, readLocationSearch, noSearchOnServer);
  const token = new URLSearchParams(search).get("token");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function unsubscribe() {
    if (!token) return;
    setStatus("sending");
    setMessage(null);
    try {
      const response = await fetch("/api/alerts/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "Couldn't unsubscribe you just now. Try again in a moment.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setMessage("Couldn't reach MOP Radar. Check your connection and try again.");
    }
  }

  if (!hydrated) return null;

  if (!token || !UNSUBSCRIBE_TOKEN_PATTERN.test(token)) {
    return (
      <p className="mt-4 text-base text-slate-700">
        This link is missing its unsubscribe code. Use the unsubscribe link in any MOP Radar alert email.
      </p>
    );
  }

  return (
    <div className="mt-4 text-base text-slate-700">
      <div role="status" aria-live="polite">
        {status === "done" && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            You&apos;re unsubscribed. We&apos;ve deleted your email address and saved blocks from the alert list.
          </p>
        )}
      </div>
      {status !== "done" && (
        <>
          <p>You&apos;ll stop getting emails about blocks on your watchlist, and we&apos;ll delete your email address.</p>
          {message && (
            <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              {message}
            </p>
          )}
          <button
            type="button"
            onClick={unsubscribe}
            disabled={status === "sending"}
            className="mt-4 min-h-[48px] w-full rounded-lg bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-70"
          >
            {status === "sending" ? "Unsubscribing…" : "Unsubscribe"}
          </button>
        </>
      )}
    </div>
  );
}
