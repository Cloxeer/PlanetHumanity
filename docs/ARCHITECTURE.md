<!-- /** THIS FILE DOES: System design overview, module APIs, rendering loop, and performance strategy, ROLE: Engine, MAINTAINER NOTE: Update when core abstractions change or new modules are added **/ -->

# Architecture

Pure static site, native ESM, no bundler, no build step, no external npm dependencies at development time. The only runtime dependency is `globe.gl`, lazy-loaded from CDN inside GlobeStage only.

## Module Map

### Core Engine (`src/core/`)

**SpatialStore.js** — Data loading and indexing.
- `load(manifestUrl, { fetchImpl, signal })` — fetches manifest, then all shards in parallel; failed shards are logged, never throw
- `constructor(entities, errors)` — dedupes by id (first wins), sorts by date, freezes each entity
- `all()` → frozen array (date ascending)
- `times()` → Float64Array of UTC ms, index-aligned
- `categoryCodes()` → Uint8Array (entity category index)
- `byId(id)` → Map lookup
- `byCategory(cat)` → frozen array
- `categoryCounts()` → [{ id, count }]
- `CATEGORIES` → 10-element array of category IDs in schema order

**ChronologyEngine.js** — Playback and filtering timeline with multi-mode ranges.
- `domain` → { min, max } ms (min=max=0 if empty)
- `cursor` → current playhead position; initial = domain.max (show all)
- `playing` → autoplay state
- `range` → { mode, start, end } ms; mode ∈ {'all', 'year', 'month'}; default 'all'
- `upperIndex(t)` → count of entities with time ≤ t (binary search, O(log n))
- `rangeIndices(t0, t1)` → [lo, hi) visible in range (cached on (lo, hi, filter))
- `setCursor(t)` → clamps, emits 'change' only if bounds or filter changed
- `setRange(mode)` → 'all' keeps time ≤ cursor (existing), 'year' shows cursor's calendar year, 'month' shows cursor's month; emits 'change' with range payload
- `setCategories(setOrNull)` → null = all; emits 'change'
- `visible()` → frozen array: entities in current range AND active category
- `play() / pause() / toggle()` → autoplay; sweeps min→max over durationMs; emits 'play'/'pause'
- `on(evt, fn) → unsubscribe` — evt: 'change' { cursor, visible, count, range }, 'play', 'pause'
- `destroy()` — cleanup

### UI Critical Path (`src/ui/`)

All factories return `{ ..., destroy() }` for memory safety.

**PlainFeedFallback.js** — Semantic table, first-paint view on every device.
- `createPlainFeed(container, { onSelect })` → { update(entities), destroy() }
- Renders `<table>` with Date, Title, Category, Institution, Country columns
- Keyboard-accessible: rows are buttons, Enter/Space triggers onSelect(entity)
- Renders newest first; caps rows at 200 with "+N more" line
- Reuses row nodes keyed by id; full repaint only on structure change

**TimelineHUD.js** v4 — Canvas track + liquid-glass thumb, time-range modes, jitter-proof, no layout-dependent cursor logic.
- `createTimelineHUD(container, engine, { store })` → { destroy() }
- Bottom frosted glass bar (16 px margins, safe-area inset): `[RANGE MODE CONTROL] [OLDEST BUTTON] [TRACK] [NEWEST BUTTON]`
- RANGE MODES: Segmented control "All time · Year · Month" (fixed width, stable across mode switches). 'all' shows time ≤ cursor (existing behavior). 'year' shows cursor's calendar year [Jan 1, Dec 31 23:59:59.999] UTC. 'month' shows cursor's calendar month. In Year/Month modes, canvas shades active period as accent band (12%) and dims bars outside.
- TRACK: 44 px tall, radius 14 px, canvas (DPR-aware), drawn only on cursor/filter/theme/size/mode change
- Visual: year hairlines with labels, month ticks, bars per paper (3 px, colored), elapsed tint on left
- BUBBLE: shows "2025 · 11 papers" (year mode) or "Mar 2025 · 4 papers" (month mode), above thumb, absolute positioned, transform-only
- LIQUID-GLASS THUMB: DOM `.timeline-thumb` 22×52 px (radius 11), backdrop blur + gradient + inset shadows, over track; clamped to bounds
  - Pointer/drag maps linearly to time; no snapping while dragging (snap preview only on hover, 6 px zone)
  - Scale(1.18) on press/drag; returns on release. Uses `transform: translate3d()` only
  - Drag class removes transition for 1:1 tracking. In Year/Month modes, period is whichever one contains thumb.
- HOVER: ghost line + tooltip (hides while dragging), snap preview within 6 px of bars
- KEYBOARD: ←/→ step by year/month in those modes, by paper in All time
- END BUTTONS: fixed-width (tabular-nums) jump buttons (oldest → start, newest → latest); never change size
- ≤ 640 px: segmented control sits on own row above track; buttons above track. Nothing overflows at 375 px.
- No DOM element's size/width/hidden state changes as a function of cursor (root cause of old jitter)
- ChronologyEngine.setRange(mode) updates visible(); 'change' event adds `range: { mode, start, end }` payload; `get range()` getter available

**InspectorModal.js** — Entity detail drawer.
- `createInspector(root)` → { open(entity), close(), isOpen, destroy() }
- Right-side drawer (bottom sheet < 640px) slides via translate3d
- Shows: title, date, journal, authors (+ "et al."), institution, summary, category, IDs with links (DOI, PMCID links)
- role="dialog", focus trapped, Esc closes, focus returns to opener
- All text via textContent, never innerHTML

**categories.js** — Category metadata and source registry (shared by nav/filter/timeline/globe).
- `export const CATEGORY_META = { [id]: { label, color } }` for the 10 CATEGORIES
- Colors: Apple system hues readable on white AND black (genomics #0A84FF, oncology #FF453A, neuroscience #BF5AF2, infectious-disease #FF9F0A, immunology #30B158, cardiometabolic #FF375F, regenerative-medicine #32ADE6, public-health #D4A200, ai-in-medicine #5E5CE6, rare-disease #A2845E)
- `export const SOURCES = [{ id, label, sublabel, categories }]` for data sources (currently PubMed); future themes (climate, space) added as new SOURCES entries

**icons.js** — Inline SVG icon factory.
- `export const icon(name) → SVGElement` built via createElementNS (no innerHTML), 20×20 viewBox, stroke currentColor, 1.6 stroke width, round caps
- Names: globe, list, filter, sun, moon, plus, minus, reset, compass, close, zoom, external, check

**prefs.js** — Preferences API (theme, text size, motion).
- `getPref(key, fallback)`, `setPref(key, value)` with localStorage, all access wrapped in try/catch (private browsing safe)
- Keys: `ph:theme`, `ph:text`, `ph:motion` (applied to `<html>` as data-theme, data-text, data-motion)
- `applyPrefs()` writes attributes and updates `<meta name="theme-color">` (#F5F5F7 light, #000000 dark)

**ThemeToggle.js** — Nav theme toggle button (sun/moon icons, persisted).
- `createThemeToggle(button, { onChange })` → { get theme(), set(theme), destroy() }
- Default 'light'; swaps sun/moon icons, aria-label reads "Switch to dark/light mode"

**FilterPanel.js** — Right-side filter sidebar (sources, categories, display prefs, live count).
- `createFilterPanel(root, { engine, store, button, badge })` → { open(), close(), toggle(), get isOpen, destroy() }
- Slides in from right: translate3d(100%,0,0) to 0, 280 ms, width min(360px, 100vw), glass backdrop
- role="dialog" aria-modal="true", Esc/backdrop/close button close it, focus trapped
- Content: header "Filters", sources section (card per SOURCES with label/sublabel/count + switch for all + checkboxes for each), display section (text size + motion prefs), sticky footer ("Showing X of Y" live, "Reset" button)
- Every change calls `engine.setCategories(set)` immediately; handlers wrapped in performance.mark/measure('ph:filter')
- Badge shown when any category is off

### Live Data Layers (`src/layers/`, `src/ui/LayerManager.js`, `src/ui/LayersPanel.js`, `src/ui/LayerItemCard.js`, `src/ui/layers.css`)

All layer sources enforce the trust rule: `.gov`, `.edu`, or intergovernmental bodies only. Tests in `tests/layers.test.mjs` validate every layer's domain and trust metadata.

**Registry** — `src/layers/registry.js` aggregates official data layers into `LAYER_GROUPS` and `LAYERS`.
- `LAYER_GROUPS`: [{ id, title, exclusive, allowNone }] for Base map, Live Earth events, Health, Space, Health by country
- Each layer: { id, group, title, description, source:{ org, domain, homepage, license, trust }, render type, approxBytes, refreshMs, filters:[], legend:[], load(filterValues, {signal}) }

**Render Types:**
- **base** — equirectangular EPSG:4326 images (2048×1024) for backgrounds (NASA GIBS WMS, VIIRS, MODIS)
- **points** — { items:[{ id, lat, lng, color, size, title, subtitle, time, url }] } for events (quakes, EONET, outbreaks, trials)
- **texture** — { cells:[{ lat, lng, v, dLat, dLng }], color } for overlays (aurora probability grid)
- **objects** — { objects:[{ id, title, url, color }], positionAt(tMs), track(tMs) } for moving bodies (ISS)
- **country-fill** — { values:Map<iso2,number>, years, min, max, higherIsBetter, unit, format(v) } for choropleth (World Bank health indicators)

**LayerManager** (`createLayerManager({ layers, groups, stage, legend })`) owns all layer state and polling:
- Enforces group exclusivity (e.g., only one base map on at a time)
- Handles loading, errors, retry, and polling via `refreshMs` (paused while tab hidden)
- Aborts fetches on disable
- Debounces filter changes 300 ms before reloading
- Computes country-fill colors from a perceptually even, color-blind-safe Viridis sequential palette
- Persists `{ on:[ids], filters }` in localStorage (`ph:layers`) and restores on reload, obeying 3G law (no fetch on slow connections)
- Lazy-imported on first Layers click or after globe loads if persisted layers exist
- API: `enable(id)`, `disable(id)`, `setFilter(id, key, value)`, `disableAll()`, `state`, `on('change', fn)`, `destroy()`

**3G Law for Layers:**
- ALL layers OFF by default (zero fetch until user enables)
- Each row shows approximate download size
- If connection is slow (saveData or 2G/3G) and a layer was on, it shows "Paused on slow connection · Tap to load" instead of fetching
- Polling pauses while tab is hidden; fetch aborts when layer turns off

**LayersPanel** — Right glass sidebar with groups in order (radio cards for base/country, switch rows for others):
- EPIC thumbnail (NASA latest natural image, ~40 KB, loaded only on panel open and not on slow connection)
- Trust badge per row: shield icon + "Official · nasa.gov" (linked to homepage)
- Live status: "Updated 3 min ago · 214 quakes" / spinner / "Couldn't load · Retry" / "Paused on slow connection"
- Inline filters when layer is on (range, chips, select, text)
- Footer: "Turn all layers off" + "Sources & licenses" expandable list

**Layer Points & Picking:**
- All point layers merged into ONE points mesh (pointsMerge in globe.gl)
- Picking is mesh-free: `onGlobeClick` and rAF-throttled pointermove use `toGlobeCoords` → nearest layer item within 14 px on screen
- Hover shows small glass tooltip (title + subtitle); click opens LayerItemCard (trust badge, relative time, official record link)
- Priority on click: research markers (DOM) first, then layer items, then countries

**Texture Compositor** — Single bake pipeline (idle-scheduled, coalesced):
1. Base image (bundled or supplied HTMLImageElement)
2. Country fill (per-iso2 colors at ~55% alpha)
3. Texture overlays (aurora cells)
4. Borders

Bakes target ≤ `layers.bakeMsMax`; if exceeded, cache base+borders canvas and repaint only fills/overlays.

**Layers Table** — Official sources only:

| id | group | render | source | refresh | notes |
|---|---|---|---|---|---|
| base-classic | base | base | bundled earth-day.jpg | — | Default; no fetch |
| base-today | base | base | NASA GIBS (VIIRS, latest UTC day) | live | Yesterday from space |
| base-night | base | base | NASA GIBS (Black Marble) | live | Night lights |
| base-smoke | base | base | NASA GIBS (MODIS/VIIRS aerosol) | live | Smoke & haze |
| base-sst | base | base | NASA GIBS GHRSST | live | Ocean temperature |
| quakes | events | points | USGS GeoJSON | 5 min | Filters: period, magnitude (0–7, default 2.5) |
| eonet | events | points | NASA EONET v3 | 30 min | Filters: category chips, days (7/30/90) |
| aurora | space | texture | NOAA SWPC OVATION | 30 min | Cells ≥10% painted green; shows Kp in status |
| iss | space | objects | NASA ISS OEM (via `data/live/iss-oem.json`) | — | Marker + ±45 min ground track; ECI J2000 propagated locally |
| outbreaks | health | points | WHO Disease Outbreak News API | — | Filter: months (3/6/12); country parsing |
| trials | health | points | ClinicalTrials.gov API v2 | — | Filter: condition, max sites 500 |
| wb-lifeexp, wb-u5mort, wb-healthexp, wb-physicians | country | country-fill | World Bank WDI | — | Aggregates filtered; iso2 match required |

**ISS Ephemeris:** `scripts/fetch-iss.mjs` (triggered by `.github/workflows/live-data.yml` every 12 h) fetches NASA's OEM from S3 (no CORS) and writes `data/live/iss-oem.json` for same-origin loading. Window margin outlasts cron period so track never runs empty.

**Performance Budgets:**
- `layers.defaultOnMax`: 0 (no resource fetches on page load)
- `layers.toggleMsMax`: handler time ≤ 10 ms
- `layers.bakeMsMax`: texture bake time on base switch ≤ 80 ms
- `layers.layersLazyGzipMax`: 60 KB gzipped, lazy-loaded only (src/layers/*, LayerManager, LayersPanel, LayerItemCard, layers.css)
- `browser.globeFrameP95MsMax`: frame p95 with quakes/EONET/trials all on ≤ 4 ms

### UI Lazy Path (`src/ui/`)

**GlobeStage.js** v4 — Render-on-demand 120+ fps Earth, baked-texture borders, mesh-free country picking, live-themeable atmosphere, accessible markers.
- `createGlobeStage(container, { entities, cursor, theme, onSelect, onCountry })` → `{ setPoints(entities, cursorMs), setTheme(theme), setCountryCounts(map), highlightCountry(iso2), clearCountry(), setSearchHighlight(idSet|null), flyTo(entity, opts) → Promise, flyToCountry({ lat, lng }) → Promise, zoomIn(), zoomOut(), resetView(), getView() → {lat,lng,altitude,northDeg}, onViewChange(fn) → unsubscribe, markerFor(id) → HTMLElement|undefined, wake(ms), stats() → {renders, frameP95Ms, paused}, destroy() }`
- TEXTURED EARTH: NASA earth-day.jpg (1600×800, 239 KB, natural color) served same-origin at `data/geo/earth-day.jpg`; country borders stroked into the texture at load (2D canvas, equirectangular projection), not drawn as meshes; matte finish (shininess 0, black specular), flattened lights. Re-bake on theme change.
- RENDER ON DEMAND: Loop pauses when idle (`pauseAnimation`). `wake(ms)` resumes and re-arms an idle timer; call it on user interaction (controls, wheel, pointer on canvas), camera moves, setPoints, theme change, resize. OrbitControls damping emits 'change' until motion settles, keeping loop alive naturally. Stats: `renders` counts actual render calls, `frameP95Ms` from rolling 120-frame window, `paused` flag.
- COUNTRY PICKING (no meshes): `onGlobeClick(({lat,lng}))` runs point-in-polygon test on geojson with precomputed bbox filter, then calls `onCountry`. Hover: `toGlobeCoords(x,y)` feeds same test on rAF-throttled pointermove (skipped while dragging); only hovered + selected countries in `polygonsData` (0–2 translucent caps, no strokes).
- CSS2D LABELS: Capped at 60 on screen (prioritize has-papers, then area); LOD: altitude > 1.6 shows 25 largest; 0.9–1.6 shows 70 largest; < 0.9 shows all. Hidden (opacity toggle) while dragging, restored 150 ms after release. Has-papers labels show `<img>` flag (16×12 from `flagUrl(iso2)`) before name.
- PIXEL RATIO: `min(devicePixelRatio, 2)` idle; drop to `min(devicePixelRatio, 1.5)` during drag if frameP95 > 6 ms; restore on release.
- POLES AND EQUATOR: HTML `.ph-pole` at (±90,0) with "N"/"S" captions; equator dashed yellow line (rgba(255,214,10,0.8)) with "Equator" label at (0,0).
- MARKERS: htmlElementsData; `onSelect(entity, markerEl)` fires on click. `.match` class (yellow ring) when in search results; `.dim` class (opacity 0.25) when not matching search.
- Atmosphere swaps on theme; resetView to { lat: 20, lng: 10, altitude: 2.2 } over 800 ms.
- `globePolicy({ search, connection, webgl })` → 'auto' | 'on-demand' | 'off' — same rules as v3.
- Exports: globePolicy, hasWebGL, GLOBE_DOWNLOAD_LABEL = '~0.8 MB'

**GlobeControls.js** — Zoom/reset/legend/compass overlay plus keyboard rotation.
- `createGlobeControls(root, stage)` → { destroy() }
- Vertical glass stack at bottom-right (above timeline HUD): [legend] [+] [−] [reset] [compass]
- Legend button opens a glass popover listing 10 categories (color dot + label + count), ring/line meanings (fresh/search/selected/poles/equator), and synced live from stage.
- Compass: northDeg = the globe's north axis (+Y) expressed in the camera's right/up basis, computed from camera.position and camera.up (always current) - no screen projection. With OrbitControls (up = +Y) this is always 0 (north up); the math stays general. Unwrapped (shortest delta), no CSS transition, DOM written only when the angle moves > 0.1° or the caption changes.
- All buttons: aria-label + tooltip.
- Keyboard on globe container (tabindex=0, role="application"): arrows rotate 10°, +/= zoom in, - zoom out, 0/Home reset.
- ≤ 640 px: 40×40 buttons (hit area ≥ 44 via padding), compass caption pill moves below, stack sits above mobile HUD.

**Legend.js** — Glass popover explaining globe colors and symbols.
- `createLegend(anchorBtn, { counts } = {})` → `{ open(), close(), toggle(), destroy() }`
- Anchored left of controls stack. Lists 10 categories (color swatch + label + live count), plus notes on ring types (pulsing = within 30 days, yellow = search match, highlighted = selected) and reference markers (N/S poles, equator line).
- role="dialog", Esc + outside-click close, focus trapped and returned.

**PointCard.js** — Glass document card anchored beside a marker.
- `createPointCard(root, { onZoom, onDetails })` → { open(entity, anchorEl), close(), get isOpen, destroy() }
- Max-width 300 px; shows category swatch/label, title (3-line clamp), date·journal, institution, city/country
- Buttons: [Zoom in] (primary, zoom icon), [Details], [close ×]
- Anchored beside marker; follows anchorEl.getBoundingClientRect() in rAF (one layout read/frame); flips to stay inside viewport; hides if marker far-side
- ≤ 640 px: bottom mini-sheet above timeline, managed by SheetGesture for drag-to-dismiss
- opacity + scale animation from anchor (160 ms); role="dialog" (not modal); Esc/click-outside close
- Zoom in closes card, awaits stage.flyTo(entity), opens InspectorModal

**SearchPanel.js** — Spotlight-style search with AND-term matching and yellow highlights.
- `createSearchPanel(root, { store, onSelect(entity), onResults(idSet|null) })` → `{ open(), close(), toggle(), get isOpen, destroy() }`
- Entry points: search icon button in nav (left cell), ⌘K / Ctrl+K, "/" (when focus not in input).
- UI: Full-width sheet ≤ 640 px, glass panel centered near top on desktop; large autofocus input, live result count, max 50 results rendered.
- Each result: title (with highlights), date + category swatch + label + country, 1-line snippet from best-matching other field (summary/authors/institution/journal/DOI) with highlights.
- Keys: ↑/↓ select, Enter activates, Esc closes, click-outside closes; focus returns to opener.
- **Matching (pure functions exported for tests):** `buildIndex(entities)` per-entity, lowercase + diacritic-folded field strings (title, summary, authors, journal, institution name/city, country code + Intl.DisplayNames, category, pmid, doi, pmcid, date). `search(index, query, { limit })` splits query into terms; entity matches if EVERY term is substring of some field (AND); scoring: title +10, word-start +3, exact word +5, other fields +1–4; ties newest first. `highlight(text, terms)` → DocumentFragment with `<mark class="ph-hl">` nodes, works in Node.
- **Highlight style:** `mark.ph-hl { background: rgba(255,214,10,0.55); color: inherit; border-radius: 3px; padding: 0 1px }`, dark variant.
- **Speed:** Debounce input with rAF. Query p95 ≤ 5 ms on 10k synthetic entities (deterministic PRNG in tests/search.test.mjs).
- On results change, call `onResults(new Set(ids))` or null for empty query. SHELL passes to stage.setSearchHighlight and to list (PlainFeed gets `.dim` on non-matching rows).

**SheetGesture.js** — Drag-to-resize / drag-to-dismiss for mobile bottom sheets.
- `attachSheetGesture(sheetEl, { handleEl, onClose, detents = [0.5, 0.92] })` → { destroy() }
- Active only ≤ 640 px (matchMedia, live re-evaluated). Adds visible 36×5 rounded grabber at sheet top.
- Pointer drag on handle or header moves sheet with translate3d(0,y,0), no transition during drag. On release: velocity (last 80 ms) + position pick detent (half ≈ 50% viewport, full ≈ 92%) or close if dragged down > 25% of height or flung > 0.5 px/ms.
- Animates to target with `transition: transform 280ms var(--ease)`. Keyboard: grabber is a button (toggle), Esc still closes.
- Opens at half detent (inspector at full if content taller). Body scroll inside sheet normal; gesture starts from grabber/header or from top-scrolled content on downward drag.
- Applied to InspectorModal, CountryPanel, PointCard for mobile mini-sheet dismiss.

**flags.js** — ISO2 to flag SVG.
- `flagUrl(iso2)` → `assets/flags/4x3/${iso2.toLowerCase()}.svg` or null for invalid input.
- `flagImg(iso2, { w=16, h=12, alt='' })` → `<img>` with loading="lazy" decoding="async" fetchpriority="low", fixed dimensions, 0.5 px border-radius 2 px; or null under saveData / 2G (callers fall back to code text).
- Appears in list Country column (flag + code), CountryPanel header (32×24), Inspector/PointCard location lines (16×12), and globe has-papers labels (16×12).

**CountryPanel.js** — Right-side glass sheet (bottom sheet ≤640 px) listing papers from a clicked globe country.
- `createCountryPanel(root, { store, engine, onSelectPaper, onClose })` → `{ open({ iso2, name }), close(), get isOpen, destroy() }`
- Lazy-imported on first globe country click; shares FilterPanel's motion/focus-trap pattern
- Header: country name + flag emoji (regional-indicator code points) + paper count
- Body: category breakdown bar + list of all papers where `institution.country === iso2` (newest first)
  - Papers after timeline cursor marked `future` (60% opacity) + "after current timeline date"
  - Clicking a paper calls `onSelectPaper(entity)` → main flies to it and opens inspector
- Footer link: "Search PubMed for research from {name}" → pubmed.ncbi.nlm.nih.gov with affiliation filter
- Empty state: "No papers from {name} in this catalog yet."
- Styles in `src/styles.css` under `/* ---------- country panel ---------- */` block

**RefImage.js** — Wikipedia reference photo frame for a paper's institution (lazy).
- `mountRefImage(container, entity)` → `{ destroy() }`; renders fixed 16:9 frame (no layout shift) and queries Wikipedia API
- On 3G/slow connection: show "Load reference photo" button instead of auto-fetch
- Queries Wikipedia with institution name + city; retries with just the city or first comma-segment of name
- Displays image with caption "Photo: Wikipedia — {page title}" (linked), plus optional "See PMC figures" link if entity.ids.pmcid exists
- Session-only in-memory Map cache per entity id; never persists to storage or throws errors
- Integrated into PointCard (top) and InspectorModal (below title) via dynamic import

**globe.css** — All globe/marker/card/country-panel/refimage/control styles.
- Animate only transform/opacity; all animations disabled under [data-motion="reduce"] or prefers-reduced-motion
- .ph-marker: 44×44 hit area, pointer-events:auto (globe.gl layer is none); .ph-dot 10 px (14 px coarse); hover/focus scales 1.9×
- .pop animation: 320 ms spring scale-in; .fresh animation: pulsing ring
- .ph-point-card: glass, 300 px max, opacity + scale 160 ms entry/exit
- Control buttons: glass stack, 44 px hit targets, tooltips
- GlobeStage injects `<link rel="stylesheet" href="src/ui/globe.css">` and awaits its load

### App Shell

**index.html** — Server-rendered skeleton, module preloading.
- No inline scripts; relative URLs only (GitHub Pages serves under /humanity-catalog/)
- `<link rel="modulepreload">` for critical modules (main.js, core/*, ui/TimelineHUD, ui/InspectorModal, ui/PlainFeedFallback; NOT GlobeStage)
- `<link rel="preload" as="fetch" href="data/shards/manifest.json">`
- Skeleton text ("Loading PubMed breakthroughs…") in list container for first paint
- Meta viewport, theme-color #000, description
- `<noscript>` message

**src/main.js** — Bootstrap and event wiring.
- Load store → engine → plain feed → HUD → inspector → conditionally globe
- Per globePolicy(): auto → idle import; on-demand → button
- Globe failure → log once with console.warn, keep list working
- PerformanceObserver('longtask') + 'measure' entries → metrics
- Expose `window.__PH__ = { store, engine, metrics, ready: Promise }`
- Mark 'ph:list-visible' when first rows render

**src/styles.css** — Responsive layout, reduced-motion, contrast.
- Full-viewport stage; list scrolls; HUD fixed bottom with env(safe-area-inset-bottom)
- ≤ 640px: responsive; drawer becomes bottom sheet
- @media (prefers-reduced-motion): disable animations
- @media (forced-colors): sane contrast
- :focus-visible ring
- System fonts only (no webfont downloads)

## State Loop

```
FilterPanel change (checkbox click) → engine.setCategories(set)
                           or
TimelineHUD scrub (drag/keyboard) → engine.setCursor(t)
                           or
ThemeToggle click → prefs.setPref('theme') + stage.setTheme(theme)
                           ↓
                    Engine 'change' event { cursor, visible, count }
                           ↓
                  PlainFeed.update(visible) + stage.setPoints(visible, cursor)
                           ↓
                [User clicks row or globe point]
                           ↓
                   Inspector.open(entity) or stage.flyTo(entity) + PointCard.open(entity)
                           ↓
            [Loop back or new interaction]
```

## Loading Strategy (Progressive Enhancement)

1. **HTML parses** → skeleton ("Loading…"), data-theme="light" set immediately (no flash)
2. **CSS loads** → layout locks, light/dark tokens apply
3. **Module preloads start** → critical modules begin fetching (non-blocking)
4. **Manifest fetches** → metadata begins
5. **main.js executes** → creates store, engine, feed; prefs applied; ThemeToggle, FilterPanel created (hidden)
6. **First shard loads** → feed.update() called
7. **ph:list-visible mark** → DOM interactive, user can browse, filter/theme controls live
8. **Other shards load in parallel** → feed updates incrementally
9. **If globePolicy='auto'** → requestIdleCallback imports GlobeStage + GlobeControls + PointCard in parallel
10. **If globePolicy='on-demand'** → Globe segment click triggers the three-module import
11. **If globePolicy='off'** → Globe segment disabled with tooltip

## Theming (Light/Dark)

- **Root attributes:** `data-theme` ('light' or 'dark'), `data-text` ('normal' or 'large', scales via rem), `data-motion` ('normal' or 'reduce', disables all animations)
- **Light tokens (default)** `--bg #F5F5F7; --surface #FFFFFF; --elevated #FFFFFF; --glass rgba(255,255,255,0.72); --hairline rgba(0,0,0,0.12); --text #1D1D1F; --text-dim #6E6E73; --accent #0071E3; --shadow 0 8px 32px rgba(0,0,0,0.12)`
- **Dark tokens** (Apple HIG) `--bg #000000; --surface #0A0A0C; --elevated #1C1C1E; --glass rgba(28,28,30,0.65); --hairline rgba(255,255,255,0.12); --text #F5F5F7; --text-dim #A1A1A6; --accent #0A84FF; --shadow 0 8px 32px rgba(0,0,0,0.5)`
- **Glass recipe** `backdrop-filter: blur(20px) saturate(180%); background: var(--glass); border: 0.5px solid var(--hairline)`
- **Motion** `--ease: cubic-bezier(.32,.72,0,1)`, 280 ms for panels, 160 ms for hovers; under `[data-motion="reduce"]` or `prefers-reduced-motion`: 0 ms transitions, no pulse animations
- **Theme persistence** prefs.js stores `ph:theme`; no inline script (accepting brief light flash for returning dark-mode users saves 400 ms on 3G)
- **Meta theme-color** updated to `#F5F5F7` (light) or `#000000` (dark) on theme change

## Globe Country Data (Lazy)

- **Source:** countries-110m.geojson generated once by `scripts/build-geo.mjs`
- **Script:** fetches https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json (TopoJSON) and i18n-iso-countries codes.json; hand-rolled decoder (quantized delta arcs, no deps); rounds coordinates to 2 decimals; computes area-weighted label points (centroid); writes FeatureCollection with iso2, name, labelLat, labelLng, area properties
- **Format:** first line `{ "$comment": "/** ... **/",` then `"type": "FeatureCollection"`; ≥170 features with iso2 set for ≥165
- **Budget:** ≤ 55 KB gzip
- **GlobeStage usage:** polygonsData for country caps/strokes/labels; label points feed htmlElementsData for LOD-based label display; iso2 ties to institution.country field for CountryPanel wiring

## WebGL Lifecycle (GlobeStage)

- **Create** → requestAnimationFrame loop starts, renderer renders, land-geojson and globe.css load
- **Pause** → when document.hidden (true), call pauseAnimation()
- **Resume** → when document visible (true), resume loop
- **Destroy** → remove marker DOM elements, drop stylesheet link, dispose renderer/geometries/materials, disconnect ResizeObserver and visibility observer, remove canvas from DOM, clear marker cache

## Performance Budgets

| Goal | Budget | Role |
|------|--------|------|
| Critical (HTML + CSS + main.js + core/* + PlainFeed + TimelineHUD + Inspector) gzipped | ≤ 40 KB | Slow 3G: list visible ≤ 1s |
| Data (all shards) gzipped | ≤ 40 KB | Supports 10k+ entities |
| Single file max gzip | ≤ 15 KB | No bloat in any module |
| Globe texture (earth-day.jpg) raw bytes | ≤ 260 KB | NASA texture, not gzipped (lossy image) |
| Globe lazy bundle (GlobeStage + GlobeControls + Legend + SearchPanel + PointCard + SheetGesture + flags.js + globe.css + search.css + countries-110m.geojson + CountryPanel + RefImage) gzipped | ≤ 80 KB | On-demand/auto load, separate from critical |
| SearchPanel/Legend/SheetGesture critical flag | True/True/True | Lazy/lazy/critical by size; critical total ≤ 40 KB |
| List visible (Slow 3G) | ≤ 1000 ms | Perceivable interactivity |
| Theme toggle handler | ≤ 10 ms | Fast visual feedback |
| Filter toggle handler | ≤ 10 ms | Fast visual feedback |
| Scrub handler p95 | ≤ 10 ms | Smooth scrubbing |
| Category toggle (setRange) | ≤ 5 ms | Range mode switch on 10k entities |
| Autoplay avg FPS | ≥ 55 | Fluid 60 FPS target |
| Globe FPS ratio (measured / idle rate) | ≥ 0.9 | Continuous rotation with constraints |
| Globe frame p95 during rotation | ≤ 4 ms | 120+ fps target |
| Globe idle renders (after 1.5s) | 0 | Render loop fully paused when idle |
| Compass max jump between updates | ≤ 20° | Smooth needle without jumps |
| Search query p95 (10k synthetic) | ≤ 5 ms | Fast AND-term matching |
| Touch target minimum | ≥ 44 px | WCAG 2.5.5 compliance |
| Long tasks during scrub | 0 | No jank from timeline interaction |

See `tests/budgets.json` for the full network profile and performance thresholds.

## Why No Framework or Bundler

- **Static site** with native ESM means every dependency can be cached and reused across requests; no build toolchain to install and maintain
- **No npm packages** → no supply-chain risk, no outdated transitive deps, no licensing issues, no vendor lock-in
- **Module preload** strategy is explicit and measurable; bundlers hide load sequencing
- **Direct CDN imports** (globe.gl) are transparent and testable; vendoring would hide bugs
- **No build step** means faster iteration, easier debugging in production, smaller attack surface
- **Selective enhancements** (globe optional) naturally emerge from conditional imports, not configuration

This repo prioritizes **simplicity**, **transparency**, and **reliability** over framework conveniences.
