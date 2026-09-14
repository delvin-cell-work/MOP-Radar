/**
 * Email alert signup text and checks shared by the form and the API. Kept free
 * of Zod so the form doesn't ship the validator; the API's schema lives in
 * alert-schema.ts.
 */

/** Bump when the consent statement's meaning changes, so stored consents say which version was agreed. */
export const CONSENT_VERSION = "2026-09-15";

export const ALERT_WATCHLIST_MAX = 200;

/** The PDPA consent the visitor ticks. Stored with each signup exactly as shown. */
export function consentStatement(agent: { name: string; agencyName: string } | null): string {
  const who = agent ? `${agent.name} of ${agent.agencyName}` : "the property agent behind MOP Radar";
  return (
    `I agree that ${who} may use my email address to tell me when blocks on my watchlist reach their MOP, ` +
    "and to contact me about those blocks. I can unsubscribe at any time."
  );
}

export const PURPOSE_STATEMENT =
  "We keep your email address, your saved blocks, your town and when you agreed, only for these alerts. " +
  "Every email has an unsubscribe link, and unsubscribing deletes all of it.";

/** A light check for the form. The API validates properly. */
export function isLikelyEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Unsubscribe tokens are 32 random bytes, base64url-encoded. */
export const UNSUBSCRIBE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
