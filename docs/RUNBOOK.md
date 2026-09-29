<!-- /** THIS FILE DOES: Operational guide for returning maintainers, troubleshooting, and common tasks, ROLE: Automation, MAINTAINER NOTE: Update this when adding new check scripts or changing the deployment process **/ -->

# Runbook

## "Returning After 2 Years" Checklist

You walked away from this repo and are back. Do this in order:

1. **Run the three validation checks locally**
   ```bash
   node scripts/validate-shards.mjs
   node --test "tests/*.test.mjs"
   node scripts/perf-budget.mjs
   ```
   All must exit 0. If any fail, see "Common Failure Messages" below.

2. **Smoke test in browser**
   ```bash
   python -m http.server 8080
   # OR: npx serve
   ```
   Open `http://localhost:8080/tests/smoke-check.html` in a modern browser **and keep the tab visible** (it pauses measurements if the tab is hidden). It will:
   - Load the real app in an iframe (`?view=list` and `?view=globe`)
   - Assert list visible time, scrub handler performance, autoplay FPS, console errors
   - Test layer toggles, filters, frame rate with multiple layers on
   - Display a PASS/FAIL table
   - Set `document.title` to `PASS` or `FAIL n`
   - **Note:** Layer availability checks (endpoints reachable, counts > 0) are skipped if the browser is offline; other assertions still run

3. **Check GitHub Pages deployment**
   - Go to your repo's **Settings > Pages**
   - Source should be **GitHub Actions**
   - The deploy workflow (`.github/workflows/deploy.yml`) runs on push to `main`
   - Visit https://username.github.io/humanity-catalog/ (your Pages URL)

4. **Verify data is present**
   - Check that `data/shards/manifest.json` exists and lists all shard files
   - Check that each shard file (`2024/research_pubmed.json`, etc.) exists
   - Run `node scripts/validate-shards.mjs --data-only` to validate data schema

## Adding a Data Layer

To add a new official live-data source (government, intergovernmental, or academic domain):

1. **Create the module** in `src/layers/{id}.js`:
   ```js
   /** THIS FILE DOES: Fetches {source name}, ROLE: Data, MAINTAINER NOTE: {pitfall} **/
   export const {id} = {
     id: '{id}',
     group: '{base|events|space|health|country}',
     title: 'Human title',
     description: 'One-line description',
     source: { org: 'Org name', domain: 'usgs.gov', homepage: '...', license: 'CC0|MIT|...', trust: 'government'|'intergovernmental'|'academic' },
     render: 'base'|'points'|'texture'|'objects'|'country-fill',
     approxBytes: 180000,
     refreshMs: 300000, // null for static
     filters: [{ key: 'period', type: 'range', label: 'Days', min: 1, max: 7, default: 1 }],
     legend: [{ label: 'Magnitude 0–3', color: '#FF0000', shape: 'dot' }],
     async load(filterValues, { signal }) {
       const res = await fetch(url, { signal });
       const json = await res.json();
       return normalize(json, filterValues);
     }
   };
   export function normalize(json, filters) { /* pure; return LayerData by render type */ }
   ```

2. **Add to registry** in `src/layers/registry.js`:
   - Import the module at the top
   - Add to `LAYERS` array in render-group order

3. **Create a fixture** in `tests/fixtures/layers/{id}.json`:
   - Save a real response (≤ 30 KB), trimmed if needed
   - Add a `$comment` header line with `/** THIS FILE DOES: ... **/`

4. **Add a test** in `tests/layers.test.mjs`:
   - Trust rule verification (import normalize, call it on the fixture, check output schema)
   - Bounds checking (lat in [-90,90], lng in [-180,180], no NaN)

5. **Update `tests/budgets.json`** if the layer adds to the lazy gzipped bundle size

6. **Run tests:**
   ```bash
   node scripts/validate-shards.mjs --headers-only
   node --test "tests/layers.test.mjs"
   node scripts/perf-budget.mjs
   ```

## A Layer Stopped Working

1. **Check the endpoint in browser DevTools:**
   - Open the live site
   - Open Layers panel and toggle the layer on
   - Watch Network tab for the request
   - If 404 or timeout: the endpoint may have moved or changed structure

2. **Update the adapter:**
   - Verify the new endpoint URL and response format
   - Update the `load()` fetch URL in `src/layers/{id}.js`
   - Update the `normalize()` function to match the new schema (field names, nesting, etc.)

3. **Update the fixture:**
   - Fetch a fresh response and save to `tests/fixtures/layers/{id}.json`
   - Re-run tests to verify the new normalize() works

4. **Test live:**
   - Run smoke tests: `http://localhost:8080/tests/smoke-check.html`
   - Toggle the layer and confirm count + status update

## Live Data Refresh (ISS Ephemeris)

The `.github/workflows/live-data.yml` workflow runs every 12 hours to refresh the ISS trajectory:

```yaml
name: Live data
on:
  schedule:
    - cron: '17 */12 * * *'  # 00:17 UTC and 12:17 UTC daily
  workflow_dispatch
jobs:
  fetch-iss:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/fetch-iss.mjs
      - run: git commit -m 'chore: refresh ISS OEM ephemeris'
      - run: git push
```

This job requires **Actions write permission** in your repo Settings. `scripts/fetch-iss.mjs` fetches NASA's OEM from S3 (lacks CORS), trims it to a 14-hour window (12h cron period + 2h margin), and writes `data/live/iss-oem.json` for same-origin loading. The window outlasts the cron period so the ISS layer never runs out of track before the next refresh.

## Adding a Year Shard

When you're ready to add papers for a new year:

1. Create the folder: `data/shards/{YYYY}/`
2. Create the shard file: `data/shards/{YYYY}/research_pubmed.json`
3. Start with this template:
   ```json
   { "$comment": "/** THIS FILE DOES: Research papers indexed in {YYYY}, ROLE: Data, MAINTAINER NOTE: Sorted by date asc; validated by validate-shards.mjs **/",
     "schemaVersion": 1,
     "year": {YYYY},
     "entities": []
   }
   ```
4. Add entities following the schema in `data/schema/entity.v1.schema.json`
5. Update `data/shards/manifest.json` to include `"{YYYY}/research_pubmed.json"`
6. Run `node scripts/validate-shards.mjs` to check
7. Run the smoke test

## Adding a Paper

To draft a new entity from a PMID instead of hand-typing it:

```bash
node scripts/fetch-pubmed.mjs <PMID> [<PMID>...]
```

This fetches NCBI esummary + efetch (throttled, ≤3 req/s), skips unknown PMIDs and
non-primary publication types (Review, Erratum, Comment, Retracted Publication, etc.,
warning loudly on stderr), and prints a draft entity JSON per PMID to stdout. Fill in
the `TODO` fields by hand (`category`, `summary`, `institution.city` guess verification,
`institution.country`, `institution.lat`, `institution.lng`), paste the entity into the
shard matching its `date` year (keeping entities sorted by date ascending), then run
`node scripts/validate-shards.mjs` to confirm it passes.

## Refreshing Country Flags

The country flag SVGs are vendored at `assets/flags/4x3/{iso2}.svg` from flag-icons@7.5.0. To refresh them after bumping the package version:

```bash
node scripts/fetch-flags.mjs
```

This fetches `https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/4x3/{iso2}.svg` for every alpha-2 code in i18n-iso-countries, throttles requests (8 concurrent), skips 404s gracefully, and writes `assets/flags/LICENSE.txt` with the MIT license. Reports total size. The `assets/` directory is excluded from the header validator since it contains vendored third-party files.

## Regenerating Country GeoJSON

The country polygons and labels are checked in at `data/geo/countries-110m.geojson` and generated once by `scripts/build-geo.mjs`. To rebuild:

```bash
node scripts/build-geo.mjs
```

This fetches the latest world-atlas countries-110m.json (TopoJSON) and i18n-iso-countries codes; decodes with a hand-rolled decoder (no npm deps); computes area-weighted label centroids for each country; rounds coordinates to 2 decimals; and writes a small FeatureCollection (≤ 55 KB gzip) with iso2, name, labelLat, labelLng, and area per feature. Commit the output. Rebuild only if you bump the pinned world-atlas or i18n-iso-countries versions, or need updated political boundaries.

## Adding a New Data Source or Theme

To add climate research, space exploration, etc., as new data sources:

1. **Extend SOURCES in `src/ui/categories.js`:**
   ```js
   export const SOURCES = [
     { id: 'pubmed', label: 'Medical research', sublabel: '...', categories: [...all 10 medical ids] },
     { id: 'climate', label: 'Climate science', sublabel: '...', categories: ['climate-modeling', 'emissions', ...] },
   ];
   ```
2. **Add new category ids to core/SpatialStore.js `CATEGORIES` array** (must match the order in categories.js)
3. **Add labels and colors in categories.js:**
   ```js
   const LABELS = { 'climate-modeling': 'Climate modeling', ... };
   const COLORS = { 'climate-modeling': '#30B158', ... };
   ```
4. **Create corresponding data shards** in `data/shards/{YYYY}/` with the new category ids
5. **Update index.html nav segment** to show the new source/theme if needed
6. Run validation and smoke tests

## Changing Category Colors

Category colors live in `src/ui/categories.js` under the `COLORS` object. To change oncology from #FF453A to a new hue:

1. Edit `COLORS.oncology = '#NEW_HEX'`
2. **Ensure the color is readable on both light AND dark backgrounds** (test with WCAG contrast checker)
3. Run `node --test "tests/*.test.mjs"` to verify schema compliance
4. Test the globe and list in both light and dark mode
5. Commit and deploy

## Running Tests

The test suite is Node-based and split into three parts:

```bash
# Validate all shard data (schema, uniqueness, constraints)
node scripts/validate-shards.mjs

# Run unit and integration tests (engine, policy, etc.)
node --test "tests/*.test.mjs"

# Check performance budgets (gzip sizes, Slow 3G waterfall)
node scripts/perf-budget.mjs
```

All three must exit 0 before merging to main.

## Bumping globe.gl Version

globe.gl is pinned in `src/ui/GlobeStage.js` and loaded from CDN. To update:

1. Check https://www.npmjs.com/package/globe.gl for the latest version
2. Edit `GlobeStage.js` and update the version in the URL:
   ```js
   const GLOBE_GL_URL = 'https://cdn.jsdelivr.net/npm/globe.gl@<NEW_VERSION>/dist/globe.gl.min.js';
   ```
3. **Compute the new SRI hash** using a tool like https://www.srihash.org/ or:
   ```bash
   curl -s https://cdn.jsdelivr.net/npm/globe.gl@<NEW_VERSION>/dist/globe.gl.min.js | openssl dgst -sha384 -binary | openssl enc -base64 -A
   ```
4. Update `GLOBE_GL_SRI = 'sha384-...'`
5. Test locally:
   - `python -m http.server 8080`
   - Open `http://localhost:8080/?view=globe` in browser
   - Interact with the globe; check console for errors
6. Run `node scripts/perf-budget.mjs` to ensure the bundle size goals still hold
7. Commit and push; the deploy workflow will run checks

## Globe.gl Pitfalls Learned

When working with globe.gl, render-on-demand, country picking, and compass math:

1. **Never compute the compass from getScreenCoords — three.js camera matrices update only inside render()**, so reads between frames use stale state and made the needle spaz across 359°→0°. pointOfView() also moves the camera position before its orientation catches up. Instead, use vector math on camera.position + camera.up (always current): see computeNorthDeg in GlobeStage.js. Keep the unwrapping (shortest delta) and NO CSS transition on the needle. The smoke test sweeps 360° at lat 20/80 and fails on any jump > 20°.
2. **The globe pauses rendering when idle** — anything that changes the scene must call `wake()` or it won't appear until the next interaction. Call wake() on controls 'start'/'change'/'end', wheel, pointer down/move, flyTo/flyToCountry/resetView/zoom (tween duration + 200 ms), setPoints (+400 ms), theme change, and resize.
3. **Never position overlays with fixed pixel offsets from the HUD** — use the CSS variable `var(--hud-clearance)` published by TimelineHUD so sheets and controls adapt to the HUD's actual size without hardcoding coordinates.
4. **Search matches whole words/prefixes, not mid-word** — by design for speed: AND-term matching with word-boundary detection stays ≤ 5 ms at 10k papers. Building a full inverted index would bloat the critical bundle.
5. **CSS2D layer writes inline z-index per element** — keep `#globe-root .scene-container { isolation: isolate }` or labels will paint over cards and controls.
6. **Markers must set `pointer-events: auto`** — globe.gl's HTML layer defaults to `pointer-events: none`. See `src/ui/globe.css` `.ph-marker`.
7. **Never add margins to markers** — CSS2D already centers them; margins break positioning.
8. **Animation fill-mode must not be `both` or `forwards` on hover-scaled elements** — causes flickering when animation ends. Use `fill-mode: none` and rely on transition for the return.
9. **SRI hash must be recomputed on version bump** — the browser refuses to load a mismatched hash; use https://www.srihash.org/ or the command in Bumping globe.gl Version.
10. **Reference photos: Wikipedia search returns people or the wrong university** — relevance rules are locked by `tests/refimage.test.mjs`. Add a new test case whenever a wrong photo is reported; do not loosen `relevant()` without a test.
11. **Windows does not render flag emoji** (shows regional-indicator letters instead) — this is expected and acceptable for accessibility.

## What If jsdelivr or globe.gl Disappears?

The app is designed to degrade gracefully:

1. **If globe.gl CDN fails** — the list view keeps working. GlobeStage.js import will error, caught in main.js, logged once with console.warn (not error), and the app continues with the list only.
2. **If the catalog is taken offline** — it's a static site served from GitHub Pages; as long as Pages is enabled, it lives. If you move the repo, update the Pages URL in Settings.
3. **If data/shards/ is lost** — run the validation checks and fix the manifest and shard files. Each shard is a plain JSON file with no magic.

## GitHub Pages Settings (Maintenance)

Check these every few years:

1. **Settings > Pages > Build and deployment**
   - Source: **GitHub Actions** ✓
   - (NOT "Deploy from a branch")
2. **Settings > Pages > Enforce HTTPS** ✓
3. **Settings > Branch protection rules > main** (optional but recommended)
   - Require status checks to pass before merging (workflow: `Validate`)
   - Dismiss stale PR approvals when new commits are pushed

## Retraction Check Procedure

Before adding a new paper:

1. Open https://pubmed.ncbi.nlm.nih.gov/
2. Search: `{pmid} AND ("Retracted Publication"[PT])`
3. If zero results: safe to add
4. If results found: the paper is retracted; skip it and note in comments why
5. Update `verified.date` to today

## Common Failure Messages

### validate-shards.mjs

**"Entity missing id or lacks pmid"**
- Fix: Ensure every entity has `ids.pmid` and that `id === 'pmid-' + ids.pmid`

**"PMID is not unique"**
- Fix: Two entities share the same pmid. Remove the duplicate or verify the PMID is correct on PubMed.

**"Date year does not match shard year"**
- Fix: Date `2023-05-15` found in `2024/` folder. Move it to the correct shard or update the year.

**"Manifest lists file that does not exist"**
- Fix: Create the missing shard file or remove it from manifest.json.

**"File on disk not listed in manifest"**
- Fix: Add the shard file path to manifest.json.

**"Header regex failed"**
- Fix: The first line must contain `/** THIS FILE DOES: <purpose>, ROLE: <UI|Engine|Data|Automation>, MAINTAINER NOTE: <pitfall> **/`, wrapped in the file type's comment syntax:
  - JS/CSS: as-is
  - HTML: `<!doctype html><!-- ... -->` (doctype stays first or the page enters quirks mode)
  - YAML: `# ...`
  - Markdown: `<!-- ... -->`
  - JSON: `{ "$comment": "...",` (JSON has no comments)

**"Entity fails schema validation"**
- Fix: Check the shard file against `data/schema/entity.v1.schema.json`. Common issues:
  - Missing required field
  - Type mismatch (string vs number)
  - Pattern mismatch (e.g., coordinates not in range, lat/lng format)
  - Country code not 2 letters

### perf-budget.mjs

**"Critical gzip exceeds X KB"**
- Fix: Review the critical modules for unused code, string literals, or large dependencies. The critical set is: HTML, CSS, main.js, core/*, ui/TimelineHUD, ui/InspectorModal, ui/PlainFeedFallback.

**"Slow-3G list visible exceeds X ms"**
- Fix: Check the network waterfall estimate in the output. Usually means:
  - manifest.json is too large (reduce shard count or metadata)
  - Shards are not being loaded in parallel (check main.js fetch logic)
  - CSS/JS modules are large (refactor or split)

### engine.test.mjs

**"SpatialStore failed to load shard"**
- Fix: Ensure the shard file is valid JSON and has the correct schema. Run `validate-shards.mjs --data-only` first.

**"Scrub handler exceeded budget"**
- Fix: setCursor() or setCategories() logic has O(n) iteration that should be cached. Profile with `performance.measure()`.

### smoke-check.html

**"List visible exceeded X ms"**
- Fix: Same as perf-budget.mjs. Check first paint timing and module load order in main.js.

**"Scrub handler p95 exceeded X ms"**
- Fix: The range input handler is doing too much work in the main thread. Batch updates with rAF, avoid DOM thrashing.

**"Console error detected"**
- Fix: Check the browser console. Common issues:
  - Missing data file (404 on manifest or shard)
  - Broken globe.gl import (CDN not available)
  - ReferenceError in main.js or ui modules

## Local Development Tips

- **Module preload testing** — open DevTools > Network, filter to `js`, and watch the load waterfall. Preloaded modules should start immediately.
- **Performance marks** — search console for `ph:` marks to see:
  - `ph:list-visible` — when the first data rows render
  - `ph:scrub` — every time the user scrubs the timeline
- **Metrics exposure** — type `window.__PH__` in console to see `{ store, engine, metrics, ready }`.
- **Killing the globe** — pass `?view=list` to disable the globe for testing the fallback path.

## After Deployment

1. Open the live site: https://username.github.io/humanity-catalog/
2. Spot-check a few papers by clicking rows and opening the inspector
3. Try scrubbing the timeline and toggling categories
4. If on desktop, click "Show 3D globe" and interact with the sphere
5. Check DevTools > Network for any failed requests
6. Check DevTools > Console for any errors or warnings

Done. You're live.

### More globe/timeline pitfalls (found by hands-on testing)

- **wake() re-entry:** `resumeAnimation()` renders a frame synchronously, and that frame's `controls.update()` fires 'change' and calls `wake()` again. Clear the `paused` flag *before* calling `resumeAnimation()`, or it recurses until the stack overflows and nothing redraws (layers and camera moves then only appear once the user touches the globe).
- **htmlElementsData identity:** globe.gl joins HTML items by object identity. Always reuse the same item object per label or marker (`rec.item ??= {…}`) and update positions in place. A fresh object literal each rebuild makes globe.gl add the "new" item and then remove the "old" one, which is the same DOM element, so labels and the ISS marker vanish.
- **Texture size changes:** three.js keeps the GPU texture at its first upload size. When the baked canvas size changes (bundled 1600×800 vs NASA 2048×1024), call `map.dispose()` before `needsUpdate`, or base-map switches silently do nothing.
- **Timeline cursor event:** in Year/Month view the visible set doesn't change while the cursor moves inside one period, so the engine emits only `'cursor'`, not `'change'`. Anything that draws the cursor (the thumb) must listen to `'cursor'`.
- **Testing in a background pane:** a hidden or throttled browser tab runs requestAnimationFrame only a few times per second, so screenshots can be stale. Bring the tab to the front, and check state with JS before trusting a picture.
- **Country clicks:** the hover tint is a polygon mesh, so a click on a hovered country lands on the polygon, not the globe. Both `onGlobeClick` and `onPolygonClick` must route to `handleGlobeClick`.
- **Hover under overlays:** only pointer moves whose target is the WebGL `<canvas>` count as map hover; cards, controls and markers inside the globe container must not tint countries.
- **Worldview Snapshots BBOX is latitude-first** in EPSG:4326 (`south,west,north,east`). Longitude-first requests an invalid latitude, and NASA returns an all-black image. This is locked by `tests/layers.test.mjs`.
- **Smoke test frames sit off-screen,** so `loading="lazy"` images never start there. The test switches detail photos to eager before waiting for them. Checks that hit the network count as "skipped" only when `navigator.onLine` is false; any other error is a failure.
