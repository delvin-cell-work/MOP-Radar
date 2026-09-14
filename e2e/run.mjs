/**
 * Browser checks for MOP Radar, run against a dev server or a production build.
 *
 *   node e2e/run.mjs http://localhost:3000            # every scenario
 *   ONLY=filters,watchlist node e2e/run.mjs <url>     # some scenarios
 *
 * Uses the system Chrome through playwright-core (set CHROME_PATH elsewhere).
 * Geolocation is stubbed per scenario; OneMap tiles are replaced with a blank
 * image so runs are fast and don't load OneMap. Test data comes from the site's
 * own /data files, so the checks work against any data refresh.
 */
import { chromium } from "playwright-core";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const CHROME_PATH = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;

const PHONE = { width: 375, height: 667 };
const TALL = { width: 667, height: 930 };
const DESKTOP = { width: 1280, height: 800 };
const NARROW = { width: 320, height: 568 };

const PLACES = {
  toaPayoh: { lat: 1.336, lng: 103.8566, accuracy: 120 },
  tampines: { lat: 1.3541, lng: 103.9461, accuracy: 80 },
  london: { lat: 51.5072, lng: -0.1276, accuracy: 50 },
};

const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

class CheckFailed extends Error {}

function check(condition, message) {
  if (!condition) throw new CheckFailed(message);
}

async function fetchJson(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`GET ${path} → HTTP ${response.status}`);
  return response.json();
}

function geoStub(options) {
  window.__geoCalls = 0;
  if (options.secure === false) {
    Object.defineProperty(window, "isSecureContext", { get: () => false, configurable: true });
  }
  const geolocation =
    options.mode === "unsupported"
      ? undefined
      : {
          getCurrentPosition(success, error) {
            window.__geoCalls += 1;
            const coords = options.coords;
            if (options.mode === "never") return;
            setTimeout(() => {
              if (options.mode === "grant") {
                success({
                  coords: { latitude: coords.lat, longitude: coords.lng, accuracy: coords.accuracy },
                  timestamp: Date.now(),
                });
              } else {
                error({ code: options.mode === "denied" ? 1 : 3, message: options.mode });
              }
            }, options.delay ?? 250);
          },
          watchPosition: () => 0,
          clearWatch: () => {},
        };
  Object.defineProperty(Navigator.prototype, "geolocation", { get: () => geolocation, configurable: true });
}

let browser;

async function openPage({ viewport = PHONE, geo = { mode: "never" }, savedTown = null, storage = {} } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await context.route("https://www.onemap.gov.sg/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG }),
  );
  await context.addInitScript(geoStub, geo);
  const seeded = { ...storage };
  if (savedTown) {
    seeded["mop-radar:town"] = JSON.stringify({ slug: savedTown, source: "manual", savedAt: "2026-09-15T00:00:00Z" });
  }
  if (Object.keys(seeded).length > 0) {
    // Seed once per context; later reloads keep whatever the app wrote.
    await context.addInitScript((entries) => {
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, seeded);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return { context, page, errors };
}

const sheet = (page) => page.locator('section[aria-label="Results"]');
const sheetHeading = (page) => sheet(page).locator("h2").first();
const h1 = (page) => page.locator("h1");
const geoCalls = (page) => page.evaluate(() => window.__geoCalls);
const pinCount = (page) => page.locator(".leaflet-marker-pane .user-location__dot").count();
const locateButton = (page) => page.getByRole("button", { name: "Show my location" });
const watchlistButton = (page) => page.locator("header").getByRole("button", { name: /Watchlist/ });
const filtersButton = (page) => page.locator("header").getByRole("button", { name: /Filters/ });

async function gotoHome(page, path = "/") {
  await page.goto(`${BASE}${path}`);
  await sheetHeading(page).waitFor();
}

async function waitForHeading(page, pattern, timeout = 15000) {
  await page.waitForFunction(
    ({ source, flags }) => {
      const heading = document.querySelector('section[aria-label="Results"] h2');
      return heading && new RegExp(source, flags).test(heading.textContent ?? "");
    },
    { source: pattern.source, flags: pattern.flags },
    { timeout },
  );
}

async function waitForH1(page, text, timeout = 15000) {
  await page.waitForFunction((expected) => document.querySelector("h1")?.textContent === expected, text, { timeout });
}

async function headingCount(page) {
  const text = (await sheetHeading(page).textContent()) ?? "";
  if (/^No blocks/.test(text)) return 0;
  const match = /^([\d,]+) blocks?/.exec(text);
  check(match, `expected a count in the sheet heading, got "${text}"`);
  return Number(match[1].replace(/,/g, ""));
}

async function noHorizontalScroll(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${label}: page scrolls horizontally by ${overflow}px`);
}

/** Share of town bubbles whose centre is on the part of the map not covered by the sheet. */
async function bubblesInView(page) {
  return page.evaluate(() => {
    const map = document.querySelector('[role="region"][aria-label^="Map of HDB"]').getBoundingClientRect();
    const sheetRect = document.querySelector('section[aria-label="Results"]').getBoundingClientRect();
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    const bottom = desktop ? map.bottom : Math.min(map.bottom, sheetRect.top);
    const bubbles = Array.from(document.querySelectorAll(".town-marker__count"));
    const inside = bubbles.filter((bubble) => {
      const rect = bubble.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return x >= map.left && x <= map.right && y >= map.top && y <= bottom;
    });
    return { total: bubbles.length, inside: inside.length };
  });
}

/** A Toa Payoh block that has a sparkline: 5+ resales of one flat type. */
async function sparklineBlock() {
  const [town, tx] = await Promise.all([fetchJson("/data/towns/toa-payoh.json"), fetchJson("/data/tx/toa-payoh.json")]);
  const candidates = town.blocks
    .filter((block) => block.cohort === "just_mopped" && block.lat !== null)
    .sort((a, b) => a.months_since_mop - b.months_since_mop);
  for (const block of candidates) {
    const rows = tx.blocks[block.id] ?? [];
    const perType = {};
    rows.forEach((row) => (perType[row[1]] = (perType[row[1]] ?? 0) + 1));
    if (Math.max(0, ...Object.values(perType)) >= 5) return { block, rows };
  }
  throw new Error("No Toa Payoh block with 5+ resales of one flat type");
}

function titleFor(block) {
  const street = block.street
    .split(" ")
    .map((word) => (/^[A-Z]+$/.test(word) && word.length > 1 ? word[0] + word.slice(1).toLowerCase() : word))
    .join(" ");
  return `Blk ${block.blk_no} ${street}`;
}

const scenarios = {
  async "location-granted"() {
    const { page, errors } = await openPage({ geo: { mode: "grant", coords: PLACES.toaPayoh } });
    await gotoHome(page);
    await waitForH1(page, "Toa Payoh");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mop-radar:town")));
    check(saved.slug === "toa-payoh" && saved.source === "geolocation", "town saved as geolocation");
    await page.locator(".user-location__dot").first().waitFor({ timeout: 5000 });
    check((await pinCount(page)) === 1, "one location pin on the map");
    const stored = await page.evaluate(() => Object.keys(localStorage).join(","));
    check(!/lat|coord|position/i.test(stored), `no coordinates stored (keys: ${stored})`);
    return errors;
  },

  async "location-repeat-visit"() {
    const { page, errors } = await openPage({ geo: { mode: "grant", coords: PLACES.toaPayoh }, savedTown: "bedok" });
    await gotoHome(page);
    await waitForH1(page, "Bedok");
    await page.waitForTimeout(800);
    check((await geoCalls(page)) === 0, "geolocation not called on a repeat visit");
    check((await pinCount(page)) === 0, "no pin without a fix");
    return errors;
  },

  async "location-denied"() {
    const { page, errors } = await openPage({ geo: { mode: "denied" } });
    await gotoHome(page);
    await sheet(page).getByText("Location access is off. Pick a town below").waitFor();
    check((await h1(page).textContent()) === "Singapore", "stays on the national view");
    check((await pinCount(page)) === 0, "no pin when denied");
    const alerts = await page.evaluate(() => document.querySelectorAll('[role="alert"]').length);
    check(alerts === 0, "no error alert when denied");
    return errors;
  },

  async "location-timeout"() {
    const { page, errors } = await openPage({ geo: { mode: "timeout" } });
    await gotoHome(page);
    await sheet(page).getByText("Finding your location took too long").waitFor();
    check((await pinCount(page)) === 0, "no pin on timeout");
    return errors;
  },

  async "location-outside-singapore"() {
    const { page, errors } = await openPage({ geo: { mode: "grant", coords: PLACES.london } });
    await gotoHome(page);
    await sheet(page).getByText("You seem to be outside Singapore").waitFor();
    check((await pinCount(page)) === 0, "no pin outside Singapore");
    check((await h1(page).textContent()) === "Singapore", "stays on the national view");
    return errors;
  },

  async "location-insecure"() {
    const { page, errors } = await openPage({ geo: { mode: "grant", coords: PLACES.toaPayoh, secure: false } });
    await gotoHome(page);
    await sheet(page).getByText("Pick a town below to see its blocks.").waitFor();
    await page.waitForTimeout(600);
    check((await geoCalls(page)) === 0, "geolocation never called on non-HTTPS");
    check((await locateButton(page).count()) === 0, "no Locate me button on non-HTTPS");
    check((await pinCount(page)) === 0, "no pin on non-HTTPS");
    return errors;
  },

  async "location-unsupported"() {
    const { page, errors } = await openPage({ geo: { mode: "unsupported" } });
    await gotoHome(page);
    await sheet(page).getByText("Pick a town below to see its blocks.").waitFor();
    check((await locateButton(page).count()) === 0, "no Locate me button without geolocation");
    return errors;
  },

  async "location-never-answered"() {
    const { page, errors } = await openPage({ geo: { mode: "never" } });
    await gotoHome(page);
    await sheet(page).getByText("Finding your nearest town… or pick one below.").waitFor();
    return errors;
  },

  async "location-desktop"() {
    const { page, errors } = await openPage({ viewport: DESKTOP, geo: { mode: "grant", coords: PLACES.toaPayoh } });
    await gotoHome(page);
    await waitForH1(page, "Toa Payoh");
    const box = await sheet(page).boundingBox();
    check(box && Math.round(box.width) === 420 && box.x === 0, "results are a 420px side panel on desktop");
    return errors;
  },

  async "locate-me"() {
    const { page, errors } = await openPage({ geo: { mode: "grant", coords: PLACES.tampines }, savedTown: "bishan" });
    await gotoHome(page);
    await waitForH1(page, "Bishan");
    check((await geoCalls(page)) === 0, "no automatic request with a saved town");
    check((await pinCount(page)) === 0, "no pin before Locate me");
    await locateButton(page).click();
    await waitForH1(page, "Tampines");
    await page.locator(".user-location__dot").first().waitFor({ timeout: 5000 });
    check((await geoCalls(page)) === 1, "Locate me requests location once");
    const legend = await page.locator("details").filter({ hasText: "Map key" }).textContent();
    check(legend.includes("You, roughly"), "map key explains the location pin");
    return errors;
  },

  async "locate-me-denied"() {
    const { page, errors } = await openPage({ geo: { mode: "denied" }, savedTown: "bishan" });
    await gotoHome(page);
    await locateButton(page).click();
    await page.getByRole("status").getByText("Location access is off for this site").waitFor();
    check((await h1(page).textContent()) === "Bishan", "town unchanged when Locate me is denied");
    check((await pinCount(page)) === 0, "no pin when denied");
    await page.getByRole("status").getByRole("button", { name: "OK" }).click();
    return errors;
  },

  async "regression-flows"() {
    const { page, errors } = await openPage({ savedTown: "toa-payoh" });
    await gotoHome(page);
    await waitForHeading(page, /in Toa Payoh passed MOP in the last 24 months/);

    await page.locator("label").filter({ hasText: "Coming up" }).click();
    await waitForHeading(page, /in Toa Payoh reach MOP in the next 24 months/);
    await page.locator("label").filter({ hasText: "Just passed MOP" }).click();
    await waitForHeading(page, /passed MOP/);

    const handle = sheet(page).getByRole("button", { name: /results list/ });
    await handle.click();
    check((await handle.getAttribute("aria-label")) === "Collapse results list", "handle expands the sheet");
    await handle.click();
    check((await handle.getAttribute("aria-expanded")) === "false", "handle collapses the sheet to peek");
    await handle.click();

    await page.getByRole("button", { name: "Back to all towns" }).click();
    await waitForH1(page, "Singapore");
    await sheet(page).getByRole("button", { name: /^Tampines/ }).waitFor();
    await sheet(page).getByText("Pick a town to see its blocks.").waitFor();

    // Bubbles can overlap at the furthest zoom-out, so pick the town from the keyboard (Leaflet treats Enter as a click).
    const punggol = page.locator('.town-marker[title^="Punggol:"]');
    await punggol.waitFor({ state: "attached" });
    await punggol.focus();
    await page.keyboard.press("Enter");
    await waitForH1(page, "Punggol");
    await page.reload();
    await waitForH1(page, "Punggol");
    return errors;
  },

  async "national-framing"() {
    const allErrors = [];
    for (const viewport of [PHONE, TALL, DESKTOP]) {
      const { page, errors, context } = await openPage({ viewport, savedTown: "tampines" });
      await gotoHome(page);
      await waitForH1(page, "Tampines");
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: "Back to all towns" }).click();
      await waitForH1(page, "Singapore");
      await page.waitForTimeout(1200);
      const { total, inside } = await bubblesInView(page);
      check(total >= 10, `${viewport.width}×${viewport.height}: town bubbles shown (${total})`);
      check(inside === total, `${viewport.width}×${viewport.height}: ${inside}/${total} town bubbles visible above the sheet`);
      allErrors.push(...errors);
      await context.close();
    }
    return allErrors;
  },

  async "block-detail"() {
    const { block, rows } = await sparklineBlock();
    const title = titleFor(block);
    const { page, errors } = await openPage({ savedTown: "toa-payoh" });
    await gotoHome(page);
    await sheet(page).getByRole("button", { name: title, exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get("block") === block.id && url.searchParams.get("town") === "toa-payoh");
    await waitForHeading(page, new RegExp(`^${title}$`));
    check((await sheet(page).locator('input[type="radio"]').count()) === 0, "tabs hidden in detail");
    await sheet(page).getByRole("heading", { name: "Resale history" }).waitFor();
    await sheet(page).locator("tbody tr").first().waitFor();
    const shownRows = await sheet(page).locator("tbody tr").count();
    check(shownRows === Math.min(20, rows.length), `table shows ${Math.min(20, rows.length)} rows (got ${shownRows})`);
    check((await sheet(page).locator('svg[role="img"][aria-label*="resale prices"]').count()) === 1, "sparkline shown");
    const chips = await sheet(page).getByText(/^(Estimated|Resale on record)$/).count();
    check(chips >= 1, "status chip shown in detail");
    const agentLinks = await sheet(page).locator('a[href^="https://wa.me/"]').count();
    if (process.env.EXPECT_AGENT === "1") check(agentLinks === 1, "WhatsApp link shown");
    const detailText = (await sheet(page).textContent()) ?? "";
    check(!/fair value|undervalued|good deal|overvalued/i.test(detailText), "no valuation language");

    await page.getByRole("button", { name: "Back to results" }).click();
    await page.waitForURL((url) => !url.searchParams.has("block"));
    await waitForHeading(page, /in Toa Payoh/);
    const selected = sheet(page).locator("article.ring-2");
    check((await selected.count()) === 1, "last opened card is outlined");

    await sheet(page).getByRole("button", { name: title, exact: true }).click();
    await waitForHeading(page, new RegExp(`^${title}$`));
    await page.goBack();
    await waitForHeading(page, /in Toa Payoh/);
    check(!new URL(page.url()).searchParams.has("block"), "browser Back closes detail");
    return errors;
  },

  async "shared-link"() {
    const { block } = await sparklineBlock();
    const { page, errors } = await openPage({ geo: { mode: "grant", coords: PLACES.tampines } });
    await gotoHome(page, `/?town=toa-payoh&block=${block.id}`);
    await waitForHeading(page, new RegExp(`^${titleFor(block)}$`));
    await waitForH1(page, "Toa Payoh");
    check((await geoCalls(page)) === 0, "no location request when opening a shared block");
    await page.getByRole("button", { name: "Back to results" }).click();
    await waitForHeading(page, /in Toa Payoh passed MOP/);
    check(!new URL(page.url()).searchParams.has("block"), "URL cleared after closing");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mop-radar:town")));
    check(saved.slug === "toa-payoh", "closing a shared block shows its town");

    await page.goto(`${BASE}/?town=toa-payoh&block=0-no-such-block`);
    await waitForHeading(page, /^Block not found$/);
    return errors;
  },

  async watchlist() {
    const { page, errors } = await openPage({ savedTown: "toa-payoh" });
    await gotoHome(page);
    await waitForHeading(page, /in Toa Payoh/);
    const star = sheet(page).getByRole("button", { name: /^Add .+ to watchlist$/ }).first();
    const label = await star.getAttribute("aria-label");
    const title = label.replace(/^Add /, "").replace(/ to watchlist$/, "");
    await star.click();
    await sheet(page).getByRole("button", { name: `Remove ${title} from watchlist` }).waitFor();
    check(/1/.test((await watchlistButton(page).textContent()) ?? ""), "header shows 1 saved block");

    await watchlistButton(page).click();
    await waitForHeading(page, /^Watchlist$/);
    check((await watchlistButton(page).getAttribute("aria-pressed")) === "true", "watchlist button pressed");
    await sheet(page).getByRole("button", { name: title, exact: true }).waitFor();
    const legend = await page.locator("details").filter({ hasText: "Map key" }).textContent();
    check(legend.includes("On your watchlist"), "map key explains watchlist rings");

    await page.reload();
    check(/1/.test((await watchlistButton(page).textContent()) ?? ""), "watchlist survives a reload");
    await watchlistButton(page).click();
    await waitForHeading(page, /^Watchlist$/);
    await sheet(page).getByRole("button", { name: title, exact: true }).click();
    await waitForHeading(page, new RegExp(`^${title}$`));
    await page.getByRole("button", { name: "Back to watchlist" }).click();
    await waitForHeading(page, /^Watchlist$/);

    await sheet(page).getByRole("button", { name: `Remove ${title} from watchlist` }).click();
    await sheet(page).getByText("No blocks saved yet").waitFor();
    await page.getByRole("button", { name: "Back to results" }).click();
    await waitForHeading(page, /in Toa Payoh/);
    return errors;
  },

  async filters() {
    const { page, errors } = await openPage({ savedTown: "toa-payoh" });
    await gotoHome(page);
    await waitForHeading(page, /in Toa Payoh passed MOP/);
    const before = await headingCount(page);

    await filtersButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Filters" });
    await dialog.waitFor();
    check(
      (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Close filters",
      "focus moves into the dialog",
    );
    for (let index = 0; index < 30; index += 1) await page.keyboard.press("Tab");
    check(
      await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
      "Tab stays inside the dialog",
    );

    await dialog.getByLabel("Leave out blocks with rental flats").check();
    await page.waitForTimeout(200);
    const footer = (await dialog.getByRole("button", { name: /^Show / }).textContent()) ?? "";
    const match = /Show ([\d,]+) block/.exec(footer);
    check(match, `footer shows a count ("${footer}")`);
    const filtered = Number(match[1].replace(/,/g, ""));
    check(filtered <= before, `filtered count ${filtered} ≤ ${before}`);

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    check(
      await page.evaluate(() => document.activeElement?.closest("header") !== null),
      "focus returns to the header after closing",
    );
    check((await headingCount(page)) === filtered, "list count matches the dialog");
    await sheet(page).getByText("1 filter on").waitFor();

    await page.reload();
    await waitForHeading(page, /in Toa Payoh/);
    await sheet(page).getByText("1 filter on").waitFor();

    await filtersButton(page).click();
    await dialog.getByLabel(/MOP window/).fill("6");
    await dialog.getByRole("button", { name: /^Show / }).click();
    await waitForHeading(page, /passed MOP in the last 60 months/);
    check((await headingCount(page)) >= filtered, "a wider window shows at least as many blocks");

    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await waitForHeading(page, /passed MOP in the last 24 months/);
    check((await headingCount(page)) === before, "clearing filters restores the count");
    check((await sheet(page).getByText(/filters? on/).count()) === 0, "filter bar gone");

    // Filters also apply to the national town list.
    await page.getByRole("button", { name: "Back to all towns" }).click();
    await waitForH1(page, "Singapore");
    const national = await headingCount(page);
    await filtersButton(page).click();
    await dialog.getByLabel("5-Room", { exact: true }).check();
    await dialog.getByRole("button", { name: /^Show / }).click();
    await page.waitForTimeout(300);
    check((await headingCount(page)) <= national, "national count respects filters");
    return errors;
  },

  async "empty-state"() {
    const { page, errors } = await openPage({ savedTown: "bishan" });
    await gotoHome(page);
    await waitForHeading(page, /^No blocks in Bishan/);
    await sheet(page).getByText("Or try a neighbouring town").waitFor();
    const widen = sheet(page).getByRole("button", { name: /^Widen the MOP window to \d+ months/ });
    if ((await widen.count()) > 0) {
      const months = /to (\d+) months/.exec(await widen.textContent())[1];
      await widen.click();
      await waitForHeading(page, new RegExp(`in Bishan passed MOP in the last ${months} months`));
      check((await headingCount(page)) > 0, "widening the window finds blocks");
    }
    return errors;
  },

  async "cea-footer"() {
    const { page, errors } = await openPage({ savedTown: "toa-payoh" });
    for (const path of ["/", "/unsubscribe"]) {
      await page.goto(`${BASE}${path}`);
      const footer = page.locator("footer");
      await footer.waitFor();
      const text = (await footer.textContent()) ?? "";
      check(text.includes("MOP dates are derived from public HDB completion and resale data"), `${path}: disclosure shown`);
      if (process.env.EXPECT_AGENT === "1") {
        check(/CEA Reg\. No\. \S+/.test(text) && /Licence No\. \S+/.test(text), `${path}: CEA details shown`);
        const box = await footer.boundingBox();
        const viewport = page.viewportSize();
        check(box && box.y + box.height <= viewport.height + 1, `${path}: footer fully on screen`);
      }
    }
    return errors;
  },

  async "alert-signup"() {
    const { page, errors } = await openPage({
      savedTown: "toa-payoh",
      storage: {
        "mop-radar:watchlist:v1": JSON.stringify([{ id: "111a-alkaff-cres", town: "toa-payoh", addedAt: "x" }]),
      },
    });
    const posted = [];
    let reply = { status: 201, body: { ok: true } };
    await page.route("**/api/alerts", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
    });
    await gotoHome(page);
    await watchlistButton(page).click();
    await waitForHeading(page, /^Watchlist$/);
    const form = sheet(page).getByRole("region", { name: "Email me when blocks on my watchlist hit MOP" });
    await page.waitForTimeout(300);
    if ((await form.count()) === 0) {
      check(process.env.EXPECT_ALERTS !== "1", "alert signup shown when the store is configured");
      console.log("  (alert signup not enabled on this build; skipped)");
      return errors;
    }

    const consent = form.getByRole("checkbox");
    check(!(await consent.isChecked()), "consent box starts unticked");
    const submit = form.getByRole("button", { name: "Email me" });
    await submit.click();
    await form.getByText("Enter an email address").waitFor();
    check(
      await page.evaluate(() => document.activeElement?.getAttribute("type") === "email"),
      "focus moves to the email field",
    );
    await form.getByLabel("Email address", { exact: true }).fill("buyer@example.com");
    await submit.click();
    await form.getByText("Tick the box to agree").waitFor();
    check(posted.length === 0, "nothing sent without consent");

    await consent.check();
    reply = { status: 502, body: { error: "Couldn't save your signup. Try again in a moment." } };
    await submit.click();
    await form.getByRole("alert").getByText("Couldn't save your signup").waitFor();

    reply = { status: 201, body: { ok: true } };
    await submit.click();
    await form.getByText("You're signed up").waitFor();
    const body = posted[posted.length - 1];
    check(body.email === "buyer@example.com" && body.consent === true, "email and consent sent");
    check(body.watchlist.length === 1 && body.watchlist[0].id === "111a-alkaff-cres", "watchlist sent");
    check(body.town === "toa-payoh" && body.website === "", "town sent, hidden field empty");
    await noHorizontalScroll(page, "alert signup");
    // Chrome logs the deliberately mocked 502 above as a console error.
    return errors.filter((message) => !/status of 502/.test(message));
  },

  async "unsubscribe-page"() {
    const { page, errors } = await openPage({ viewport: NARROW });
    await page.route("**/api/alerts/unsubscribe", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
    );
    await page.goto(`${BASE}/unsubscribe`);
    await page.getByText("This link is missing its unsubscribe code").waitFor();
    await page.goto(`${BASE}/unsubscribe?token=${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Unsubscribe" }).click();
    await page.getByText("You're unsubscribed").waitFor();
    await noHorizontalScroll(page, "unsubscribe page");
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    check(/noindex/.test(robots ?? ""), "unsubscribe page is not indexed");
    return errors;
  },

  async "reflow-320"() {
    const { block } = await sparklineBlock();
    const { page, errors } = await openPage({ viewport: NARROW, savedTown: "toa-payoh" });
    await gotoHome(page);
    await waitForHeading(page, /in Toa Payoh/);
    await noHorizontalScroll(page, "town list");
    await filtersButton(page).click();
    await page.getByRole("dialog", { name: "Filters" }).waitFor();
    await noHorizontalScroll(page, "filters");
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/?town=toa-payoh&block=${block.id}`);
    await sheet(page).locator("tbody tr").first().waitFor();
    await noHorizontalScroll(page, "block detail");
    return errors;
  },
};

async function main() {
  browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const names = Object.keys(scenarios).filter((name) => !ONLY || ONLY.has(name));
  const failures = [];
  for (const name of names) {
    const started = Date.now();
    try {
      const errors = (await scenarios[name]()) ?? [];
      const relevant = errors.filter((message) => !/Download the React DevTools/.test(message));
      check(relevant.length === 0, `page errors: ${relevant.join(" | ")}`);
      console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (error) {
      failures.push(name);
      console.log(`FAIL ${name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    } finally {
      await Promise.all(browser.contexts().map((context) => context.close()));
    }
  }
  await browser.close();
  console.log(`\n${names.length - failures.length}/${names.length} scenarios passed against ${BASE}`);
  if (failures.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exit(1);
});
