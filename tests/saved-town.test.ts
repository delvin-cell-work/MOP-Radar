import { afterEach, describe, expect, it, vi } from "vitest";

import { parseSavedTown, readSavedTownSlug, saveTown, subscribeToSavedTown } from "../lib/saved-town";

type FakeStorage = Pick<Storage, "getItem" | "setItem">;

function memoryStorage(): FakeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function throwingStorage(): FakeStorage {
  const fail = () => {
    throw new Error("SecurityError: storage is disabled");
  };
  return { getItem: fail, setItem: fail };
}

function installWindow(storage: FakeStorage) {
  const events = new EventTarget();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSavedTown", () => {
  it("returns the slug of a known town", () => {
    expect(parseSavedTown(JSON.stringify({ slug: "tampines", source: "manual", savedAt: "2026-09-14T00:00:00Z" }))).toBe(
      "tampines",
    );
  });

  it.each([
    ["nothing saved", null],
    ["an empty string", ""],
    ["malformed JSON", "{tampines"],
    ["JSON null", "null"],
    ["a missing slug", JSON.stringify({ source: "manual" })],
    ["a town that no longer exists", JSON.stringify({ slug: "atlantis" })],
  ])("returns null for %s", (_label, raw) => {
    expect(parseSavedTown(raw)).toBeNull();
  });
});

describe("saveTown and readSavedTownSlug", () => {
  it("round-trips through localStorage with its source and time", () => {
    const storage = memoryStorage();
    installWindow(storage);
    expect(readSavedTownSlug()).toBeNull();

    saveTown("punggol", "geolocation");

    expect(readSavedTownSlug()).toBe("punggol");
    const stored = JSON.parse(storage.data.get("mop-radar:town") ?? "{}");
    expect(stored).toMatchObject({ slug: "punggol", source: "geolocation" });
    expect(Number.isNaN(Date.parse(stored.savedAt))).toBe(false);
  });

  it("notifies subscribers on save until they unsubscribe", () => {
    installWindow(memoryStorage());
    const onChange = vi.fn();
    const unsubscribe = subscribeToSavedTown(onChange);

    saveTown("bedok", "manual");
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    saveTown("bishan", "manual");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the town in memory when localStorage is unavailable", () => {
    installWindow(throwingStorage());
    expect(readSavedTownSlug()).toBeNull();

    saveTown("yishun", "manual");

    expect(readSavedTownSlug()).toBe("yishun");
  });
});
