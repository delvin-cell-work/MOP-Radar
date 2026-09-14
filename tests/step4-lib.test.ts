import { afterEach, describe, expect, it, vi } from "vitest";

import { agentContact, blockEnquiryMessage, normaliseWhatsappNumber, whatsappLink } from "../lib/agent";
import { blockTitle, formatArea, formatRemainingLease, formatStoreyRange, mopWindowPhrase } from "../lib/format";
import { createLocalStore } from "../lib/local-store";
import { decodeTransactions, sparklineSeries, type Transaction } from "../lib/transactions";
import { blockLinkSearch, parseBlockLink } from "../lib/url-state";
import { isWatched, parseWatchlist, toggleWatched } from "../lib/watchlist";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("watchlist", () => {
  it("parses saved entries, dropping invalid, unknown-town and repeated blocks", () => {
    expect(
      parseWatchlist([
        { id: "622b-tampines-ave-12", town: "tampines", addedAt: "2026-09-15T01:00:00Z" },
        { id: "622b-tampines-ave-12", town: "tampines", addedAt: "later" },
        { id: "Bad Id!", town: "tampines" },
        { id: "1-atlantis-rd", town: "atlantis" },
        "not an entry",
        { id: "110b-bidadari-pk-dr", town: "toa-payoh" },
      ]),
    ).toEqual([
      { id: "622b-tampines-ave-12", town: "tampines", addedAt: "2026-09-15T01:00:00Z" },
      { id: "110b-bidadari-pk-dr", town: "toa-payoh", addedAt: "" },
    ]);
    expect(parseWatchlist({ id: "x" })).toEqual([]);
  });

  it("adds new blocks to the top and removes watched ones", () => {
    const one = toggleWatched([], { id: "a-st", town: "bedok" }, "t1");
    const two = toggleWatched(one, { id: "b-st", town: "bishan" }, "t2");
    expect(two.map((entry) => entry.id)).toEqual(["b-st", "a-st"]);
    expect(isWatched(two, "a-st")).toBe(true);
    const removed = toggleWatched(two, { id: "a-st", town: "bedok" }, "t3");
    expect(removed.map((entry) => entry.id)).toEqual(["b-st"]);
    expect(isWatched(removed, "a-st")).toBe(false);
  });
});

describe("block links", () => {
  it("parses a valid town and block", () => {
    expect(parseBlockLink("?town=tampines&block=622b-tampines-ave-12")).toEqual({
      town: "tampines",
      block: "622b-tampines-ave-12",
    });
  });

  it.each([
    ["no block", "?town=tampines"],
    ["no town", "?block=622b-tampines-ave-12"],
    ["an unknown town", "?town=atlantis&block=1-sea-rd"],
    ["a malformed block id", "?town=tampines&block=%3Cscript%3E"],
    ["an empty query", ""],
  ])("returns null for %s", (_label, search) => {
    expect(parseBlockLink(search)).toBeNull();
  });

  it("builds the query string", () => {
    expect(blockLinkSearch({ town: "toa-payoh", block: "110b-bidadari-pk-dr" })).toBe(
      "?town=toa-payoh&block=110b-bidadari-pk-dr",
    );
  });
});

describe("agent contact", () => {
  it.each([
    ["+65 9123 4567", "6591234567"],
    ["65-9123-4567", "6591234567"],
    ["123", null],
    ["not a number", null],
  ])("normalises %j → %j", (value, expected) => {
    expect(normaliseWhatsappNumber(value)).toBe(expected);
  });

  it("needs both a name and a valid number", () => {
    expect(agentContact({ name: "  Delvin Goh ", whatsapp: "+65 9123 4567" })).toEqual({
      name: "Delvin Goh",
      whatsapp: "6591234567",
    });
    expect(agentContact({ name: "", whatsapp: "6591234567" })).toBeNull();
    expect(agentContact({ name: "Delvin Goh", whatsapp: "12" })).toBeNull();
    expect(agentContact({})).toBeNull();
  });

  it("builds a wa.me link with an encoded message naming only the block", () => {
    const message = blockEnquiryMessage("Delvin Goh", "Blk 622B Tampines Ave 12", "Tampines");
    expect(message).toBe(
      "Hi Delvin Goh, I found Blk 622B Tampines Ave 12 in Tampines on MOP Radar. Could you tell me more about this block?",
    );
    expect(message).not.toMatch(/\$|value|price/i);
    expect(whatsappLink("6591234567", "Hi & bye?")).toBe("https://wa.me/6591234567?text=Hi%20%26%20bye%3F");
  });
});

describe("transactions", () => {
  const sale = (month: string, flatType: Transaction["flatType"], resalePrice: number): Transaction => ({
    month,
    flatType,
    storeyRange: "04 TO 06",
    floorAreaSqm: 93,
    resalePrice,
    remainingLeaseMonths: 1100,
  });

  it("decodes compact rows", () => {
    expect(decodeTransactions([["2026-08", "4room", "10 TO 12", 93, 765000, 1133]])).toEqual([
      { month: "2026-08", flatType: "4room", storeyRange: "10 TO 12", floorAreaSqm: 93, resalePrice: 765000, remainingLeaseMonths: 1133 },
    ]);
  });

  it("charts the most-traded flat type, oldest first, once it has five resales", () => {
    const rows = [
      sale("2026-08", "4room", 800),
      sale("2026-01", "5room", 900),
      sale("2025-10", "4room", 780),
      sale("2025-06", "4room", 760),
      sale("2024-12", "5room", 880),
      sale("2024-03", "4room", 700),
      sale("2023-09", "4room", 690),
      sale("2023-01", "4room", 650),
    ];
    const series = sparklineSeries(rows);
    expect(series?.flatType).toBe("4room");
    expect(series?.points.map((point) => point.month)).toEqual([
      "2023-01",
      "2023-09",
      "2024-03",
      "2025-06",
      "2025-10",
      "2026-08",
    ]);
  });

  it("shows no chart when no single flat type has five resales", () => {
    const rows = ["2026-01", "2025-01", "2024-01", "2023-01"].flatMap((month) => [
      sale(month, "4room", 1),
      sale(month, "5room", 2),
    ]);
    expect(sparklineSeries(rows)).toBeNull();
  });

  it("breaks a tie in favour of the smaller flat type", () => {
    const months = ["2026-01", "2025-01", "2024-01", "2023-01", "2022-01"];
    const rows = months.flatMap((month) => [sale(month, "5room", 2), sale(month, "4room", 1)]);
    expect(sparklineSeries(rows)?.flatType).toBe("4room");
  });
});

describe("detail formatting", () => {
  it.each([
    [1133, "94 yrs 5 mths"],
    [840, "70 yrs"],
    [13, "1 yr 1 mth"],
    [12, "1 yr"],
  ])("remaining lease %i months → %s", (months, label) => {
    expect(formatRemainingLease(months)).toBe(label);
  });

  it("formats storeys, areas, titles and window phrases", () => {
    expect(formatStoreyRange("01 TO 03")).toBe("1–3");
    expect(formatStoreyRange("10 TO 12")).toBe("10–12");
    expect(formatArea(93)).toBe("93 m²");
    expect(formatArea(67.5)).toBe("67.5 m²");
    expect(blockTitle({ blk_no: "622B", street: "TAMPINES AVE 12" })).toBe("Blk 622B Tampines Ave 12");
    expect(mopWindowPhrase("just_mopped", 36)).toBe("passed MOP in the last 36 months");
    expect(mopWindowPhrase("upcoming", 12)).toBe("reach MOP in the next 12 months");
    expect(mopWindowPhrase("all", 24)).toBeNull();
  });
});

describe("createLocalStore", () => {
  function installWindow(storage: Pick<Storage, "getItem" | "setItem">) {
    const events = new EventTarget();
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    });
  }

  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
  }

  const parse = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

  it("returns the same reference until the stored value changes, and notifies subscribers", () => {
    const storage = memoryStorage();
    installWindow(storage);
    const store = createLocalStore("test:list", parse, [] as string[]);
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(onChange);

    const first = store.read();
    expect(store.read()).toBe(first);
    store.write(["a"]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const second = store.read();
    expect(second).toEqual(["a"]);
    expect(second).not.toBe(first);
    expect(store.read()).toBe(second);
    unsubscribe();
  });

  it("falls back on malformed stored JSON", () => {
    const storage = memoryStorage();
    storage.data.set("test:broken", "{not json");
    installWindow(storage);
    expect(createLocalStore("test:broken", parse, ["fallback"]).read()).toEqual(["fallback"]);
  });

  it("keeps values in memory when storage is unavailable", () => {
    const fail = () => {
      throw new Error("blocked");
    };
    installWindow({ getItem: fail, setItem: fail });
    const store = createLocalStore("test:blocked", parse, [] as string[]);
    store.write(["kept"]);
    expect(store.read()).toEqual(["kept"]);
  });
});
