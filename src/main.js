/** THIS FILE DOES: Boots the app: applies prefs, loads data, wires engine to UI (list/timeline/inspector/theme/filters/country panel/search), then progressively enhances with the globe path, ROLE: UI, MAINTAINER NOTE: window.__PH__ and the ph:list-visible mark are read by the smoke test; keep both exact. CountryPanel.js is lazy-imported on the first globe country click (no globe -> no country click -> never imported); the smoke test reaches it directly via window.__PH__.ui.country instead of clicking a marker (documented at its call site below). SearchPanel.js is lazy-imported on the first search open (button, Cmd/Ctrl+K, or "/"); every call into it or into the globe's search hook is optional-chained so the app still runs if either module lands late or fails to load. **/
import { applyPrefs } from './ui/prefs.js';
import { SpatialStore } from './core/SpatialStore.js';
import { ChronologyEngine } from './core/ChronologyEngine.js';
import { createPlainFeed } from './ui/PlainFeedFallback.js';
import { createTimelineHUD } from './ui/TimelineHUD.js';
import { createInspector } from './ui/InspectorModal.js';
import { createThemeToggle } from './ui/ThemeToggle.js';
import { createFilterPanel } from './ui/FilterPanel.js';

applyPrefs(); // first thing: theme/text/motion must be on <html> before anything paints further

const metrics = { longtasks: [], measures: [], errors: [] };
// Crashes never pass through console.error; record them so tests and maintainers can see them.
addEventListener('error', (e) => metrics.errors.push(String(e.message || e.error)));
addEventListener('unhandledrejection', (e) => metrics.errors.push(String(e.reason)));
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) metrics.longtasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) metrics.measures.push({ name: e.name, duration: e.duration });
  }).observe({ type: 'measure', buffered: true });
} catch {
  // longtask/measure observation unsupported; metrics stay empty, never blocks boot
}

let resolveReady;
const ready = new Promise((res) => { resolveReady = res; });
const ph = { store: null, engine: null, metrics, ready, ui: {} };
window.__PH__ = ph;

const listRoot = document.getElementById('list-root');
const globeRoot = document.getElementById('globe-root');
const hudRoot = document.getElementById('hud-root');
const inspectorRoot = document.getElementById('inspector-root');
const filterRoot = document.getElementById('filter-root');
const countryRoot = document.getElementById('country-root');
const searchRoot = document.getElementById('search-root');
const btnList = document.getElementById('btn-view-list');
const btnGlobe = document.getElementById('btn-view-globe');
const btnSearch = document.getElementById('btn-search');
const btnTheme = document.getElementById('btn-theme');
const btnFilters = document.getElementById('btn-filters');
const filtersBadge = document.getElementById('filters-badge');
const btnLayers = document.getElementById('btn-layers');
const layersBadge = document.getElementById('layers-badge');
const layersRoot = document.getElementById('layers-root');
const btnSettings = document.getElementById('btn-settings');
const topbarEl = document.querySelector('.topbar');

// One surface at a time: opening any registered panel, sheet or card closes every other one, so
// two slide-up sheets (e.g. a paper card plus the country panel) can never be open together.
const surfaces = new Set();
function exclusive(inst) {
  if (!inst || surfaces.has(inst)) return inst;
  surfaces.add(inst);
  const closeOthers = () => { for (const s of surfaces) if (s !== inst && s.isOpen) s.close(); };
  const open = inst.open;
  inst.open = (...args) => { closeOthers(); return open(...args); };
  if (inst.toggle) {
    const toggle = inst.toggle;
    inst.toggle = (...args) => { if (!inst.isOpen) closeOthers(); return toggle(...args); };
  }
  return inst;
}

const inspector = exclusive(createInspector(inspectorRoot));

// Publishes the nav's real height as --nav-h so the list's scroll container (position:absolute,
// top:var(--nav-h)) can start below it -- inset:0 alone ignores a positioned ancestor's own padding
// (the containing block is the padding box), which is what hid the sticky <th> under the nav before.
function updateNavHeight() {
  const h = topbarEl?.getBoundingClientRect().height;
  if (h) document.documentElement.style.setProperty('--nav-h', `${Math.round(h)}px`);
}
updateNavHeight();
if (topbarEl) {
  try {
    new ResizeObserver(updateNavHeight).observe(topbarEl);
  } catch {
    addEventListener('resize', updateNavHeight); // ResizeObserver unsupported: fall back to viewport resize
  }
}

let globeStage = null;
let globeControls = null;
let pointCard = null;
let countryPanel = null;
let countryPanelPromise = null;
let searchPanel = null;
let searchPanelPromise = null;
let settingsPopover = null;
let settingsPopoverPromise = null;
let feed = null;
let countryCounts = new Map(); // iso2 -> catalog-wide paper count, computed once the store loads
let currentView = 'list';
let userChoseView = false; // never yank the list away from someone who already picked a view
// Globe-first boot (flag set pre-paint by index.html): the globe stage + spinner is the landing view
// while globe.gl loads; endGlobeBoot() swaps to the real globe, or back to the list if it can't load.
let globeBooting = document.documentElement.classList.contains('globe-first');
let globeSpinner = null;

function setView(view) {
  currentView = view;
  const showGlobe = view === 'globe' && (globeStage || globeBooting);
  globeRoot.hidden = !showGlobe;
  listRoot.hidden = showGlobe;
  btnList.setAttribute('aria-pressed', String(view === 'list'));
  btnGlobe.setAttribute('aria-pressed', String(showGlobe));
}
btnList.addEventListener('click', () => { userChoseView = true; setView('list'); });
btnGlobe.addEventListener('click', () => {
  if (btnGlobe.getAttribute('aria-disabled') === 'true') {
    pendingOnDemandLoad?.();
    return;
  }
  userChoseView = true;
  setView('globe');
});

if (globeBooting) {
  globeSpinner = Object.assign(document.createElement('div'), { className: 'globe-loading' });
  globeSpinner.setAttribute('role', 'progressbar');
  globeSpinner.setAttribute('aria-label', 'Loading globe');
  globeRoot.append(globeSpinner);
  setView('globe');
  document.documentElement.classList.remove('globe-first'); // hidden attrs now carry the state
}

function endGlobeBoot(ok) {
  if (!globeBooting) return;
  globeBooting = false;
  globeSpinner?.remove();
  globeSpinner = null;
  if (!userChoseView) setView(ok ? 'globe' : 'list');
}

const themeToggle = createThemeToggle(btnTheme, { onChange: (theme) => { globeStage?.setTheme(theme); } });
ph.ui.theme = themeToggle;

let pendingOnDemandLoad = null;
let globeLoadPromise = null;

// Layers: LayerManager/LayersPanel/LayerItemCard/the layer registry are all lazy (never in the
// critical bundle). onLayerItemHandler is set once LayerItemCard exists; GlobeStage is created
// before that (on the first Globe view, which may predate the first Layers click), so the stage's
// onLayerItem option is a thin indirection to whatever handler is installed later.
let layersPromise = null;
let layerManager = null;
let layersPanel = null;
let onLayerItemHandler = null;
let layersCssLoaded = false;

function ensureLayersCss() {
  if (layersCssLoaded) return;
  layersCssLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./ui/layers.css', import.meta.url).href;
  document.head.appendChild(link);
}

function updateLayersBadge() {
  if (!layersBadge || !layerManager) return;
  const state = layerManager.state;
  const anyNonDefaultOn = Object.entries(state).some(([id, s]) => s.on && !DEFAULT_LAYER_IDS.has(id));
  layersBadge.hidden = !anyNonDefaultOn;
}

let DEFAULT_LAYER_IDS = new Set(); // populated once the registry loads: the layer(s) that are "on" by default (e.g. base-classic)

function ensureLayers() {
  if (layersPromise) return layersPromise;
  layersPromise = Promise.all([
    import('./layers/registry.js'),
    import('./ui/LayerManager.js'),
    import('./ui/LayersPanel.js'),
    import('./ui/LayerItemCard.js'),
  ]).then(([{ LAYER_GROUPS, LAYERS }, { createLayerManager }, { createLayersPanel }, { createLayerItemCard }]) => {
    ensureLayersCss();
    const baseLayers = LAYERS.filter((l) => l.group === 'base');
    DEFAULT_LAYER_IDS = new Set(baseLayers.length ? [baseLayers[0].id] : []);
    const layerItemCard = exclusive(createLayerItemCard(globeRoot));
    onLayerItemHandler = (item, pos) => layerItemCard.open(item, pos);
    layerManager = createLayerManager({ layers: LAYERS, groups: LAYER_GROUPS, stage: globeStage, legend: globeControls?.legend });
    layersPanel = exclusive(createLayersPanel(layersRoot, { manager: layerManager, layers: LAYERS, groups: LAYER_GROUPS, button: btnLayers }));
    ph.ui.layers = layerManager;
    ph.ui.layersPanel = layersPanel;
    updateLayersBadge();
    layerManager.on('change', updateLayersBadge);
    return { manager: layerManager, panel: layersPanel };
  }).catch((err) => {
    console.warn('Planet Humanity: layers unavailable', err);
    layersPromise = null;
    return null;
  });
  return layersPromise;
}

// Resolves once the globe stage exists, triggering the same on-demand load path as the Globe
// button if the globe hasn't loaded yet (policy 'on-demand' devices). Resolves null if the globe
// is unavailable on this device (policy 'off') or hasn't started auto-loading yet.
function ensureGlobeLoaded() {
  if (globeStage) return Promise.resolve(globeStage);
  if (globeLoadPromise) return globeLoadPromise;
  if (pendingOnDemandLoad) { pendingOnDemandLoad(); return globeLoadPromise ?? Promise.resolve(null); }
  return Promise.resolve(null);
}

// CountryPanel.js is dynamically imported (never in the critical modulepreload/perf-budget set).
// We idle-import it once right after the list is visible so window.__PH__.ui.country is reachable
// from the list frame alone, allowing the smoke test to verify it without a full globe load.
// Globe country clicks (onCountry, wired in loadGlobe below) reuse this same lazily-created instance.
function ensureCountryPanel(store, engine) {
  if (countryPanel) return Promise.resolve(countryPanel);
  return countryPanelPromise ??= import('./ui/CountryPanel.js').then(({ createCountryPanel }) => {
    countryPanel = createCountryPanel(countryRoot, {
      store, engine,
      onSelectPaper: (entity) => {
        countryPanel.close();
        Promise.resolve(globeStage?.flyTo(entity)).then(() => inspector.open(entity)).catch(() => inspector.open(entity));
      },
      onClose: () => { globeStage?.clearCountry(); },
    });
    exclusive(countryPanel);
    ph.ui.country = countryPanel;
    return countryPanel;
  });
}

// SearchPanel.js is dynamically imported (never in the critical modulepreload/perf-budget set),
// on first open only: button click, Cmd/Ctrl+K, or "/" outside a text field. onResults fans out to
// the globe's marker highlight and the list's row dimming; both calls are optional-chained so
// search still works (minus the highlight) if GlobeStage or PlainFeedFallback haven't landed yet.
function ensureSearchPanel(store) {
  if (searchPanel) return Promise.resolve(searchPanel);
  return searchPanelPromise ??= import('./ui/SearchPanel.js').then(({ createSearchPanel }) => {
    searchPanel = createSearchPanel(searchRoot, {
      store,
      onSelect: (entity) => {
        searchPanel.close();
        Promise.resolve(globeStage?.flyTo(entity)).then(() => inspector.open(entity)).catch(() => inspector.open(entity));
      },
      onResults: (idSet) => {
        globeStage?.setSearchHighlight?.(idSet);
        feed?.setHighlight?.(idSet);
      },
    });
    exclusive(searchPanel);
    ph.ui.search = searchPanel;
    return searchPanel;
  }).catch((err) => {
    console.warn('Planet Humanity: search unavailable', err);
    searchPanelPromise = null; // allow a retry on the next open attempt
    return null;
  });
}

// SettingsPopover.js is owned by GLOBE and already ships statically with GlobeControls.js (the globe
// gear reuses the same module); this is a SEPARATE lazy import for the nav's phone-width gear
// (<=420px, see styles.css), so a user who never opens the globe still doesn't pay for it up front.
function ensureSettingsPopover() {
  if (settingsPopover) return Promise.resolve(settingsPopover);
  return settingsPopoverPromise ??= import('./ui/SettingsPopover.js').then(({ createSettingsPopover }) => {
    settingsPopover = createSettingsPopover(btnSettings, { theme: themeToggle, placement: 'below' });
    return settingsPopover;
  }).catch((err) => {
    console.warn('Planet Humanity: settings popover unavailable', err);
    settingsPopoverPromise = null;
    return null;
  });
}
btnSettings?.addEventListener('click', () => { ensureSettingsPopover().then((p) => p?.toggle()); });

function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

btnSearch.addEventListener('click', () => { if (ph.store) ensureSearchPanel(ph.store).then((p) => p?.toggle()); });

addEventListener('keydown', (e) => {
  if (!ph.store) return; // nothing to search until the catalog has loaded
  const isCombo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
  const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target);
  if (!isCombo && !isSlash) return;
  e.preventDefault();
  ensureSearchPanel(ph.store).then((p) => p?.open());
});

async function boot() {
  let store;
  try {
    store = await SpatialStore.load('data/shards/manifest.json');
  } catch (err) {
    console.warn('Planet Humanity: failed to load data', err);
    listRoot.replaceChildren();
    const p = document.createElement('p');
    p.className = 'skeleton';
    p.textContent = 'Unable to load the catalog right now. Please try again later.';
    listRoot.appendChild(p);
    endGlobeBoot(false); // show the error message instead of an endless globe spinner
    resolveReady();
    return;
  }

  const engine = new ChronologyEngine(store);
  ph.store = store;
  ph.engine = engine;

  feed = createPlainFeed(listRoot, {
    onSelect: (entity) => { inspector.open(entity); globeStage?.flyTo(entity).catch(() => {}); },
  });
  feed.update(engine.visible());
  performance.mark('ph:list-visible');

  countryCounts = new Map();
  for (const e of store.all()) {
    const iso2 = e.institution?.country;
    if (iso2) countryCounts.set(iso2, (countryCounts.get(iso2) ?? 0) + 1);
  }

  createTimelineHUD(hudRoot, engine, { store });

  const idleCountry = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
  idleCountry(() => ensureCountryPanel(store, engine));

  const filterPanel = exclusive(createFilterPanel(filterRoot, { engine, store, button: btnFilters, badge: filtersBadge }));
  ph.ui.filters = filterPanel;
  btnFilters.addEventListener('click', () => filterPanel.toggle());

  // Layers only make sense on the globe: opening the panel loads the globe on demand (same path as
  // the Globe button) if it isn't up yet, switches to the globe view, then opens the panel.
  btnLayers.addEventListener('click', () => {
    ensureGlobeLoaded().then((stage) => {
      if (!stage) return; // globe unavailable on this device (policy 'off') or not ready yet
      userChoseView = true;
      setView('globe');
      ensureLayers().then((res) => res?.panel.toggle());
    });
  });

  engine.on('change', ({ visible, cursor }) => {
    feed.update(visible);
    globeStage?.setPoints(visible, cursor);
  });

  resolveReady();
  enhanceGlobe(store, engine);
}

function enhanceGlobe(store, engine) {
  import('./ui/GlobeStage.js').then(({ globePolicy }) => {
    const policy = globePolicy();
    if (policy === 'off') {
      btnGlobe.setAttribute('aria-disabled', 'true');
      btnGlobe.title = '3D globe unavailable on this device';
      endGlobeBoot(false);
      return;
    }
    if (policy === 'on-demand' && !globeBooting) {
      btnGlobe.setAttribute('aria-disabled', 'true');
      pendingOnDemandLoad = () => { pendingOnDemandLoad = null; globeLoadPromise = loadGlobe(store, engine); };
      return;
    }
    // Globe-first: the globe is the landing view, so load it now rather than at idle.
    if (globeBooting) { globeLoadPromise = loadGlobe(store, engine); return; }
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
    idle(() => { globeLoadPromise = loadGlobe(store, engine); });
  }).catch((err) => {
    console.warn('Planet Humanity: globe module unavailable', err);
    endGlobeBoot(false);
    btnGlobe.setAttribute('aria-disabled', 'true');
    btnGlobe.title = '3D globe unavailable on this device';
  });
}

function loadGlobe(store, engine) {
  return Promise.all([
    import('./ui/GlobeStage.js'),
    import('./ui/GlobeControls.js'),
    import('./ui/PointCard.js'),
  ]).then(([{ createGlobeStage }, { createGlobeControls }, { createPointCard }]) => {
    return createGlobeStage(globeRoot, {
      entities: engine.visible(),
      cursor: engine.cursor,
      theme: themeToggle.theme,
      onSelect: (entity, markerEl) => pointCard?.open(entity, markerEl),
      onCountry: (c) => {
        globeStage?.highlightCountry(c.iso2);
        Promise.resolve(globeStage?.flyToCountry(c)).then(() => ensureCountryPanel(store, engine)).then((panel) => panel.open(c));
      },
      // LayerItemCard doesn't exist until the first Layers click (or an auto-restore below); this
      // indirection lets the stage always have something to call, optional-chained either way.
      onLayerItem: (item, pos) => onLayerItemHandler?.(item, pos),
    }).then((stage) => { return { stage, createGlobeControls, createPointCard }; });
  }).then(({ stage, createGlobeControls, createPointCard }) => {
    globeStage = stage;
    ph.ui.stage = stage;
    stage.setCountryCounts(countryCounts);
    globeControls = createGlobeControls(globeRoot, stage, { theme: themeToggle });
    pointCard = createPointCard(globeRoot, {
      onZoom: (entity) => {
        pointCard.close();
        stage.flyTo(entity).then(() => inspector.open(entity)).catch(() => inspector.open(entity));
      },
      onDetails: (entity) => inspector.open(entity),
    });
    exclusive(pointCard);
    ph.ui.card = pointCard;
    btnGlobe.removeAttribute('aria-disabled');
    btnGlobe.removeAttribute('title');
    if (globeBooting) endGlobeBoot(true);
    else if (!userChoseView) setView('globe');
    // 3G-law-respecting auto-restore: if the user left layers on last time, bring the layers module
    // in now (LayerManager.restore() itself decides, per layer, whether a slow connection means
    // "paused-slow" instead of actually fetching).
    try {
      const saved = JSON.parse(localStorage.getItem('ph:layers') || 'null');
      if (saved?.on?.length) ensureLayers();
    } catch { /* malformed/blocked storage: just skip the auto-restore, manual Layers still works */ }
    return stage;
  }).catch((err) => {
    console.warn('Planet Humanity: globe failed to initialize', err);
    endGlobeBoot(false);
    btnGlobe.setAttribute('aria-disabled', 'true');
    btnGlobe.title = '3D globe unavailable on this device';
    return null;
  });
}

boot();
