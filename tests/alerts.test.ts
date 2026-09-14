import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as signupPost } from "../app/api/alerts/route";
import { POST as unsubscribePost } from "../app/api/alerts/unsubscribe/route";
import { agentDetails, agentEnvErrorMessage, missingAgentEnv, REQUIRED_AGENT_ENV } from "../lib/agent";
import { alertSignupSchema, unsubscribeTokenSchema } from "../lib/alert-schema";
import { alertStoreConfig, deleteSignup, emailHash, randomToken, saveSignup } from "../lib/alert-store";
import { consentStatement, isLikelyEmail, PURPOSE_STATEMENT } from "../lib/alerts";
import { isSameOrigin, requestOrigin } from "../lib/request-origin";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const TOKEN = "a".repeat(43);
const validSignup = {
  email: "  Buyer@Example.COM ",
  consent: true,
  watchlist: [{ id: "111a-alkaff-cres", town: "toa-payoh" }],
  town: "toa-payoh",
  website: "",
};

/** A tiny in-memory stand-in for Upstash's REST API. */
function fakeUpstash() {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const calls: { endpoint: string; commands: string[][] }[] = [];
  const run = ([command, key, value]: string[]): unknown => {
    switch (command) {
      case "GET":
        return strings.get(key) ?? null;
      case "SET":
        strings.set(key, value);
        return "OK";
      case "DEL":
        return strings.delete(key) ? 1 : 0;
      case "SADD":
        if (!sets.has(key)) sets.set(key, new Set());
        sets.get(key)!.add(value);
        return 1;
      case "SREM":
        return sets.get(key)?.delete(value) ? 1 : 0;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  };
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const endpoint = String(url).split("/").pop()!;
    const commands = JSON.parse(String(init?.body)) as string[][];
    calls.push({ endpoint, commands });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
    return Response.json(commands.map((command) => ({ result: run(command) })));
  });
  return { strings, sets, calls, fetch: fetchImpl as unknown as typeof fetch };
}

const CONFIG = { url: "https://store.example", token: "secret" };
const CONTEXT = {
  now: "2026-09-15T02:00:00.000Z",
  siteUrl: "https://mop-radar.vercel.app",
  consentStatement: "I agree.",
  consentVersion: "2026-09-15",
};

describe("agent environment", () => {
  const complete = {
    NEXT_PUBLIC_AGENT_NAME: "Delvin Goh",
    NEXT_PUBLIC_CEA_REG_NO: "R000000A",
    NEXT_PUBLIC_AGENCY_NAME: "Example Realty",
    NEXT_PUBLIC_AGENCY_LICENCE_NO: "L0000000A",
    NEXT_PUBLIC_AGENT_WHATSAPP: "+65 9123 4567",
  };

  it("passes when every detail is set", () => {
    expect(missingAgentEnv(complete)).toEqual([]);
  });

  it("names blank, missing and invalid details", () => {
    expect(missingAgentEnv({ ...complete, NEXT_PUBLIC_CEA_REG_NO: "  ", NEXT_PUBLIC_AGENT_WHATSAPP: "call me" })).toEqual([
      "NEXT_PUBLIC_CEA_REG_NO",
      "NEXT_PUBLIC_AGENT_WHATSAPP",
    ]);
    expect(missingAgentEnv({})).toEqual([...REQUIRED_AGENT_ENV]);
    expect(agentEnvErrorMessage(["NEXT_PUBLIC_AGENT_NAME"])).toContain("NEXT_PUBLIC_AGENT_NAME");
  });

  it("returns footer details only when all four are set", () => {
    expect(agentDetails({ name: "A", ceaRegNo: "R1", agencyName: "B", agencyLicenceNo: "L1" })).toEqual({
      name: "A",
      ceaRegNo: "R1",
      agencyName: "B",
      agencyLicenceNo: "L1",
    });
    expect(agentDetails({ name: "A", ceaRegNo: "R1", agencyName: "B" })).toBeNull();
  });
});

describe("alert text", () => {
  it("names the agent and agency in the consent statement, without valuation language", () => {
    const text = consentStatement({ name: "Delvin Goh", agencyName: "Example Realty" });
    expect(text).toContain("Delvin Goh of Example Realty");
    expect(text).toMatch(/unsubscribe at any time/);
    expect(`${text} ${PURPOSE_STATEMENT}`).not.toMatch(/value|price|deal/i);
  });

  it.each([
    ["name@example.com", true],
    ["name@example", false],
    ["name example.com", false],
    ["", false],
  ])("isLikelyEmail(%j) → %s", (value, expected) => {
    expect(isLikelyEmail(value)).toBe(expected);
  });
});

describe("alertSignupSchema", () => {
  it("normalises the email", () => {
    const parsed = alertSignupSchema.parse(validSignup);
    expect(parsed.email).toBe("buyer@example.com");
  });

  it.each([
    ["an invalid email", { email: "nope" }],
    ["no consent", { consent: false }],
    ["consent as a string", { consent: "true" }],
    ["an empty watchlist", { watchlist: [] }],
    ["an unknown town", { town: "atlantis" }],
    ["a malformed block id", { watchlist: [{ id: "<b>", town: "toa-payoh" }] }],
    ["too many blocks", { watchlist: Array.from({ length: 201 }, (_, i) => ({ id: `b${i}`, town: "bedok" })) }],
  ])("rejects %s", (_label, change) => {
    expect(alertSignupSchema.safeParse({ ...validSignup, ...change }).success).toBe(false);
  });

  it("accepts browsing without a town", () => {
    expect(alertSignupSchema.safeParse({ ...validSignup, town: null }).success).toBe(true);
  });

  it("checks unsubscribe tokens", () => {
    expect(unsubscribeTokenSchema.safeParse(randomToken()).success).toBe(true);
    expect(unsubscribeTokenSchema.safeParse("short").success).toBe(false);
    expect(unsubscribeTokenSchema.safeParse(`${TOKEN}!`).success).toBe(false);
  });
});

describe("alert store", () => {
  it("reads Vercel KV or Upstash variable names", () => {
    expect(alertStoreConfig({ KV_REST_API_URL: "https://kv.example/", KV_REST_API_TOKEN: "t" })).toEqual({
      url: "https://kv.example",
      token: "t",
    });
    expect(alertStoreConfig({ UPSTASH_REDIS_REST_URL: "https://u.example", UPSTASH_REDIS_REST_TOKEN: "t" })).toEqual({
      url: "https://u.example",
      token: "t",
    });
    expect(alertStoreConfig({ KV_REST_API_URL: "https://kv.example" })).toBeNull();
  });

  it("stores a signup with consent, unsubscribe links and an index entry", async () => {
    const store = fakeUpstash();
    const record = await saveSignup(
      CONFIG,
      { email: "buyer@example.com", watchlist: validSignup.watchlist, town: "toa-payoh" },
      CONTEXT,
      { fetch: store.fetch, randomToken: () => TOKEN },
    );
    const hash = await emailHash("buyer@example.com");
    expect(record).toMatchObject({
      email: "buyer@example.com",
      town: "toa-payoh",
      consented_at: CONTEXT.now,
      consent_statement: "I agree.",
      unsubscribe_url: `https://mop-radar.vercel.app/unsubscribe?token=${TOKEN}`,
      one_click_unsubscribe_url: `https://mop-radar.vercel.app/api/alerts/unsubscribe?token=${TOKEN}`,
    });
    expect(JSON.parse(store.strings.get(`mop-radar:alerts:signup:${hash}`)!)).toEqual(record);
    expect(store.strings.get(`mop-radar:alerts:token:${TOKEN}`)).toBe(hash);
    expect(store.sets.get("mop-radar:alerts:signups")?.has(hash)).toBe(true);
    expect(store.calls.map((call) => call.endpoint)).toEqual(["pipeline", "multi-exec"]);
    expect(JSON.stringify(store.calls)).not.toContain(`token:${hash}`);
  });

  it("keeps the unsubscribe token and first signup time when the same email signs up again", async () => {
    const store = fakeUpstash();
    const input = { email: "buyer@example.com", watchlist: validSignup.watchlist, town: null };
    await saveSignup(CONFIG, input, CONTEXT, { fetch: store.fetch, randomToken: () => TOKEN });
    const second = await saveSignup(
      CONFIG,
      { ...input, watchlist: [...input.watchlist, { id: "1-bedok-nth-rd", town: "bedok" }] },
      { ...CONTEXT, now: "2026-10-01T00:00:00.000Z" },
      { fetch: store.fetch, randomToken: () => "b".repeat(43) },
    );
    expect(second.unsubscribe_token).toBe(TOKEN);
    expect(second.created_at).toBe(CONTEXT.now);
    expect(second.consented_at).toBe("2026-10-01T00:00:00.000Z");
    expect(second.watchlist).toHaveLength(2);
    expect(store.sets.get("mop-radar:alerts:signups")?.size).toBe(1);
  });

  it("deletes everything for a token, and reports unknown tokens", async () => {
    const store = fakeUpstash();
    await saveSignup(
      CONFIG,
      { email: "buyer@example.com", watchlist: validSignup.watchlist, town: null },
      CONTEXT,
      { fetch: store.fetch, randomToken: () => TOKEN },
    );
    await expect(deleteSignup(CONFIG, TOKEN, { fetch: store.fetch, randomToken })).resolves.toBe(true);
    expect(store.strings.size).toBe(0);
    expect(store.sets.get("mop-radar:alerts:signups")?.size).toBe(0);
    await expect(deleteSignup(CONFIG, TOKEN, { fetch: store.fetch, randomToken })).resolves.toBe(false);
  });

  it("throws on store errors", async () => {
    const failing = (async () => Response.json({ error: "WRONGPASS" }, { status: 401 })) as unknown as typeof fetch;
    await expect(
      saveSignup(CONFIG, { email: "a@b.co", watchlist: [], town: null }, CONTEXT, { fetch: failing, randomToken }),
    ).rejects.toThrow(/HTTP 401/);
    const commandError = (async () => Response.json([{ error: "ERR bad" }])) as unknown as typeof fetch;
    await expect(deleteSignup(CONFIG, TOKEN, { fetch: commandError, randomToken })).rejects.toThrow(/ERR bad/);
  });

  it("makes 43-character URL-safe tokens", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });
});

describe("request origin", () => {
  it("uses Vercel's forwarded headers", () => {
    const request = new Request("http://internal/api/alerts", {
      headers: { "x-forwarded-host": "mop-radar.vercel.app", "x-forwarded-proto": "https" },
    });
    expect(requestOrigin(request)).toBe("https://mop-radar.vercel.app");
  });

  it("rejects cross-site browser requests", () => {
    const same = new Request("https://mop-radar.vercel.app/api/alerts", {
      headers: { origin: "https://mop-radar.vercel.app", host: "mop-radar.vercel.app" },
    });
    const cross = new Request("https://mop-radar.vercel.app/api/alerts", {
      headers: { origin: "https://evil.example", host: "mop-radar.vercel.app" },
    });
    expect(isSameOrigin(same)).toBe(true);
    expect(isSameOrigin(cross)).toBe(false);
    expect(isSameOrigin(new Request("https://mop-radar.vercel.app/api/alerts"))).toBe(true);
  });
});

describe("POST /api/alerts", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    signupPost(
      new Request("https://mop-radar.vercel.app/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json", host: "mop-radar.vercel.app", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  function configureStore() {
    vi.stubEnv("KV_REST_API_URL", "https://store.example");
    vi.stubEnv("KV_REST_API_TOKEN", "secret");
    const store = fakeUpstash();
    vi.stubGlobal("fetch", store.fetch);
    return store;
  }

  it("is unavailable without a store", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect((await post(validSignup)).status).toBe(503);
  });

  it("stores a valid signup", async () => {
    const store = configureStore();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mop-radar.vercel.app/");
    const response = await post(validSignup, { origin: "https://mop-radar.vercel.app" });
    expect(response.status).toBe(201);
    const [saved] = Array.from(store.strings.entries()).filter(([key]) => key.includes(":signup:"));
    const record = JSON.parse(saved[1]);
    expect(record.email).toBe("buyer@example.com");
    expect(record.unsubscribe_url).toMatch(/^https:\/\/mop-radar\.vercel\.app\/unsubscribe\?token=/);
  });

  it.each([
    ["invalid JSON", "{", 400],
    ["missing consent", { ...validSignup, consent: false }, 400],
    ["an oversized body", JSON.stringify({ ...validSignup, website: "x".repeat(21_000) }), 413],
  ])("rejects %s", async (_label, body, status) => {
    configureStore();
    expect((await post(body)).status).toBe(status);
  });

  it("rejects other sites", async () => {
    configureStore();
    expect((await post(validSignup, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("pretends to accept bots that fill the hidden field, and stores nothing", async () => {
    const store = configureStore();
    expect((await post({ ...validSignup, website: "http://spam.example" })).status).toBe(201);
    expect(store.calls).toHaveLength(0);
  });

  it("reports store failures without leaking details", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://store.example");
    vi.stubEnv("KV_REST_API_TOKEN", "secret");
    vi.stubGlobal("fetch", async () => Response.json({ error: "WRONGPASS" }, { status: 401 }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(validSignup);
    expect(response.status).toBe(502);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("buyer@example.com");
    errorLog.mockRestore();
  });
});

describe("POST /api/alerts/unsubscribe", () => {
  it("deletes a signup by query token (one-click) or JSON body, and accepts repeats", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://store.example");
    vi.stubEnv("KV_REST_API_TOKEN", "secret");
    const store = fakeUpstash();
    vi.stubGlobal("fetch", store.fetch);
    await saveSignup(
      CONFIG,
      { email: "buyer@example.com", watchlist: validSignup.watchlist, town: null },
      CONTEXT,
      { fetch: store.fetch, randomToken: () => TOKEN },
    );

    const oneClick = await unsubscribePost(
      new Request(`https://mop-radar.vercel.app/api/alerts/unsubscribe?token=${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(oneClick.status).toBe(200);
    expect(store.strings.size).toBe(0);

    const again = await unsubscribePost(
      new Request("https://mop-radar.vercel.app/api/alerts/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ token: TOKEN }),
      }),
    );
    expect(again.status).toBe(200);
  });

  it("rejects malformed tokens", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://store.example");
    vi.stubEnv("KV_REST_API_TOKEN", "secret");
    const response = await unsubscribePost(
      new Request("https://mop-radar.vercel.app/api/alerts/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ token: "../../etc" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
