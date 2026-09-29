<!-- /** THIS FILE DOES: Project overview, quickstart, repo layout, performance goals, provenance, and license, ROLE: UI, MAINTAINER NOTE: Update repo layout when adding new scripts or data folders **/ -->

# Project World Humanity

A spatial catalog of peer-reviewed medical research breakthroughs, searchable by location and time. Published research from 2024 onwards, indexed by institution, mapped to a 3D globe.

## Quickstart

**Live:** https://username.github.io/humanity-catalog/

**Local:**
```bash
# Serve
python -m http.server 8080
# OR: npx serve

# Run checks
node scripts/validate-shards.mjs && node --test "tests/*.test.mjs" && node scripts/perf-budget.mjs

# Open smoke tests
http://localhost:8080/tests/smoke-check.html
```

## Features (v5)

**Live Data Layers** — Official government / academic data sources only:
- **Layers panel** — Icon button in right nav, glass sidebar with inline filters (base maps, events, space, health, country choropleth)
- **NASA imagery** — Base maps via GIBS WMS: True Color (yesterday from space), Black Marble (night lights), aerosol optical depth (smoke & haze), sea surface temperature
- **Earthquakes** — USGS real-time GeoJSON (magnitude, period filters; 5 min refresh)
- **Earth events** — NASA EONET v3 (wildfires, storms, volcanoes, floods, etc.; category chips, 7/30/90 day filters; 30 min refresh)
- **Aurora forecast** — NOAA SWPC OVATION cells (probability grid texture; Kp index in status; 30 min refresh)
- **Live ISS** — NASA trajectory OEM with local propagation (ECI J2000 → lat/lng); marker + 45 min ground track; fetched every 12 h via GitHub Actions
- **Disease outbreaks** — WHO Disease Outbreak News API (country parsing; 3/6/12 month filters)
- **Clinical trials** — ClinicalTrials.gov API v2 (condition search, max sites 500; one point per site)
- **Health by country** — World Bank WDI (life expectancy, under-5 mortality, health spend %, physicians per 1k; color-blind-safe Viridis choropleth)
- **Trust badges** — "Official · nasa.gov" shield badge on every layer (links to homepage); tests enforce trust rule
- **3G friendly** — All layers OFF by default; slow connections pause (not fetch) paused layers; aborts on toggle off
- **Persistent state** — Layer on/off and filters saved to localStorage, restored on reload (obeying slow connection rule)

**And all v4 features below:**
- **120+ fps render-on-demand globe** — NASA earth-day.jpg with baked-texture country borders (no polygon meshes), pause when idle, wake on interaction, per-frame stats
- **Country borders and labels** — Baked into texture (0 draw calls), interactive hover/click via point-in-polygon picking, LOD-based label visibility (25/70/all), flags in has-papers labels
- **Mesh-free country picking** — onGlobeClick and hover use geojson point-in-polygon with bbox prefilter; only hovered + selected countries in polygon layer (0–2 features)
- **Accurate compass** — computed from camera vectors (never screen projection, which reads stale camera state between frames); north stays up, the needle never jumps
- **Globe legend** — Icon button toggles glass popover listing 10 categories (color dot + label + count), ring meanings (fresh/search/selected), poles, equator
- **Search with highlights** — ⌘K / Ctrl+K / "/" opens Spotlight-style panel; AND-term matching on all fields; yellow `<mark>` highlights; results show snippet from best field; p95 ≤ 5 ms on 10k papers
- **Time-range modes** — "All time" (cumulative, existing), "Year" (calendar year only), "Month" (calendar month); segmented control; canvas shades active period
- **Draggable mobile sheets** — InspectorModal, CountryPanel, PointCard support drag-to-dismiss at ≤ 640 px; detents at 50% and 92% viewport height
- **Country flags** — SVG flags (flag-icons@7.5.0, vendored in assets/flags/) in list, country panel header, inspector, globe labels; respects saveData / 2G
- **Liquid-glass timeline** — v4 thumb with backdrop blur, range-mode support, fixed-width end buttons (no jitter), canvas shows period shading
- **Light and dark modes** — system preference detection, manual toggle, persisted
- **Responsive sidebar** — filter by research category and data source, live count, display prefs (text size, motion)
- **Interactive markers** — accessible HTML layer, 44 px hit targets, category-colored dots, fresh-paper pulsing rings, search highlights
- **Point cards** — quick preview anchored beside markers (mini-sheet ≤ 640 px), zoom-in action, full details drawer
- **Reference photos** — Wikipedia lookup per institution, shown in point cards and details drawer (3G-gated, in-memory cache)
- **On-demand globe loading** — auto-loads on fast networks, button-triggered on 2G/3G, disabled when WebGL unavailable
- **Keyboard navigation** — full access to timeline, globe, search, filter panel, and inspector without mouse
- **Touch-friendly** — 44 px minimum hit targets, glass UI with backdrop blur, safe-area insets, draggable sheets

## Repo Layout

```
humanity-catalog/
├── index.html                     # App entry point, server-rendered skeleton
├── README.md                      # This file
├── data/
│   ├── geo/
│   │   ├── earth-day.jpg          # Textured Earth (NASA natural color, 1600×800, 239 KB)
│   │   └── countries-110m.geojson # Country polygons + labels (generated by build-geo.mjs)
│   ├── flags/
│   │   ├── 4x3/                   # ISO 3166-1 alpha-2 SVG flags (flag-icons@7.5.0, vendored)
│   │   ├── LICENSE.txt            # flag-icons MIT license
│   │   └── README.md              # Fetch instructions
│   ├── live/
│   │   └── iss-oem.json           # NASA ISS OEM ephemeris snapshot (refreshed every 12h)
│   ├── shards/
│   │   ├── manifest.json          # Index of all yearly shard files
│   │   ├── 2024/
│   │   │   └── research_pubmed.json
│   │   ├── 2025/
│   │   │   └── research_pubmed.json
│   │   └── 2026/
│   │       └── research_pubmed.json
│   └── schema/
│       └── entity.v1.schema.json   # JSON Schema for data validation
├── src/
│   ├── main.js                    # Bootstrap: load store → engine → UI
│   ├── styles.css                 # Layout, light/dark theme, responsive, country panel
│   ├── core/
│   │   ├── SpatialStore.js         # Data loading and indexing
│   │   └── ChronologyEngine.js     # Timeline playback and filtering
│   ├── layers/
│   │   ├── registry.js             # Aggregates all layer modules into LAYER_GROUPS + LAYERS
│   │   ├── base-classic.js         # Default bundled Earth texture
│   │   ├── base-today.js           # NASA GIBS today's reflectance WMS
│   │   ├── base-night.js           # NASA GIBS Black Marble night lights
│   │   ├── base-smoke.js           # NASA GIBS aerosol optical depth
│   │   ├── base-sst.js             # NASA GIBS sea surface temperature
│   │   ├── quakes.js               # USGS earthquake GeoJSON
│   │   ├── eonet.js                # NASA EONET events API
│   │   ├── aurora.js               # NOAA aurora forecast texture
│   │   ├── iss.js                  # NASA ISS trajectory object
│   │   ├── iss-propagate.js        # ECI J2000 propagation to lat/lng/alt
│   │   ├── outbreaks.js            # WHO Disease Outbreak News
│   │   ├── trials.js               # ClinicalTrials.gov API v2
│   │   ├── worldbank.js            # World Bank health indicators choropleth
│   │   └── country-geo.js          # Country parsing from names/geojson
│   └── ui/
│       ├── categories.js           # Category metadata and source registry
│       ├── icons.js                # SVG icon factory
│       ├── prefs.js                # Preferences API (theme, text, motion)
│       ├── ThemeToggle.js          # Theme toggle button wiring
│       ├── FilterPanel.js          # Right sidebar (filters, display prefs)
│       ├── TimelineHUD.js          # v4 liquid-glass timeline + range modes
│       ├── InspectorModal.js       # Entity detail drawer
│       ├── PlainFeedFallback.js    # Semantic table (first-paint, fallback)
│       ├── GlobeStage.js           # v4 Render-on-demand textured Earth + baked borders
│       ├── GlobeControls.js        # Zoom/reset/legend/compass overlay
│       ├── Legend.js               # Globe legend popover
│       ├── SearchPanel.js          # Spotlight-style search with highlights
│       ├── PointCard.js            # Glass preview card + reference photo
│       ├── CountryPanel.js         # Right sheet listing papers by country (lazy)
│       ├── RefImage.js             # Wikipedia reference photo frame (lazy)
│       ├── LayerManager.js         # Live data layer state, polling, filtering, persistence
│       ├── LayersPanel.js          # Right glass sidebar with layer controls and inline filters
│       ├── LayerItemCard.js        # Glass card for clicked layer item (title, trust badge, time)
│       ├── SheetGesture.js         # Drag-to-resize/dismiss mobile sheets
│       ├── flags.js                # ISO2 → flag SVG URL/image
│       ├── globe.css               # Globe/marker/country-panel/control styles
│       ├── layers.css              # Layers panel, badges, status text styles
│       ├── search.css              # SearchPanel glass popover styles
│       └── refimage.css            # Reference photo styles
├── tests/
│   ├── budgets.json               # Performance and quality goals
│   ├── engine.test.mjs            # Unit tests (SpatialStore, ChronologyEngine, ranges)
│   ├── search.test.mjs            # Search matching, scoring, highlighting (pure functions)
│   ├── refimage.test.mjs          # Wikipedia relevance rules lock
│   ├── policy.test.mjs            # Globe policy (auto/on-demand/off) lock
│   ├── layers.test.mjs            # Layer trust rule, normalize(), ISS propagation, country parsing
│   ├── fixtures/
│   │   └── layers/                # Recorded layer fixtures for testing (real responses, ≤30 KB each)
│   └── smoke-check.html           # In-browser integration tests (list, globe, layers, performance)
├── scripts/
│   ├── validate-shards.mjs        # Schema and constraint validator
│   ├── perf-budget.mjs            # Gzip size and Slow-3G budget checks
│   ├── build-geo.mjs              # Generate countries-110m.geojson from world-atlas
│   ├── fetch-pubmed.mjs           # Draft entities from PMID list
│   ├── fetch-flags.mjs            # Vendor flag-icons SVGs into assets/flags/4x3/
│   └── fetch-iss.mjs              # Fetch NASA ISS OEM ephemeris, trim window, write data/live/iss-oem.json
├── docs/
│   ├── ARCHITECTURE.md             # System design, module APIs, load strategy, layers system
│   ├── DATA_TAXONOMY.md            # Categories, schema, country codes, bias mitigations
│   └── RUNBOOK.md                  # Operational guide, troubleshooting, recipes, layer recipes
└── .github/
    ├── workflows/
    │   ├── validate.yml            # PR + push: run checks
    │   ├── deploy.yml              # Push to main: run checks + deploy to Pages
    │   └── live-data.yml           # Every 12h: refresh ISS OEM ephemeris from NASA S3
    └── ISSUE_TEMPLATE/
        └── submission.yml          # Form for new paper submissions
```

## Performance Goals

- **First paint** ≤ 2.5 s (Slow 3G, rural worst case)
- **List visible** ≤ 1 s (interactive list of research papers)
- **Scrub handler (p95)** ≤ 10 ms (timeline scrubbing is smooth)
- **Autoplay avg FPS** ≥ 55 (animations are fluid)
- **Critical gzip** ≤ 40 KB (HTML + CSS + main.js + core modules)
- **Data gzip** ≤ 40 KB (all shards combined)
- **No long tasks during interaction** (no main-thread blocking)

The app degrades gracefully on slow networks: the list view works on 2G; the globe is on-demand or disabled.

See `tests/budgets.json` for the full network profile and `docs/RUNBOOK.md` for performance measurement.

## Data Provenance

**Source:** PubMed Central, indexed 2024 onwards  
**Categories:** 10 research fields (genomics, oncology, neuroscience, etc.)  
**Coverage:** Peer-reviewed articles only, with geographic diversity across institutions  
**Validation:** Every entry is confirmed against PubMed; retracted papers are excluded  

**Coordinates:** Institution centroid (city-level resolution, ±1.1 km)  
**Dates:** Publication date (PubMed pubdate) in UTC  
**Summaries:** Original plain-language explanations (never copyrighted abstracts)  

## License

- **Code:** MIT License
- **Data facts** (titles, dates, IDs, coordinates): Public domain (PubMed facts)
- **Original summaries:** Rights retained by catalog maintainers (CC-BY implied)
- **External identifiers** (DOI, PMID, PMCID, journal titles): © their respective publishers; used for reference only

## Architecture & Development

This is a **pure static site**, no build step, no npm at dev time. Read `docs/ARCHITECTURE.md` for:
- Module map and public APIs
- State loop diagram
- Loading strategy (progressive enhancement)
- WebGL lifecycle
- Why no framework or bundler

## Contributing

**To add a paper:** Open a [GitHub issue](../../issues/new?template=submission.yml) with the PubMed ID and summary.  
**To report a bug:** File an issue with steps to reproduce.  
**To improve docs:** Submit a pull request.  

See `docs/DATA_TAXONOMY.md` for the full submission workflow and `docs/RUNBOOK.md` for operations.

---

Last updated: 2026-09-25; v5 release
