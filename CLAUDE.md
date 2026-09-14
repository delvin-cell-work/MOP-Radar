@AGENTS.md

# MOP Radar

Mobile-first web app showing Singapore HDB buyers which blocks recently passed, or are about
to pass, their 5-year Minimum Occupation Period (MOP). **The primary view is a map of
Singapore,** so buyers can see which areas have upcoming and just-MOP'd blocks. A white-label
lead-generation tool for a CEA-licensed real estate agent: agent details come from env vars so
the codebase can be rebranded.

## Status

Build order (from the product brief). Stop and show the user after each step.

1. **Done:** data pipeline, MOP derivation, block map locations, tests, weekly refresh
   workflow
2. **Done:** map-first results screen. The user reviewed it in `npm run dev` and approved.
3. **Done (2026-09-14), awaiting the user's review:** geolocation and fallbacks. It opens on the
   national view, snaps to the nearest town, and remembers the town (see Geolocation below).
4. **Next:** filters, block detail, watchlist
5. Email capture, compliance footer, polish

### Where we left off (2026-09-14)

- Step 3 is built and verified. Show it to the user and wait for approval before step 4.
- Verification:
  - vitest: 189 tests.
  - A browser script covered nine location scenarios in both `next dev` and a production
    build: granted, repeat visit, denied, timeout, outside Singapore, non-HTTPS, unsupported,
    never-answered prompt, desktop.
  - A step 2 regression pass also ran.
  - Lighthouse mobile (local production build): performance 90–91, accessibility 100,
    best practices 92, SEO 100.
- Best practices dropped from 96 to 92 because of `geolocation-on-start`. Requesting location on
  load is what the brief specifies; keep it unless the user decides otherwise.
- **Decision 1 (performance): resolved.** No static-map image is needed. On the live site,
  Lighthouse mobile scored performance 95 in two runs (LCP 2.9 s simulated), accessibility 100,
  best practices 92, SEO 100.
- **Decision 2 (still open, ask the user):** in the full-screen map layout, should the four CEA
  details always be visible in the bottom bar with the disclosure, or one tap away? This is
  needed before step 5.
- The agent still needs to register for OneMap before launch.
- **GitHub:** https://github.com/delvin-cell-work/MOP-Radar (public, `main`).
  - Commits are authored as `delvin-cell-work` with the GitHub no-reply email (repo-local git
    config).
  - Pushes authenticate through `gh auth git-credential`, so the GitHub CLI's active account
    must be `delvin-cell-work`.
- **Vercel:** project imported from GitHub.
  - Production: **https://mop-radar.vercel.app** (public).
  - Per-deployment, branch and team URLs are behind Vercel's Deployment Protection login, so run
    Lighthouse and browser checks against the production domain.
  - Build command `npm run build` (runs the data pipeline first), Node.js 24.x.
  - `engines.node` in package.json is pinned to `24.x` to match.
- **Weekly data refresh is live:** `.github/workflows/refresh-data.yml` runs on Mondays at
  02:00 SGT, and on demand from the repo's Actions tab.
  - It runs the tests and the pipeline, then POSTs the Vercel deploy hook (repo secret
    `VERCEL_DEPLOY_HOOK_URL`; hook `weekly-data-refresh` on `main`).
  - The Vercel build runs the pipeline again and publishes the fresh data.
  - A failed run means the data wasn't refreshed. The site keeps serving the last good build.
- Local dev: `npm run data` (~1–3 min; it must finish before starting anything else in that
  terminal), then `npm run dev` → http://localhost:3000. To see the first-visit flow again,
  clear the `mop-radar:town` localStorage key.

## Commands

```bash
npm run data            # fetch data.gov.sg → derive → locate → write public/data/ → print summary (~1 min)
npm test                # vitest: MOP derivation, street-code matching, geo, schemas, CSV, formatting, views
npm run typecheck       # next typegen && tsc --noEmit
npm run lint
npm run build           # prebuild: npm run data · postbuild: npm run check:browsers
npm run check:browsers  # fails if client chunks use syntax or APIs Safari on iOS 15.0 can't run
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
  - `BlockCard`, `MopStatusChip`, `ViewTabs`, `EmptyState`, `MapLegend`, `SiteFooter`.
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
- `scripts/build-data.ts`: pipeline entry. `scripts/pipeline/`: data.gov.sg client, Zod
  schemas, CSV parser, `geo-match.ts`. `scripts/check-browser-support.mjs`: post-build iOS 15
  guard. Never import `scripts/` from `app/` or `components/`.
- `tests/`: vitest (pure logic only; UI is verified in a real browser).
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
  geolocation is not called.
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
  - `MapFrame` and `MapBlockFocus` carry a `key`; `MopMap` applies each once per key.
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
  - Card tap: pans to the block.
  - Dot tap in another town: switches the list town.
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
  (plus `NEXT_PUBLIC_AGENT_WHATSAPP`). The build must fail if any are missing. It is not built
  yet (step 5). The footer already holds the disclosure. Placement in the full-screen map
  layout (always visible vs one tap away) is still to be confirmed with the user.
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
