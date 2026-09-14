"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { agentDetails } from "@/lib/agent";
import { consentStatement, isLikelyEmail, PURPOSE_STATEMENT } from "@/lib/alerts";
import type { WatchlistEntry } from "@/lib/watchlist";

interface AlertSignupProps {
  watchlist: readonly WatchlistEntry[];
  /** The town the visitor is browsing, if any. */
  town: string | null;
}

type Status = "idle" | "sending" | "done" | "error";

const AGENT = agentDetails();
const CONSENT = consentStatement(AGENT);

/**
 * Optional "email me" signup under the watchlist. Never required to see results.
 * PDPA: the consent box starts unticked, is required, and states the purpose.
 */
export function AlertSignup({ watchlist, town }: AlertSignupProps) {
  const id = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; consent?: string }>({});
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [signedUpEmail, setSignedUpEmail] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    const nextErrors: { email?: string; consent?: string } = {};
    if (!isLikelyEmail(trimmed)) nextErrors.email = "Enter an email address, like name@example.com.";
    if (!consent) nextErrors.consent = "Tick the box to agree, so we're allowed to email you.";
    setErrors(nextErrors);
    if (nextErrors.email) {
      emailRef.current?.focus();
      return;
    }
    if (nextErrors.consent) {
      consentRef.current?.focus();
      return;
    }

    setStatus("sending");
    setMessage(null);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          consent: true,
          watchlist: watchlist.map((entry) => ({ id: entry.id, town: entry.town })),
          town,
          website: honeypotRef.current?.value ?? "",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "Couldn't sign you up. Try again in a moment.");
        return;
      }
      setSignedUpEmail(trimmed);
      setStatus("done");
    } catch {
      setStatus("error");
      setMessage("Couldn't reach MOP Radar. Check your connection and try again.");
    }
  }

  const headingId = `${id}-heading`;
  const emailErrorId = `${id}-email-error`;
  const consentErrorId = `${id}-consent-error`;

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <h3 id={headingId} className="text-base font-semibold text-slate-900">
        Email me when blocks on my watchlist hit MOP
      </h3>

      <div role="status" aria-live="polite">
        {status === "done" && signedUpEmail && (
          <div className="mt-2 text-slate-800">
            <p>
              You&apos;re signed up. We&apos;ll email <span className="font-semibold">{signedUpEmail}</span> when your{" "}
              {watchlist.length === 1 ? "saved block reaches" : "saved blocks reach"} MOP. Every email has an unsubscribe
              link.
            </p>
            <p className="mt-2 text-slate-600">Saved more blocks later? Sign up again with the same email to update them.</p>
            <button
              type="button"
              onClick={() => setStatus("idle")}
              className="mt-2 min-h-[44px] font-semibold text-teal-800 underline"
            >
              Update my alert
            </button>
          </div>
        )}
      </div>

      {status !== "done" && (
        <form noValidate onSubmit={handleSubmit} className="relative mt-2 space-y-3">
          <p className="text-slate-700">
            Optional. {PURPOSE_STATEMENT}
          </p>

          <div>
            <label htmlFor={`${id}-email`} className="block font-medium text-slate-900">
              Email address
            </label>
            <input
              ref={emailRef}
              id={`${id}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? emailErrorId : undefined}
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900"
            />
            {errors.email && (
              <p id={emailErrorId} className="mt-1 text-red-800">
                {errors.email}
              </p>
            )}
          </div>

          <div>
            <label className="flex items-start gap-3 text-slate-800">
              <input
                ref={consentRef}
                type="checkbox"
                required
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                aria-invalid={errors.consent ? true : undefined}
                aria-describedby={errors.consent ? consentErrorId : undefined}
                className="mt-0.5 h-5 w-5 shrink-0 accent-teal-700"
              />
              <span>{CONSENT}</span>
            </label>
            {errors.consent && (
              <p id={consentErrorId} className="mt-1 text-red-800">
                {errors.consent}
              </p>
            )}
          </div>

          {/* Left empty by people; filled by many bots. Hidden from screen readers and keyboard. */}
          <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
            <label>
              Website
              <input ref={honeypotRef} type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>

          {message && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "sending"}
            className="min-h-[44px] w-full rounded-lg bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-70"
          >
            {status === "sending" ? "Signing you up…" : "Email me"}
          </button>
        </form>
      )}
    </section>
  );
}
