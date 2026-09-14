/**
 * Email alert signups in Redis, through Upstash's REST API (what Vercel's
 * "Upstash for Redis" / KV integration provides). Server-side only: it needs
 * the store's token. No SDK, just fetch.
 *
 * Keys:
 *   mop-radar:alerts:signup:<sha256(email)>  JSON AlertSignupRecord
 *   mop-radar:alerts:token:<token>           sha256(email), for unsubscribing
 *   mop-radar:alerts:signups                 set of every sha256(email)
 */

export interface AlertStoreConfig {
  url: string;
  token: string;
}

export interface AlertSignupRecord {
  email: string;
  watchlist: { id: string; town: string }[];
  town: string | null;
  consented_at: string;
  consent_statement: string;
  consent_version: string;
  created_at: string;
  updated_at: string;
  unsubscribe_token: string;
  /** Put this in every alert email. */
  unsubscribe_url: string;
  /** For the List-Unsubscribe header, with List-Unsubscribe-Post: List-Unsubscribe=One-Click. */
  one_click_unsubscribe_url: string;
}

interface Dependencies {
  fetch: typeof fetch;
  randomToken: () => string;
}

const PREFIX = "mop-radar:alerts";
const SIGNUPS_KEY = `${PREFIX}:signups`;
const signupKey = (hash: string) => `${PREFIX}:signup:${hash}`;
const tokenKey = (token: string) => `${PREFIX}:token:${token}`;

export function alertStoreConfig(env: Readonly<Record<string, string | undefined>> = process.env): AlertStoreConfig | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function emailHash(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_DEPENDENCIES: Dependencies = { fetch: (...args) => fetch(...args), randomToken };

async function send(
  config: AlertStoreConfig,
  endpoint: "pipeline" | "multi-exec",
  commands: string[][],
  dependencies: Dependencies,
): Promise<unknown[]> {
  const response = await dependencies.fetch(`${config.url}/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) {
    const detail = payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "";
    throw new Error(`Alert store request failed (HTTP ${response.status}) ${detail}`.trim());
  }
  return payload.map((item: { result?: unknown; error?: string }) => {
    if (item && item.error) throw new Error(`Alert store command failed: ${item.error}`);
    return item?.result ?? null;
  });
}

/**
 * Saves or updates a signup. Signing up again with the same email replaces the
 * watchlist, town and consent time, and keeps the unsubscribe token.
 */
export async function saveSignup(
  config: AlertStoreConfig,
  input: { email: string; watchlist: { id: string; town: string }[]; town: string | null },
  context: { now: string; siteUrl: string; consentStatement: string; consentVersion: string },
  dependencies: Dependencies = DEFAULT_DEPENDENCIES,
): Promise<AlertSignupRecord> {
  const hash = await emailHash(input.email);
  const [existingRaw] = await send(config, "pipeline", [["GET", signupKey(hash)]], dependencies);
  let existing: Partial<AlertSignupRecord> | null = null;
  if (typeof existingRaw === "string") {
    try {
      existing = JSON.parse(existingRaw) as Partial<AlertSignupRecord>;
    } catch {
      existing = null;
    }
  }

  const token = existing?.unsubscribe_token ?? dependencies.randomToken();
  const record: AlertSignupRecord = {
    email: input.email,
    watchlist: input.watchlist.map(({ id, town }) => ({ id, town })),
    town: input.town,
    consented_at: context.now,
    consent_statement: context.consentStatement,
    consent_version: context.consentVersion,
    created_at: existing?.created_at ?? context.now,
    updated_at: context.now,
    unsubscribe_token: token,
    unsubscribe_url: `${context.siteUrl}/unsubscribe?token=${token}`,
    one_click_unsubscribe_url: `${context.siteUrl}/api/alerts/unsubscribe?token=${token}`,
  };

  await send(
    config,
    "multi-exec",
    [
      ["SET", signupKey(hash), JSON.stringify(record)],
      ["SET", tokenKey(token), hash],
      ["SADD", SIGNUPS_KEY, hash],
    ],
    dependencies,
  );
  return record;
}

/** Deletes the signup for a token. Returns false when the token is unknown (e.g. already unsubscribed). */
export async function deleteSignup(
  config: AlertStoreConfig,
  token: string,
  dependencies: Dependencies = DEFAULT_DEPENDENCIES,
): Promise<boolean> {
  const [hash] = await send(config, "pipeline", [["GET", tokenKey(token)]], dependencies);
  if (typeof hash !== "string") return false;
  await send(
    config,
    "multi-exec",
    [
      ["DEL", signupKey(hash)],
      ["DEL", tokenKey(token)],
      ["SREM", SIGNUPS_KEY, hash],
    ],
    dependencies,
  );
  return true;
}
