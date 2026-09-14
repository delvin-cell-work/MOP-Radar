@AGENTS.md

# MOP Radar

Mobile-first web app showing Singapore HDB buyers which blocks recently passed, or are about
to pass, their 5-year Minimum Occupation Period (MOP). **The primary view is a map of
Singapore,** so buyers can see which areas have upcoming and just-MOP'd blocks. A white-label
lead-generation tool for a CEA-licensed real estate agent: agent details come from env vars so
the codebase can be rebranded.

## Status

Build order (from the product brief). Stop and show the user after each step, unless they say
otherwise.

1. **Done:** data pipeline, MOP derivation, block map locations, tests, weekly refresh workflow.
2. **Done and approved:** map-first results screen.
3. **Done:** geolocation and fallbacks, plus the user's refinements (back button, no town
   dropdown, tabs in the sheet, zoom and pan limits).
4. **Done (2026-09-15):** filters, block detail, watchlist, current-location pin with "Locate me".
   Built overnight at the user's request ("proceed with step 5 after and push to live"), so the
   user has not reviewed it yet.
5. **Built (2026-09-15), pending the user's env setup:** CEA footer, email alert signup,
   unsubscribe. See "Email alerts and CEA footer (step 5)" and Open items.

### Session log

- **2026-09-15 overnight:** the user went to bed and asked for step 4, then step 5, both pushed to
  production. Step 4 was verified (unit tests, lint, typecheck, `npm run e2e` against `next dev`
  and a production build, iOS 15 check) before pushing. Show the user what changed when they
  are back.
- Browser checks now live in `e2e/run.mjs` (committed). The Step 3 scratchpad scripts are gone;
  everything they covered is in there.

**Deployment (all live):**
- **GitHub:** https://github.com/delvin-cell-work/MOP-Radar (public, `main`).
  - Commits are authored as `delvin-cell-work` with the GitHub no-reply email (repo-local git
    config), co-authored by Claude.
  - Pushes authenticate through `gh auth git-credential`, so the GitHub CLI's active account
    must be `delvin-cell-work` (`gh api user --jq .login`). `empatechpower` is also signed in
    but only has read access.
  - Only commit or push when the user asks.
- **Vercel:** production at **https://mop-radar.vercel.app** (public).
  - Every push to `main` deploys to production.
  - Per-deployment, branch and team URLs are behind Vercel's Deployment Protection login, so run
    Lighthouse and browser checks against the production domain.
  - Build command `npm run build` (runs the data pipeline first), Node.js 24.x;
    `engines.node` is pinned to `24.x`.
  - Vercel's Next.js adapter moves client chunks to `.next/static/immutable/chunks`, which
    `check:browsers` handles.
- **Live Lighthouse mobile** after step 3 (two runs): performance 95, accessibility 100, best
  practices 92, SEO 100. Best practices is 92 only because of `geolocation-on-start`, which the
  brief requires.
- **Weekly data refresh is live:** `.github/workflows/refresh-data.yml` runs on Mondays at
  02:00 SGT, and on demand from the repo's Actions tab.
  - It runs the tests and the pipeline, then POSTs the Vercel deploy hook (repo secret
    `VERCEL_DEPLOY_HOOK_URL`; hook `weekly-data-refresh` on `main`).
  - The Vercel build runs the pipeline again and publishes the fresh data.
  - A failed run means the data wasn't refreshed. The site keeps serving the last good build.
  - The hook step retries (curl `--retry 4`, 30 s apart). The first manual run (2026-09-14) got
    HTTP 500 from Vercel while a push-triggered build of the same commit was still running.

**Decisions:**
- **Decision 1 (performance): resolved.** No static-map image is needed (live performance 95).
- **Decision 2 (CEA placement): resolved 2026-09-15, "always visible".** One compact line with
  the four CEA details in the bottom bar, under the disclosure, on every route.
- **Step 4 choices (2026-09-15):**
  - Location pin: shown whenever a fix arrives (automatically on a first visit; on later visits
    via a "Locate me" button, which also re-centres on the nearest town). Coordinates are never
    stored.
  - Block detail opens inside the results panel, the map focuses the block, and the URL
    (`?town=…&block=…`) can be shared. A header "Watchlist" button shows starred blocks in the
    panel, ringed on the map.

**Open items and offers the user hasn't answered:**
- The agent needs to register for OneMap before launch.
- Vercel Hobby is non-commercial only, so this lead-generation tool needs Vercel **Pro** before
  launch.
- README.md is still create-next-app boilerplate in the public repo. Replacing it with a short
  MOP Radar README was offered.
- On desktop, the "Just passed MOP" tab label wraps to two lines in the 420 px side panel.
  Shortening the label or widening the panel was offered.
- Map dot taps aren't covered by `e2e/run.mjs` (dots are canvas-drawn); check them by hand.
- **Before step 5 can deploy, the user must add the five `NEXT_PUBLIC_` agent variables in Vercel**
  (real CEA details; never invent them). Without them the Vercel build fails by design and
  production keeps serving the previous deploy. The weekly refresh's deploy would fail too.
- For email alerts, add Upstash for Redis from the Vercel Marketplace (sets `KV_REST_API_URL`
  and `KV_REST_API_TOKEN`), then redeploy. No alert emails are sent yet.

**Local dev:**
- `npm run data` (~1–3 min; it must finish before starting anything else in that terminal),
  then `npm run dev` → http://localhost:3000.
- Only one `next dev` can run per project. The user often has theirs running on :3000, so
  verify dev mode against it rather than starting another.
- To see the first-visit flow again, clear the `mop-radar:town` localStorage key.

## Email alerts and CEA footer (step 5)

- **CEA footer** (`components/SiteFooter.tsx`, root layout, every route): the verbatim disclosure,
  then one always-visible line "Name · CEA Reg. No. … · Agency · Licence No. …".
- **Build fails without agent details.** `REQUIRED_AGENT_ENV` in `lib/agent.ts`:
  `NEXT_PUBLIC_AGENT_NAME`, `NEXT_PUBLIC_CEA_REG_NO`, `NEXT_PUBLIC_AGENCY_NAME`,
  `NEXT_PUBLIC_AGENCY_LICENCE_NO`, `NEXT_PUBLIC_AGENT_WHATSAPP` (digits with country code).
  - `npm run check:env` (`scripts/check-env.ts`, loads `.env*` via `@next/env`) runs first in
    `prebuild`, before the slow data pipeline.
  - `next.config.ts` repeats the check in the production-build phase, for `npx next build`. It
    skips `next typegen`, so `npm run typecheck` works without the variables.
  - `next dev` still runs without them and shows a red "details missing" footer line.
  - They are `NEXT_PUBLIC_`, so changing them needs a redeploy.
- **Email alert signup** (`components/AlertSignup.tsx`) under the watchlist, only when the
  watchlist has blocks and the store is configured:
  - Required email plus a required, unticked PDPA consent box naming the agent and agency
    (`consentStatement`), and a purpose statement (`PURPOSE_STATEMENT`). Optional, never a wall.
  - Hidden honeypot field; filled-in requests get a fake success and store nothing.
  - POSTs `{email, consent, watchlist, town, website}` to `app/api/alerts/route.ts`: same-origin
    check, 20 KB body limit, Zod (`lib/alert-schema.ts`), then `saveSignup`.
- **Store** (`lib/alert-store.ts`): Redis over Upstash's REST API with plain fetch.
  - Env: `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel Marketplace "Upstash for Redis"), or
    `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
  - `app/page.tsx` reads the config at build time, so the form appears only after a redeploy.
    Without a store the API returns 503.
  - Keys: `mop-radar:alerts:signup:<sha256(email)>` → JSON record `{email, watchlist, town,
    consented_at, consent_statement, consent_version, created_at, updated_at,
    unsubscribe_token, unsubscribe_url, one_click_unsubscribe_url}`;
    `mop-radar:alerts:token:<token>` → hash; set `mop-radar:alerts:signups`.
  - Signing up again with the same email updates the watchlist and consent time and keeps the
    token. Email addresses are never logged.
- **Unsubscribe:** `/unsubscribe?token=…` (static page, not indexed) has a button that POSTs to
  `app/api/alerts/unsubscribe/route.ts`, which deletes the record, token and set entry. That
  route also accepts `?token=` for RFC 8058 one-click unsubscribe. POST only, so link scanners
  can't unsubscribe people.
- **Sending emails is not built.** Whatever sends alerts must put the record's `unsubscribe_url`
  in every email, and should send `List-Unsubscribe: <one_click_unsubscribe_url>` with
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Consent text changes: bump `CONSENT_VERSION` in `lib/alerts.ts`.
- Optional `NEXT_PUBLIC_SITE_URL` fixes the domain used in unsubscribe links; otherwise the
  request's host is used.

## Filters, block detail, watchlist (step 4)

- **Filters** (`lib/filters.ts`, `components/FilterSheet.tsx`), saved in `mop-radar:filters:v1`:
  - flat types (any of), leave out one flat type, leave out blocks with rental flats, MOP window
    (6, 12, 18, 24, 36, 48, 60 months; default 24), block age, 12-month resale activity.
  - They apply to the list, map dots, town counts, bubbles, headings and the national list.
  - The MOP window replaces cohort matching for the tabs: Just passed MOP is `0 ≤ m < window`,
    Coming up is `−window ≤ m < 0`, All ignores it. At 24 months this equals the cohorts. Wider
    windows also load `map/mature.json` or `map/later.json` (`cohortsForView`).
  - With default filters, town counts come from `meta.json`; otherwise from the map points
    (so the 8 unlocated blocks aren't counted when filters are on).
  - The sheet is a modal (`role="dialog"`, focus trap, Escape, focus returns to the opener), not
    `<dialog>` (Safari 15.4+). A "N filters on · Clear filters" bar sits above the list.
  - The empty state offers the first wider MOP window with results, clearing filters, the other
    tabs and neighbouring towns.
- **Block detail** (`components/BlockDetail.tsx`) opens in the results panel:
  - URL state `?town=<slug>&block=<id>` via `lib/url-state.ts` (a `useSyncExternalStore` over
    `location.search` plus native `history.pushState`, which Next's router tolerates). Not
    `useSearchParams`, which would client-render the page up to a Suspense boundary.
  - Opening from the app pushes a history entry, so Back (button or browser) closes detail;
    switching block to block replaces it. A shared link has no in-app entry, so closing it
    shows that block's town.
  - A shared link skips the automatic location request.
  - Content: status chip, card facts, completion/storeys/flats/resale count, the WhatsApp link
    (`lib/agent.ts`; hidden unless `NEXT_PUBLIC_AGENT_NAME` and `NEXT_PUBLIC_AGENT_WHATSAPP`
    are set; the message names the block only), a sparkline for the flat type with the most
    resales when it has 5+ (`sparklineSeries`), and the resale table (20 rows, then "Show all").
  - `public/data/tx/<town>.json` loads only when detail opens.
- **Watchlist** (`lib/watchlist.ts`, `components/WatchlistPanel.tsx`), saved in
  `mop-radar:watchlist:v1` as `{id, town, addedAt}` so each block's town file can be loaded.
  Stars on cards and the detail header. The header button toggles the panel; the map fits and
  rings (amber) the saved blocks, which get a dot even when the tab or filters hide them.
- **Stores:** `lib/local-store.ts` is a JSON localStorage store for `useSyncExternalStore`
  (snapshot cached by raw string, memory fallback when storage is blocked).
- **Location pin:** blue dot plus an accuracy circle (SVG pane under the dots), labelled "Your
  approximate location", with a map key entry. Session state only. "Locate me" (below the zoom
  buttons, hidden when location is unsupported or the page isn't HTTPS) requests location,
  saves the nearest town and frames the town plus the visitor. Failures show a short note beside
  the button (`LOCATE_ME_MESSAGES`), never a toast.

## Commands

```bash
npm run data            # fetch data.gov.sg → derive → locate → write public/data/ → print summary (~1 min)
npm test                # vitest: MOP derivation, street-code matching, geo, schemas, CSV, formatting, views
npm run typecheck       # next typegen && tsc --noEmit
npm run lint
npm run build           # prebuild: npm run data · postbuild: npm run check:browsers
npm run check:browsers  # fails if client chunks use syntax or APIs Safari on iOS 15.0 can't run
npm run check:env       # fails if the agent's CEA env vars are missing (runs in prebuild)
npm run e2e -- <url>    # browser scenarios (system Chrome via playwright-core); ONLY=name,name to filter
```

- `public/data/` is generated and gitignored. Run `npm run data` before `npm run dev`.
- To iterate on UI without re-fetching data, use `npx next build && npm run check:browsers`.

## Layout

- `app/`: `layout.tsx` (fixed app shell + `SiteFooter` on every route), `page.tsx` (preloads the
  first screen's data, preconnects OneMap), `globals.css` (Tailwind v3 + Leaflet overrides).
- `components/`:
  - `ResultsScreen.tsx`: state owner for the home screen.
  - `MopMap.tsx`: imperative Leaflet, loaded with `next/dynamic`, `ssr: false`.
  - `ResultsSheet.tsx`: bottom sheet on mobile, side panel from `lg`.
  - `TownOverview.tsx`: national view list of towns ranked by count, which doubles as the town
    picker.
  - `BlockCard` (uses `BlockSummary`), `BlockDetail`, `TransactionTable`, `PriceSparkline`,
    `FilterSheet`, `WatchlistPanel`, `WatchStar`, `MopStatusChip`, `ViewTabs`, `EmptyState`,
    `MapLegend`, `SiteFooter`.
- `lib/`: shared by pipeline and app. Pure, no Node or browser APIs at import time.
  - `mop.ts`: MOP derivation (the core logic).
  - `months.ts`: integer month arithmetic.
  - `geo.ts`: haversine, Singapore bounds, median point.
  - `towns.ts`: town codes, names, slugs and shipped centres. `flat-types.ts`: flat types.
  - `data-contract.ts`: JSON types.
  - `data-client.ts`: cached fetch of `public/data`, map point decoding.
  - `views.ts`: tabs, sorting, neighbouring towns.
  - `location.ts`: geolocation options, nearest town, failure reasons and explainers.
  - `saved-town.ts`: the persisted town (localStorage with in-memory fallback), shaped for
    `useSyncExternalStore`.
  - `format.ts`: all display strings for MOP, prices, streets and months.
  - `cohort-style.ts`: status colours.
  - `compliance.ts`: verbatim disclosure.
  - `filters.ts`, `watchlist.ts`, `local-store.ts`, `stores.ts`: filters and watchlist state.
  - `url-state.ts`: the shareable block link. `transactions.ts`: resale rows and sparkline series.
  - `agent.ts`: agent contact from env vars and the WhatsApp link.
- `scripts/build-data.ts`: pipeline entry. `scripts/pipeline/`: data.gov.sg client, Zod
  schemas, CSV parser, `geo-match.ts`. `scripts/check-browser-support.mjs`: post-build iOS 15
  guard. Never import `scripts/` from `app/` or `components/`.
- `tests/`: vitest (pure logic only; UI is verified in a real browser).
- `e2e/run.mjs`: browser scenarios for location, regressions, framing, reflow, step 4 flows, the
  CEA footer, alert signup and unsubscribe. Set `EXPECT_AGENT=1` / `EXPECT_ALERTS=1` when the
  build has agent details / an alert store, so those checks are enforced rather than skipped.
- `app/api/alerts/`: signup and unsubscribe route handlers. `app/unsubscribe/`: unsubscribe page.
- `.github/workflows/refresh-data.yml`: weekly cron → tests → pipeline → Vercel deploy hook
  (secret `VERCEL_DEPLOY_HOOK_URL`).

## Hard product rules

- **No login of any kind.** All user state (watchlist, filters, town, dismissed banners) lives
  in localStorage. The only server write is the optional email-alert signup.
- **The browser never calls data.gov.sg.** It reads `public/data/*.json` only.
- **Mobile first.** Design at 375px portrait; desktop is secondary. Useful results in under 3s
  with zero interaction, and no layout shift when geolocation resolves.
- **Browser support:** Safari iOS 15+, Chrome, Firefox, Edge, Samsung Internet. No `:has()`,
  container queries, View Transitions, `dvh`/`svh`, or Tailwind v4 without progressive
  enhancement. Nothing may break with animations off.
- **Lighthouse mobile** performance and accessibility > 90: keyboard navigable, visible focus,
  labelled controls, readable at 200% zoom (no horizontal scroll at 320px).
- **Geolocation:** call immediately with `{enableHighAccuracy:false, timeout:5000,
  maximumAge:600000}` without gating the UI. Nearest town by haversine over the town centres;
  no geocoding API. Denied, timeout, unsupported, non-HTTPS, or outside 1.15–1.48N /
  103.6–104.1E → town picker, never an error toast or endless spinner. Persist the town. The
  brief wants the national view rendered instantly, then a snap to the nearest town.

## Geolocation (`lib/location.ts`, `lib/saved-town.ts`, `ResultsScreen.tsx`)

- **First visit:**
  - Render the national view: map on the whole island; the sheet lists all 27 towns ranked by
    the tab's count (`TownOverview`, which is also the picker), headed "N blocks across
    Singapore…".
  - On mount, call `getCurrentPosition` once with `GEOLOCATION_OPTIONS`.
  - On success, `nearestTown` uses the centres in `lib/towns.ts` (no network), saves the town
    as `geolocation`, and the map animates to it.
- **Repeat visit:** the saved town (`mop-radar:town` in localStorage) opens directly, and
  geolocation is not called until the visitor taps "Locate me".
- **Manual choice always wins.** Every town pick is saved as `manual`: the town list, bubbles,
  neighbouring-town links, or a dot tap in another town. A location fix arriving after a pick is
  ignored.
- **Changing town (2026-09-14, user request):**
  - The header town dropdown was removed.
  - In a town, a back chevron at the left of the sheet header ("Back to all towns") returns to
    the national town list and zooms the map out to the island.
  - Going back is session-only (`browsingAllTowns`): the saved town stays, so a reload or repeat
    visit reopens it. The header then reads "Pick a town to see its blocks."
  - The sheet header's contents are keyed by town, so the back button appearing after a
    location fix replaces nodes instead of shifting them (layout shift stays 0).
  - After going back or picking a town, focus moves to the top of the list.
- **Fallbacks:** stay on the national view with a one-line explainer
  (`LOCATION_FAILURE_MESSAGES`) above the picker. No toast, no alert.
  - Non-HTTPS pages and missing geolocation are detected up front, and geolocation is never
    called.
  - Denied, unavailable and timeout come from the error code.
  - Coordinates outside the bounding box are `outside_singapore`.
  - A prompt that's never answered leaves "Finding your nearest town… or pick one below."
- **Lint forbids setState in effects and render** (`react-hooks/set-state-in-effect` and
  `set-state-in-render` are errors):
  - The saved town and browser support are read with `useSyncExternalStore`.
  - Geolocation results arrive in callbacks.
  - Map framing is derived: a `FrameIntent` follows the current town until the user acts on
    the map or list.
  - `MapFrame` (`island`, `points` or `block`) carries a `key`. `MopMap` applies each key at
    most once, ever, so closing block detail leaves the map where it is; actions that should
    reframe bump a generation in the key.
- **Town centres are shipped in `lib/towns.ts`.** The pipeline fails if a computed centre drifts
  more than 1 km, and prints the new value to paste in.
- **Testing location in a browser:** stub `Navigator.prototype.geolocation` (and
  `window.isSecureContext`) with Playwright `addInitScript`. Count alerts with
  `document.querySelectorAll`, because Playwright selectors pierce shadow DOM and match Next's
  hidden `__next-route-announcer__` (`role="alert"`).

## Browser support: how it's enforced

- `browserslist` in package.json: iOS/Safari ≥ 15, Chrome/Edge/Firefox ≥ 90, Samsung ≥ 15. It
  drives SWC for our code and Autoprefixer for CSS.
- **Tailwind v3.4, not v4.** v4's output needs Safari 16.4+ (Next's docs recommend v3 for
  broader support). The Tailwind v3 build emits no native `@layer`, `@property`, `oklch` or
  `color-mix`.
- **Literal "ES2019 output" is not achievable.** Next.js 16's prebuilt runtime ships ES2020–2022
  syntax (`??`, `??=`, class fields, one private field) regardless of browserslist. iOS 15.0
  parses all of it. What breaks iOS 15 is class static blocks and regex lookbehind (Safari
  16.4); `check:browsers` fails the build on those, and on unpolyfilled newer APIs.
- `check:browsers` scans every `.js` file under `.next/static`.
  - Locally, Turbopack puts client chunks in `static/chunks`.
  - On Vercel, the Next.js adapter enables `supportsImmutableAssets`, which moves them to
    `static/immutable/chunks`.
  - The first Vercel deploy (2026-09-14) failed on a hard-coded `static/chunks` path.
- Next's built-in polyfill module already covers `Array.prototype.at`, `flat`/`flatMap`,
  `Object.fromEntries`, `Object.hasOwn`, `trimStart`/`trimEnd` and `URL.canParse`, so don't add
  duplicates.
- iOS details:
  - Form controls use font-size ≥ 16px, or Safari zooms on focus.
  - `:focus-visible` is unsupported before iOS 15.4, so those versions fall back to default
    outlines.
  - `addListener` is the fallback for `MediaQueryList`.

## Map (primary view)

- **Library:** plain Leaflet 1.9.4, driven imperatively in `MopMap.tsx`. We don't use
  react-leaflet: canvas-rendered markers across 10k+ blocks and focus requests are simpler
  without it. Leaflet touches `window` at import, so the component is `next/dynamic` with
  `ssr: false`; `ResultsScreen` also starts `import("./MopMap")` at module load.
- **Leaflet 1.9.4 canvas bug (patched in `MopMap.tsx`, keep the patch):**
  - Symptom: "Cannot read properties of undefined (reading 'save')".
  - Cause: an immediate redraw nulls `_redrawRequest` without cancelling an already-scheduled
    animation frame, so `map.remove()` can't cancel it. The frame then runs against the deleted
    canvas context.
  - Trigger: React Strict Mode's mount → unmount → mount in `next dev`. Production builds
    didn't show it.
  - Fix: wrap the renderer's `_redraw` to skip when `_ctx` is gone.
  - Any new Leaflet effect must also clean up fully and be safe to run twice in dev.
- **Test UI in both modes:** `next dev` (Strict Mode double-mounts effects) and a production
  build (`next build && next start`). Each mode has caught bugs the other didn't.
- **Basemap:** OneMap Grey tiles, zoom 10–19 (zoom 20 returns empty tiles). Zoom 10 fits the
  whole island on a phone. No key is needed, and CORS is `*`.
- **OneMap attribution is mandatory:** logo (`web-assets/images/logo/om_logo.png`) plus links to
  OneMap and SLA. OneMap's terms grant a royalty-free, revocable licence "for any usage", and say
  web apps "will need to complete the online registration process". **The agent should register
  before launch.**
- **Dots:** canvas `circleMarker`s coloured by cohort (`lib/cohort-style.ts`).
  - Solid = resale on record, hollow = estimated, dashed = street-level location.
  - Draw order puts `just_mopped` on top.
  - Colours encode MOP status only, never price.
- **Town count bubbles** (divIcon markers, keyboard focusable) show at zoom ≤ 13 for towns with
  results in the current tab. Tapping one switches the list to that town.
- **Focus:**
  - National view: `fitBounds` on `SINGAPORE_ISLAND_BOUNDS` (max zoom 12, top padding 16 px),
    applied at map creation before tiles load.
  - A town: frames that town's points for the tab (`fitBounds`, max zoom 16, padded clear of
    the map key and the sheet), once map points have loaded.
  - Zoom and pan limits (`updateViewLimits`, recalculated on map resize):
    - The furthest zoom-out is the zoom that fits the whole island across the map: 10 on
      phones, 11 on wider screens. That stops wide screens zooming out into the blank area
      beyond OneMap's tiles.
    - The pan limit is Singapore plus one map-size of slack on each side. A fixed limit smaller
      than a tall screen made Leaflet re-centre on it, hiding the island behind the sheet
      (reported by the user at 667×930).
    - The regression script checks national framing after "Back to all towns" at 375×667,
      667×930 and 1280×800.
  - Card or dot tap: opens block detail and centres the block (zoom 16, or closer if already
    closer). A dot tap in another town also switches the list town.
  - Town bubbles take Enter or Space: Leaflet makes them focusable but doesn't activate them
    from the keyboard, so `MopMap` adds a keydown handler each time a bubble is added.
- **Sheet overlap:**
  - The map is told the sheet's covered fraction (`bottomInsetFraction`) and offsets targets
    above it.
  - The map wrapper is `z-0`, so Leaflet's `z-index: 1000` controls can't paint over the sheet.
  - `--map-inset` lifts `.leaflet-bottom` (the attribution) above the sheet so it stays visible.
- **Data loading:**
  - "Just passed MOP" loads `map/just_mopped.json` (~18 KB).
  - "Coming up" loads `map/upcoming.json` (~25 KB).
  - "All" loads all four cohort files (mature ~830 KB raw).
- **Accessibility:**
  - The list is before the map in the DOM, so keyboard order is header → sheet → map, with a
    skip link to the list.
  - The map is a labelled region; every map action has a list equivalent.

## Results UI conventions

- **Tabs:** native radio group (`ViewTabs`), in the results sheet between the drag handle and
  the summary header (moved out of the page header at the user's request, 2026-09-14). Order:
  Just passed MOP (default) · Coming up · All. The page header holds only the app name and the
  town `h1`.
- **Cards:**
  - Content: block + street (title-cased, HDB abbreviations kept), town, completion year, MOP
    headline + detail, flat type mix, sold/rental units, 12-month resale count, and median
    resale price per flat type with count and a dated window.
  - The whole card is tappable through a stretched button with `aria-pressed`.
- **Status chip:** **"Resale on record"** for confirmed, never "Confirmed" (it must not read as
  HDB confirmation); **"Estimated"** for estimates.
- **MOP wording** (`describeMop`):
  - Estimates name only a half-year ("MOP expected mid-2027").
  - A first resale in Jan–Mar 2017 reads "resales on record since 2017", never as a MOP date.
- **Lists:** 50 cards render at a time ("Show N more"); a selected block always renders.
- **Empty state:** offers the other tabs with counts, then the 3 nearest towns with results.
  The sheet header already states "No blocks…".

## Performance

**Resolved (2026-09-14):** no static-map image. Live Lighthouse mobile on
https://mop-radar.vercel.app scored performance 95 in two runs (FCP 0.8 s, LCP 2.9 s simulated,
layout shift 0.001; the LCP element is a zoom-10 OneMap tile). Revisit only if a later change
drops performance under 90.

After step 3 (national view first), local Lighthouse mobile scored performance 90–91, with a
simulated LCP of 3.5 s (392–423 ms observed) and layout shift 0.001.


- Measured locally: first contentful paint 40 ms, LCP 259 ms, layout shift 0, main-thread
  work 0.4 s.
- Lighthouse's simulated mobile LCP is 3.9–4.1 s, giving performance 87–88. The LCP element is a
  OneMap tile. Lighthouse models slow 4G and 4× CPU across the dependency chain: HTML →
  framework JS → dynamic Leaflet chunk → tile.
- Already done: data preloads, OneMap preconnect, eager map chunk import, SVG icon instead of a
  26 KB favicon.
- Option investigated, not built:
  - What: server-render a OneMap static-map image as the instant national view, which the
    simulation would count as an early LCP.
  - API: `https://www.onemap.gov.sg/api/staticmap/getStaticImage?layerchosen=grey&latitude=…&longitude=…&zoom=…&width=…&height=…`.
    Works without a token, max 512×512, zoom ≥ 11, and its imagery aligns pixel-for-pixel with
    the tiles.
  - Cost: ~188 KB PNG per visit, and its terms page couldn't be read.
- Do not "fix" the score with tricks that hide the map from LCP (opacity games, list-first
  layouts). The user asked for a map-first view.

## Compliance (non-negotiable: the agent's licence depends on it)

- Every estimated result shows a visible **"Estimated"** chip in the list, on map popups and on
  block detail.
- Persistent footer line, verbatim, from `lib/compliance.ts` (a test locks the text): "MOP
  dates are derived from public HDB completion and resale data, not official HDB records.
  Estimates can be off by several months. Confirm with HDB before making any decision."
- CEA: a shared layout footer on **every** route shows the salesperson's registered name, CEA
  registration number, agency name and agency licence number, from `NEXT_PUBLIC_AGENT_NAME`,
  `NEXT_PUBLIC_CEA_REG_NO`, `NEXT_PUBLIC_AGENCY_NAME`, `NEXT_PUBLIC_AGENCY_LICENCE_NO`
  (plus `NEXT_PUBLIC_AGENT_WHATSAPP`). The build must fail if any are missing. Built in step 5: always
  visible, one line under the disclosure.
- PDPA: the email consent checkbox is unticked by default and required, with a plain-English
  purpose statement. Every email carries a working unsubscribe link.
- **No valuations.** Show historical transacted prices as dated facts only. Never write "fair
  value", "undervalued", "good deal", price predictions or recommendations, and never
  colour-code map areas by price.

## Data sources (verified September 2026)

| Dataset | ID | Fetched via |
|---|---|---|
| A. HDB Property Information (~13.4k blocks) | `d_17f5382f26140b1fdae0ba2ef6239d2f` | `datastore_search`, 5,000-row pages |
| B. Resale flat prices, registration date, Jan-2017 onwards (~240k rows) | `d_8b84c4ee58e3cfc0ece0d773c8ca6abc` | `poll-download` CSV (~24 MB) |
| C. HDB Existing Building (~13.4k footprint polygons) | `d_16b157c52ed637edd6ba1232e026258d` | `poll-download` GeoJSON (~57 MB) |

API behaviour, learned the hard way:
- **Rate limits** without an API key: HTTP 429 or `{"code":24,"name":"TOO_MANY_REQUESTS"}`,
  "try again in N seconds". Run requests sequentially; the client honours the wait.
- **`datastore_search` with `limit=10000` on Dataset A returns HTTP 413** (response too large).
  The client uses 5,000 and halves on 413.
- **`poll-download` returns HTTP 201 on success.** Accept any 2xx.
- The Dataset C GeoJSON download can take ~3 minutes, so it has a 10-minute timeout.
- `distinct=true` is not supported by `datastore_search`.
- Each dataset's ID is checked against its exact name via the v2 metadata endpoint. Any
  schema, ID, town code, flat type or street code format change fails the pipeline with an
  explanatory error. **Never add a silent fallback to old data.**

Facts about the data:
- Dataset A towns are codes (`AMK`, `KWN`, ...); Dataset B uses names (`KALLANG/WHAMPOA`). There
  are 27 towns, including Tengah (`TG`), which has no resales yet (its resale label `TENGAH` is
  unverified).
- The join on normalised `blk_no + street` ↔ `block + street_name` matched 9,744 of 9,745
  resale blocks.
- `sum(sold + rental) == total_dwelling_units` holds for every block.
- Dataset C has `BLK_NO`, `ST_COD` (street **code**, e.g. `TOP02W`) and `POSTAL_COD`, but **no
  street name**. Dataset A has no postal code or street code. See the next section.

## Block locations (`scripts/pipeline/geo-match.ts`)

- Each street code is matched to the Dataset A street whose block numbers contain ≥ 80% of the
  code's block numbers.
- Candidates are gated on the code's first letter, which must be the initial of a word in the
  street name. Codes are built from full words and skip some words: "JLN BT MERAH" is `BUM`,
  "LOR 1 TOA PAYOH" is `TOP`.
- Ties are rejected.
- A match is also rejected if the code's buildings sit beyond its town's 95th-percentile radius
  + 1.5 km.
- A block's location is its footprint's vertex-average centroid (5 dp), else the median of
  located blocks on the same street (`location_precision: "street"`), else none (list only).
- Sep 2026 results: 653 of 660 codes matched, 99.7% of eligible blocks at their own footprint,
  26 at street level, 8 unlocated. The pipeline fails below 98% footprint coverage.
- Town centres (`meta.json` → `towns[].center`) are the median of each town's block footprints.

## MOP derivation (`lib/mop.ts`)

- **Exclusions:** `residential = N`, and blocks with zero sold units (pure rental).
- **confirmed:** at least one resale in Dataset B. Flats can't be resold before MOP, so
  `mop_date` = first resale month = "MOP passed by".
- **estimated:** no resale. Estimated MOP = July of `year_completed + 5` (the month is unknown).
- **`months_since_mop` anchor** (`mopAnchorMonth`): the first resale if it falls less than 24
  months after the estimate, otherwise the estimate. A first resale *before* the estimate
  always wins. Both failure modes this avoids are tested:
  - A 1978 block first resold in 2025 would otherwise read as "just MOP'd".
  - 59 blocks completed in 2019 would otherwise be aged into "mature".
- **Cohorts:** `upcoming` −24..−1 · `just_mopped` 0..23 · `mature` ≥ 24 · `later` < −24.
  Confirmed blocks can never be `upcoming` or `later`.
- **`resale_activity`** from last-12-month resales: none 0 · light 1–4 · active 5+.
- **`median_price_12mo`**: median and count per flat type in that window. Historical fact only.

Known gaps, not modelled:
- Prime Location Housing and Plus/Prime flats have a 10-year MOP and will be mis-estimated when
  their blocks appear.
- Short-lease 2-room Flexi and studio apartments can't be resold, so such blocks stay
  `estimated` forever.
- Resale month is the *registration* month and trails the actual sale.

## Static data contract (`lib/data-contract.ts`)

JSON uses snake_case field names, matching the brief. Bump `DATA_SCHEMA_VERSION` on breaking
changes; the client rejects mismatched files.
- `public/data/meta.json`: sources, totals, map coverage, and per-town cohort counts with
  `center`.
- `public/data/map/<cohort>.json`: compact `MapPoint` tuples with every filter field. Decode
  with `decodeMapPoints`, and flat types with `maskHasFlatType`.
- `public/data/towns/<slug>.json`: full `DerivedBlock[]` for the list and cards (largest ~31 KB
  gzip).
- `public/data/tx/<slug>.json`: per-block transaction tuples, newest first, for block detail
  (largest ~140 KB gzip). Load lazily.

## Conventions

- Unit tests are mandatory for MOP derivation, street-code matching and the haversine town
  matcher: bugs there are invisible and damaging.
- Validate every external payload with Zod at the pipeline boundary.
- Month maths uses integer `MonthIndex` (`lib/months.ts`), never `Date`. "Now" is Singapore time.
- Verify UI changes in a real browser at 375×667, 320×568 and 1280×800 (Playwright with the
  system Chrome), and run Lighthouse mobile. Unit tests don't cover components.
