/** THIS FILE DOES: Progressive-enhancement 3D globe view (baked-texture country borders, mesh-free country picking, render-on-demand, compass, live-themeable, accessible HTML markers) backed by lazy-loaded globe.gl, ROLE: UI, MAINTAINER NOTE: The only file allowed to reference CDN URLs; when bumping globe.gl, recompute GLOBE_GL_SRI or the browser will refuse the script. Country borders are baked into the globe texture in idle time, never drawn as polygon meshes. **/
import { CATEGORY_META } from './categories.js';
import { parseUtcDate } from '../core/SpatialStore.js';
import { flagUrl } from './flags.js';
// eventIcons.js is loaded only when the first icon layer (e.g. Natural events) turns on, so its
// glyph code never counts against the globe's own download (see perf-budget globeLocalGzipMax).
let eventIconsPromise = null;
let eventIcon = null;
function loadEventIcons() {
  return eventIconsPromise ??= import('./eventIcons.js').then((m) => { eventIcon = m.eventIcon; });
}

// UMD bundle, not +esm: the +esm build pulls several Three.js copies (warnings + crashes).
const GLOBE_GL_URL = 'https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js';
const GLOBE_GL_SRI = 'sha384-1uolMBZ25k3zJcNwCLEv49+L+m2dZudqAzsoSAJfQTzDCSBxJzrMuZ2dkp/5JKiT';
// globe.gl (~0.5 MB) + earth-day.jpg texture (0.24 MB) + countries-110m.geojson (~55 KB gzip on the wire).
export const GLOBE_DOWNLOAD_LABEL = '~0.8 MB';

const GLOBE_CSS_HREF = 'src/ui/globe.css';
const COUNTRIES_GEOJSON_URL = 'data/geo/countries-110m.geojson';
const EARTH_TEXTURE_URL = 'data/geo/earth-day.jpg';
const DEFAULT_COLOR = '#8E8E93';
const FRESH_MS = 30 * 24 * 60 * 60 * 1000; // "new since" window shown as a pulsing ring
const DEFAULT_VIEW = { lat: 20, lng: 10, altitude: 2.2 };
const MIN_ALTITUDE = 0.25;
const MAX_ALTITUDE = 4;
const HOVER_TINT = 'rgba(255,255,255,0.18)';
const SELECT_TINT = 'rgba(10,132,255,0.28)';
const CAP_TRANSPARENT = 'rgba(0,0,0,0)';
const LOD_SMALL = 25; // altitude > 1.6
const LOD_MEDIUM = 70; // altitude 0.9-1.6
const LABEL_CAP = 60; // hard ceiling on rendered CSS2D country labels, regardless of LOD bucket
const WAKE_DEFAULT_MS = 600;
const WAKE_POINTS_MS = WAKE_DEFAULT_MS + 400; // extra time for pop-in + repositioned markers to actually render
const DRAG_FRAME_P95_THRESHOLD_MS = 6;
const DRAG_PIXEL_RATIO_MAX = 1.5;
const MAX_LAYER_ICONS = 400; // per layer; oldest trimmed first when a layer hands us more

// Theme-aware color palettes: matte globe body (texture stays the same in both themes) + border/atmosphere.
const PALETTES = {
  light: { stroke: 'rgba(20,20,22,0.55)', atmosphere: '#9CC9F5' },
  dark: { stroke: 'rgba(255,255,255,0.45)', atmosphere: '#3A7BD5' },
};

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

export function globePolicy({ search = location.search, connection = navigator.connection, webgl = hasWebGL() } = {}) {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  if (view === 'list') return 'off';
  if (!webgl) return 'off';
  if (view === 'globe') return 'auto';
  const type = connection?.effectiveType;
  if (connection?.saveData || ['slow-2g', '2g', '3g'].includes(type)) return 'on-demand';
  return 'auto';
}

let globeLibPromise;
function loadGlobeLib() {
  return globeLibPromise ??= new Promise((resolve, reject) => {
    if (globalThis.Globe) return resolve(globalThis.Globe);
    const s = Object.assign(document.createElement('script'), { src: GLOBE_GL_URL, integrity: GLOBE_GL_SRI, crossOrigin: 'anonymous', async: true });
    s.onload = () => globalThis.Globe ? resolve(globalThis.Globe) : reject(new Error('globe.gl loaded without window.Globe'));
    s.onerror = () => { globeLibPromise = undefined; s.remove(); reject(new Error('globe.gl failed to load')); };
    document.head.append(s);
  });
}

let countriesGeoPromise;
function loadCountriesGeo() {
  return countriesGeoPromise ??= fetch(COUNTRIES_GEOJSON_URL).then((res) => {
    if (!res.ok) throw new Error(`countries geojson fetch failed: ${res.status}`);
    return res.json();
  });
}

let cssPromise;
function loadStylesheet() {
  return cssPromise ??= new Promise((resolve) => {
    if (document.querySelector(`link[href="${GLOBE_CSS_HREF}"]`)) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = GLOBE_CSS_HREF;
    // Fail-open: an unstyled globe is still usable, so never block the stage on a CSS 404.
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.append(link);
  });
}

function reducedMotion() {
  return document.documentElement.getAttribute('data-motion') === 'reduce';
}

function equatorPath() {
  const pts = [];
  for (let i = 0; i <= 360; i++) pts.push([0, -180 + i]); // [lat, lng]
  return { pts };
}

const idleSchedule = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));

// --- Country geometry helpers: ray-casting point-in-polygon with a bbox prefilter, used by both
// the border bake (drawing) and click/hover picking (testing). No THREE mesh is ever created for
// countries; a polygon "hit" is plain 2D math against the same GeoJSON already on hand. ---

function forEachRing(feature, cb) {
  const g = feature.geometry;
  if (!g) return;
  if (g.type === 'Polygon') { for (const ring of g.coordinates) cb(ring); }
  else if (g.type === 'MultiPolygon') { for (const poly of g.coordinates) for (const ring of poly) cb(ring); }
}

function computeBbox(feature) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  forEachRing(feature, (ring) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  });
  return { minLng, maxLng, minLat, maxLat };
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const crosses = (yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function ringsHit(lng, lat, rings) {
  // rings[0] is the outer boundary, any further rings are holes to subtract.
  if (!pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(lng, lat, rings[i])) return false;
  return true;
}

function pointInFeature(lng, lat, feature) {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === 'Polygon') return ringsHit(lng, lat, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some((poly) => ringsHit(lng, lat, poly));
  return false;
}

// Split a ring into segments wherever consecutive points jump by more than 180deg of longitude,
// so a country that straddles the antimeridian (e.g. Fiji, Russia) doesn't get a stroke drawn
// clear across the baked texture.
function ringSegments(ring) {
  const segments = [];
  let current = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const prevLng = ring[i - 1][0], lng = ring[i][0];
    if (Math.abs(lng - prevLng) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(ring[i]);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function objectGlyph() {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const svg = el('svg', { viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true' });
  svg.append(
    el('rect', { x: '2', y: '10', width: '5', height: '4', rx: '0.5', fill: 'currentColor', opacity: '0.7' }),
    el('rect', { x: '17', y: '10', width: '5', height: '4', rx: '0.5', fill: 'currentColor', opacity: '0.7' }),
    el('rect', { x: '9', y: '9', width: '6', height: '6', rx: '1', fill: 'currentColor' }),
    el('line', { x1: '7', y1: '12', x2: '9', y2: '12', stroke: 'currentColor', 'stroke-width': '1' }),
    el('line', { x1: '15', y1: '12', x2: '17', y2: '12', stroke: 'currentColor', 'stroke-width': '1' }),
  );
  return svg;
}

export async function createGlobeStage(container, { entities = [], cursor = Infinity, theme = 'light', onSelect, onCountry, onLayerItem } = {}) {
  const [Globe, , countriesGeo] = await Promise.all([loadGlobeLib(), loadStylesheet(), loadCountriesGeo()]);

  let currentCursor = cursor;
  const markerCache = new Map(); // entity id -> { el, dot, entity, isNew }
  const viewListeners = new Set();
  let rafViewPending = false;
  let countryCounts = new Map(); // iso2 -> count
  let hoveredFeature = null;
  let selectedFeature = null;
  let lodBucket = null; // 'small' | 'medium' | 'all', recomputed on view change
  let labelRafPending = false;
  let isDragging = false;
  let hoverRafPending = false;
  let currentTheme = theme;
  const layerPointsMap = new Map(); // layerId -> items[]
  const layerIconsMap = new Map(); // layerId -> Map<id, { entry, el, item }>
  const objectLayers = new Map(); // layerId -> { data, markers: Map<id, {el,lat,lng,o}>, timer }
  let hoveredLayerItem = null;
  const HOVER_PICK_PX = 14;
  const PREFILTER_DEG = 6; // cheap lat/lng box before the precise getScreenCoords check

  const countryFeatures = (countriesGeo.features ?? []).slice().sort((a, b) => (b.properties.area ?? 0) - (a.properties.area ?? 0));
  for (const f of countryFeatures) f._bbox = computeBbox(f); // once, reused by every click/hover pick

  function pickCountryAt(lat, lng) {
    for (const f of countryFeatures) {
      const b = f._bbox;
      if (lng < b.minLng - 0.25 || lng > b.maxLng + 0.25 || lat < b.minLat - 0.25 || lat > b.maxLat + 0.25) continue;
      if (pointInFeature(lng, lat, f)) return f;
    }
    return null;
  }

  // Non-country HTML layer items: poles + equator label. Static for the stage lifetime.
  const poleItems = [
    { kind: 'pole', lat: 90, lng: 0, label: 'N' },
    { kind: 'pole', lat: -90, lng: 0, label: 'S' },
  ].map((d) => ({ ...d, el: buildPoleEl(d) }));
  const equatorLabelItem = { kind: 'equator-label', lat: 0, lng: 0, el: buildEquatorLabelEl() };

  function buildPoleEl(d) {
    const el = document.createElement('div');
    el.className = 'ph-pole';
    el.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('span');
    dot.className = 'ph-pole-dot';
    const cap = document.createElement('span');
    cap.className = 'ph-pole-caption';
    cap.textContent = d.label;
    el.append(dot, cap);
    return el;
  }

  function buildEquatorLabelEl() {
    const el = document.createElement('span');
    el.className = 'ph-equator-label';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = 'Equator';
    return el;
  }

  // --- Layer item picking + hover tooltip: mesh-free, like country picking. Points from every
  // layer share one merged mesh (pointsMerge(true)), so hit-testing walks the plain item lists,
  // pre-filtered by a lat/lng degree box, then confirmed on screen with getScreenCoords. ---
  function pickLayerItemAt(x, y) {
    if (!layerPointsMap.size) return null;
    const g = instance.toGlobeCoords?.(x, y);
    if (!g) return null;
    let best = null, bestDist = HOVER_PICK_PX;
    for (const items of layerPointsMap.values()) {
      for (const it of items) {
        if (Math.abs(it.lat - g.lat) > PREFILTER_DEG || Math.abs(it.lng - g.lng) > PREFILTER_DEG) continue;
        const sc = instance.getScreenCoords?.(it.lat, it.lng, 0.006);
        if (!sc) continue;
        const dist = Math.hypot(sc.x - x, sc.y - y);
        if (dist <= bestDist) { bestDist = dist; best = it; }
      }
    }
    return best;
  }

  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'ph-layer-tooltip';
  tooltipEl.setAttribute('aria-hidden', 'true');
  tooltipEl.hidden = true;
  function showTooltip(item, x, y) {
    tooltipEl.replaceChildren();
    const title = document.createElement('div');
    title.className = 'ph-layer-tooltip-title';
    title.textContent = item.title ?? '';
    tooltipEl.append(title);
    if (item.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'ph-layer-tooltip-sub';
      sub.textContent = item.subtitle;
      tooltipEl.append(sub);
    }
    tooltipEl.style.transform = `translate3d(${x + 14}px, ${y - 10}px, 0)`;
    tooltipEl.hidden = false;
  }
  function hideTooltip() {
    tooltipEl.hidden = true;
  }

  function buildCountryLabelEl(feature) {
    const el = document.createElement('span');
    el.className = 'ph-country-label';
    el.setAttribute('aria-hidden', 'true');
    el.dataset.iso2 = feature.properties.iso2 ?? '';
    return el;
  }

  const countryLabelCache = new Map(); // iso2-or-name -> { feature, el }
  function countryLabelKey(f) { return f.properties.iso2 ?? f.properties.name; }
  function countryLabelEntry(f) {
    const key = countryLabelKey(f);
    let rec = countryLabelCache.get(key);
    if (!rec) {
      rec = { feature: f, el: buildCountryLabelEl(f) };
      countryLabelCache.set(key, rec);
    }
    return rec;
  }

  function decorateCountryLabel(rec) {
    const iso2 = rec.feature.properties.iso2;
    const count = iso2 ? countryCounts.get(iso2) ?? 0 : 0;
    const hasPapers = count > 0;
    rec.el.classList.toggle('has-papers', hasPapers);
    rec.el.replaceChildren();
    if (!hasPapers) {
      rec.el.append(document.createTextNode(rec.feature.properties.name));
      return;
    }
    // has-papers labels lead with a small flag instead of the "· ZA ·" code text.
    const url = iso2 ? flagUrl(iso2) : null;
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 16;
      img.height = 12;
      img.alt = '';
      img.className = 'ph-country-flag';
      rec.el.append(img);
    }
    rec.el.append(document.createTextNode(`${url ? ' ' : ''}${rec.feature.properties.name} `));
    const pill = document.createElement('span');
    pill.className = 'ph-country-count-pill';
    const pillText = count === 1 ? '1 paper' : `${count} papers`;
    pill.textContent = pillText;
    pill.title = pillText;
    rec.el.append(pill);
  }

  // Click priority: research markers are separate DOM elements and never reach this handler
  // (they own their own click listeners); layer items (mesh-free pick) beat countries.
  function handleGlobeClick(lat, lng, event) {
    // A click on a research dot, event icon, card or control bubbles up to globe.gl's listener on
    // this container, which raycasts straight through to the country underneath. Only clicks that
    // landed on the WebGL canvas itself count as "the user clicked the map/country".
    if (event?.target && event.target.tagName !== 'CANVAS') return;
    const rect = container.getBoundingClientRect();
    const x = (event?.clientX ?? 0) - rect.left, y = (event?.clientY ?? 0) - rect.top;
    const item = pickLayerItemAt(x, y);
    if (item) { onLayerItem?.(item, { x, y }); return; }
    const f = pickCountryAt(lat, lng);
    if (!f) return; // ocean click: leave the current selection alone
    selectedFeature = f;
    refreshPolygons();
    const p = f.properties;
    onCountry?.({ iso2: p.iso2, name: p.name, lat: p.labelLat, lng: p.labelLng });
  }

  function lodBucketFor(altitude) {
    if (altitude > 1.6) return 'small';
    if (altitude >= 0.9) return 'medium';
    return 'all';
  }

  function visibleCountryLabelRecords(bucket) {
    const fillerLimit = bucket === 'small' ? LOD_SMALL : bucket === 'medium' ? LOD_MEDIUM : Infinity;
    const included = new Set();
    const out = [];
    // Countries with papers always win a label slot first; only the leftover budget (up to the
    // 60-label hard cap) goes to plain by-area filler labels.
    for (const f of countryFeatures) {
      if (out.length >= LABEL_CAP) break;
      const iso2 = f.properties.iso2;
      if (iso2 && (countryCounts.get(iso2) ?? 0) > 0) {
        included.add(f);
        out.push(countryLabelEntry(f));
      }
    }
    let added = 0;
    for (const f of countryFeatures) {
      if (out.length >= LABEL_CAP || added >= fillerLimit) break;
      if (included.has(f)) continue;
      out.push(countryLabelEntry(f));
      added++;
    }
    return out;
  }

  function rebuildHtmlLayer() {
    const labelRecs = visibleCountryLabelRecords(lodBucket ?? 'small');
    for (const rec of labelRecs) decorateCountryLabel(rec);
    const markers = [...markerCache.values()];
    const items = [
      ...markers,
      // Stable item objects per label: globe.gl joins data by object identity, so a fresh literal
      // each rebuild made it add the "new" item then remove the "old" one - the SAME DOM element -
      // and every country label vanished after the first rebuild.
      ...labelRecs.map((rec) => (rec.item ??= { kind: 'country-label', lat: rec.feature.properties.labelLat, lng: rec.feature.properties.labelLng, el: rec.el })),
      ...objectMarkerItems(),
      ...layerIconItems(),
      ...poleItems,
      equatorLabelItem,
    ];
    instance.htmlElementsData(items);
  }

  // --- Layer icons (event markers: wildfires, storms, quakes...): HTML elements in the same
  // htmlElementsData layer as markers/labels, cached per layerId+id with a stable item object so
  // globe.gl's identity-join never treats an in-place update as remove-then-add (see labels above). ---
  function buildEventIconEl(rec) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ph-event-icon';
    const chip = document.createElement('span');
    chip.className = 'ph-event-icon-chip';
    el.appendChild(chip);
    const cap = document.createElement('span');
    cap.className = 'ph-event-icon-label';
    el.appendChild(cap);
    const emit = () => {
      const r = el.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      onLayerItem?.(rec.entry, { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top });
    };
    el.addEventListener('click', emit);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); emit(); } });
    return el;
  }

  function decorateEventIconEl(rec) {
    const entry = rec.entry;
    rec.el.setAttribute('aria-label', entry.title ?? '');
    const chip = rec.el.firstChild;
    chip.style.setProperty('--chip-color', entry.color ?? DEFAULT_COLOR);
    chip.replaceChildren(eventIcon(entry.icon));
    const cap = rec.el.lastChild;
    if (entry.showLabel && entry.label) {
      cap.textContent = entry.label;
      cap.hidden = false;
    } else {
      cap.textContent = '';
      cap.hidden = true;
    }
  }

  function setLayerIcons(layerId, items) {
    if (items?.length && !eventIcon) { loadEventIcons().then(() => setLayerIcons(layerId, items)); return; }
    let cache = layerIconsMap.get(layerId);
    if (!items?.length) {
      if (cache) {
        for (const rec of cache.values()) rec.el.remove();
        layerIconsMap.delete(layerId);
      }
      rebuildHtmlLayer();
      wake(WAKE_POINTS_MS);
      return;
    }
    if (!cache) {
      cache = new Map();
      layerIconsMap.set(layerId, cache);
    }
    // Keep the newest MAX_LAYER_ICONS: layers hand items oldest-first, so the tail is newest.
    const capped = items.length > MAX_LAYER_ICONS ? items.slice(-MAX_LAYER_ICONS) : items;
    const seen = new Set();
    for (const it of capped) {
      seen.add(it.id);
      let rec = cache.get(it.id);
      if (!rec) {
        rec = { entry: it, el: null, item: null };
        rec.el = buildEventIconEl(rec);
        rec.item = { kind: 'layer-icon', lat: it.lat, lng: it.lng, el: rec.el };
        cache.set(it.id, rec);
      } else {
        rec.entry = it;
      }
      rec.item.lat = it.lat;
      rec.item.lng = it.lng;
      decorateEventIconEl(rec);
    }
    for (const [id, rec] of cache) {
      if (!seen.has(id)) { rec.el.remove(); cache.delete(id); }
    }
    rebuildHtmlLayer();
    wake(WAKE_POINTS_MS);
  }

  function layerIconItems() {
    const out = [];
    for (const cache of layerIconsMap.values()) for (const rec of cache.values()) out.push(rec.item);
    return out;
  }

  function objectMarkerItems() {
    const out = [];
    for (const rec of objectLayers.values()) {
      for (const m of rec.markers.values()) {
        // Same identity rule as labels: one stable item per object, position updated in place.
        m.item ??= { kind: 'object-marker', el: m.el };
        m.item.lat = m.lat; m.item.lng = m.lng;
        out.push(m.item);
      }
    }
    return out;
  }

  function currentPolygons() {
    // At most the hovered + selected country ever sit in polygonsData: everything else is baked
    // into the texture, so there are zero permanent polygon meshes.
    const out = [];
    if (hoveredFeature) out.push(hoveredFeature);
    if (selectedFeature && selectedFeature !== hoveredFeature) out.push(selectedFeature);
    return out;
  }

  function refreshPolygons() {
    instance.polygonsData(currentPolygons());
  }

  const instance = Globe()(container)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereAltitude(0.15)
    .globeImageUrl(EARTH_TEXTURE_URL)
    .polygonsData([])
    .polygonAltitude(0.003)
    .polygonCapColor((f) => f === selectedFeature ? SELECT_TINT : f === hoveredFeature ? HOVER_TINT : CAP_TRANSPARENT)
    .polygonSideColor(() => CAP_TRANSPARENT)
    .polygonStrokeColor(() => CAP_TRANSPARENT) // borders are baked into the texture; no stroke mesh at all
    .polygonsTransitionDuration(0)
    .onGlobeClick(({ lat, lng }, event) => handleGlobeClick(lat, lng, event))
    // The hover tint IS a polygon mesh sitting on the hovered country, so a click there lands on
    // the polygon, not the globe. Without this handler, clicking any hovered country did nothing.
    .onPolygonClick((_f, event, coords) => {
      const c = coords ?? instance.toGlobeCoords?.(event.clientX - container.getBoundingClientRect().left, event.clientY - container.getBoundingClientRect().top);
      if (c) handleGlobeClick(c.lat, c.lng, event);
    })
    // All point layers (quakes, EONET, trials, outbreaks, ...) merge into this one mesh
    // (pointsMerge(true)): rebuilt only when a layer's items actually change, never per frame.
    // Picking is mesh-free (see pickLayerItemAt), matching the country-picking approach.
    .pointsData([])
    .pointLat('lat')
    .pointLng('lng')
    .pointColor((d) => d.color ?? DEFAULT_COLOR)
    // Sized to read at a glance on a phone: ~0.45-1.35 deg across (earlier 0.2-0.8 deg looked like specks).
    .pointRadius((d) => 0.45 + Math.max(0, Math.min(1, d.size ?? 0.5)) * 0.9)
    .pointAltitude(0.01)
    .pointsMerge(true)
    .pointsTransitionDuration(0)
    // The equator plus every "objects" layer's ground track (e.g. ISS) share this one paths
    // layer; per-path accessors below key off each path datum's `kind`.
    .pathsData([equatorPath()])
    .pathPoints('pts')
    .pathPointLat((p) => p[0])
    .pathPointLng((p) => p[1])
    .pathColor((d) => d.kind === 'object-track' ? (d.color ?? 'rgba(255,255,255,0.85)') : 'rgba(255,214,10,0.8)')
    .pathStroke((d) => d.kind === 'object-track' ? 1.4 : 1)
    .pathDashLength((d) => d.kind === 'object-track' ? 0.35 : 0.02)
    .pathDashGap((d) => d.kind === 'object-track' ? 0.2 : 0.01)
    .pathTransitionDuration(0)
    .htmlElementsData([])
    .htmlLat((d) => d.lat)
    .htmlLng((d) => d.lng)
    .htmlAltitude(0.012)
    .htmlElement((d) => d.el)
    .htmlElementVisibilityModifier((el, isVisible) => el.classList.toggle('ph-hidden', !isVisible))
    .htmlTransitionDuration(0);

  instance.pointOfView(DEFAULT_VIEW, 0);
  lodBucket = lodBucketFor(DEFAULT_VIEW.altitude);

  const renderer = instance.renderer?.();
  if (renderer) renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  // --- stats(): wrap the one THREE.WebGLRenderer.render call so tests (and us) can see actual
  // render throughput without instrumenting globe.gl itself. CSS2D label placement piggybacks on
  // the same rAF tick globe.gl already drives, so gating renders also gates that DOM work. ---
  let renderCount = 0;
  let frameTimes = [];
  if (renderer) {
    const originalRender = renderer.render.bind(renderer);
    renderer.render = (...args) => {
      const t0 = performance.now();
      const result = originalRender(...args);
      const dt = performance.now() - t0;
      frameTimes.push(dt);
      if (frameTimes.length > 120) frameTimes.shift();
      renderCount++;
      // Programmatic moves (flyTo, zoom, reset, setView) tween the camera without OrbitControls
      // 'change' events, so the compass/LOD never heard about them. Any drawn frame whose camera
      // moved reports a view change (rAF-throttled via the same path as user drags).
      const p = args[1]?.position;
      if (p && (p.x !== lastCam.x || p.y !== lastCam.y || p.z !== lastCam.z)) {
        lastCam.x = p.x; lastCam.y = p.y; lastCam.z = p.z;
        if (!rafViewPending) { rafViewPending = true; requestAnimationFrame(emitViewChange); }
      }
      return result;
    };
  }
  const lastCam = { x: NaN, y: NaN, z: NaN };
  function frameP95() {
    if (!frameTimes.length) return 0;
    const sorted = frameTimes.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }

  // --- Render on demand: the loop pauses after `ms` of quiet and wakes on any interaction or
  // programmatic move. OrbitControls damping keeps firing 'change' after pointerup, so the loop
  // naturally keeps running until the motion actually settles. ---
  let paused = false;
  let idleTimer = null;
  function pause() {
    if (paused) return;
    instance.pauseAnimation?.();
    paused = true;
  }
  function wake(ms = WAKE_DEFAULT_MS) {
    if (paused) {
      // Clear the flag BEFORE resuming: resumeAnimation() runs a frame synchronously, whose
      // controls.update() emits 'change' -> onControlsChange -> wake(). With the flag still set that
      // re-entered resumeAnimation forever (stack overflow), so the frame never drew and layer or
      // view changes only appeared after the user touched the globe.
      paused = false;
      instance.resumeAnimation?.();
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(pause, ms);
  }
  function stats() {
    return { renders: renderCount, frameP95Ms: frameP95(), paused, bakeMs };
  }

  let dragLoweredRatio = false;
  function onDragStart() {
    isDragging = true;
    container.classList.add('ph-dragging');
    wake();
    if (renderer && frameP95() > DRAG_FRAME_P95_THRESHOLD_MS) {
      dragLoweredRatio = true;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DRAG_PIXEL_RATIO_MAX));
    }
  }
  let labelRestoreTimer = null;
  function onDragEnd() {
    isDragging = false;
    wake();
    clearTimeout(labelRestoreTimer);
    labelRestoreTimer = setTimeout(() => container.classList.remove('ph-dragging'), 150);
    if (dragLoweredRatio && renderer) {
      dragLoweredRatio = false;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    }
  }

  const ro = new ResizeObserver(() => {
    instance.width(container.clientWidth);
    instance.height(container.clientHeight);
    wake();
  });
  ro.observe(container);
  instance.width(container.clientWidth);
  instance.height(container.clientHeight);

  function onVisibility() {
    if (document.hidden) instance.pauseAnimation?.();
    else instance.resumeAnimation?.();
  }
  document.addEventListener('visibilitychange', onVisibility);

  const controls = instance.controls?.();
  function emitViewChange() {
    rafViewPending = false;
    const view = getView();
    for (const fn of viewListeners) fn(view);
    const bucket = lodBucketFor(view.altitude);
    if (bucket !== lodBucket) {
      lodBucket = bucket;
      scheduleHtmlLayerRebuild();
    }
  }
  function onControlsChange() {
    wake();
    if (rafViewPending) return;
    rafViewPending = true;
    requestAnimationFrame(emitViewChange);
  }
  controls?.addEventListener?.('start', onDragStart);
  controls?.addEventListener?.('change', onControlsChange);
  controls?.addEventListener?.('end', onDragEnd);

  function onContainerWake() { wake(); }
  container.addEventListener('wheel', onContainerWake, { passive: true });
  container.addEventListener('pointerdown', onContainerWake);

  function updateHoverAt(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const item = pickLayerItemAt(x, y);
    if (item) {
      if (hoveredFeature) { hoveredFeature = null; refreshPolygons(); }
      hoveredLayerItem = item;
      showTooltip(item, x, y);
      container.style.cursor = 'pointer';
      return;
    }
    if (hoveredLayerItem) { hoveredLayerItem = null; hideTooltip(); }
    const coords = instance.toGlobeCoords?.(x, y);
    const f = coords ? pickCountryAt(coords.lat, coords.lng) : null;
    if (f === hoveredFeature) return;
    hoveredFeature = f;
    refreshPolygons();
    container.style.cursor = f ? 'pointer' : '';
  }
  function onPointerMove(ev) {
    wake();
    // Only the WebGL canvas itself counts as "over the map". Cards, controls, markers and tooltips
    // float inside this container too; hovering them (e.g. "View official record") must not keep
    // tinting the country underneath.
    if (ev.target?.tagName !== 'CANVAS') {
      if (hoveredFeature) { hoveredFeature = null; refreshPolygons(); }
      if (hoveredLayerItem) { hoveredLayerItem = null; hideTooltip(); }
      container.style.cursor = '';
      return;
    }
    if (isDragging || hoverRafPending) return;
    hoverRafPending = true;
    const { clientX, clientY } = ev;
    requestAnimationFrame(() => { hoverRafPending = false; updateHoverAt(clientX, clientY); });
  }
  container.addEventListener('pointermove', onPointerMove);
  container.appendChild(tooltipEl);

  function scheduleHtmlLayerRebuild() {
    if (labelRafPending) return;
    labelRafPending = true;
    requestAnimationFrame(() => { labelRafPending = false; rebuildHtmlLayer(); });
  }

  // --- Texture compositor: base image -> country fill -> texture overlays -> borders, baked onto
  // one canvas in idle time and handed to THREE as the globe's texture image. This replaces ~177
  // polygon cap meshes + stroke lines with zero permanent meshes; the 0-2 entries in polygonsData
  // above only ever cover the hovered/selected country.
  //
  // Caching: the base image draw and the (expensive, ~177-country ring walk) border stroke pass
  // live on two SEPARATE cached canvases (baseCanvas, bordersCanvas), each only rebuilt when its
  // own input actually changes (a new base image, or a theme change). Every setCountryFill /
  // setTextureOverlay call reuses both caches and only redoes the cheap part: blit base, paint
  // fills + overlay cells, blit the borders canvas on top. That keeps the compositor's real order
  // (base, fill, overlays, borders on top of everything) while still making fill/overlay changes
  // cheap to repaint, per the "cache the base+borders canvas" guidance. ---
  let earthImgPromise;
  function loadEarthImage() {
    return earthImgPromise ??= new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = EARTH_TEXTURE_URL;
    });
  }

  let customBaseImage = null; // HTMLImageElement | null, set via setBaseImage
  let baseCanvas = null; // cached: base image only
  let bordersCanvas = null; // cached: transparent canvas, stroked country rings only
  let bakedCanvas = null; // final composite, rebuilt every bake
  let uploadedSize = '1600x800'; // the bundled earth-day.jpg globe.gl uploads first
  let countryFillMap = null; // Map<iso2, cssColor> | null
  const textureOverlays = new Map(); // id -> { cells, color } | absent
  let dirtyBaseImage = true;
  let dirtyBorders = true;
  let bakePending = false;
  let bakeMs = 0;

  function strokeSegment(ctx, seg, w, h) {
    ctx.beginPath();
    seg.forEach(([lng, lat], i) => {
      const x = (lng + 180) / 360 * w;
      const y = (90 - lat) / 180 * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Fills the country's polygon(s) at the caller's current fillStyle/globalAlpha. Antimeridian
  // splitting (see ringSegments, used for the border stroke) is intentionally skipped here: an
  // unsplit fill on the handful of countries that cross the dateline (Russia, Fiji, ...) can show
  // a minor seam, an acceptable tradeoff to keep the common-case fill path simple and cheap.
  function fillFeature(ctx, feature, w, h) {
    const g = feature.geometry;
    if (!g) return;
    const project = ([lng, lat]) => [(lng + 180) / 360 * w, (90 - lat) / 180 * h];
    const fillRings = (rings) => {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach((pt, i) => {
          const [x, y] = project(pt);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    };
    if (g.type === 'Polygon') fillRings(g.coordinates);
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) fillRings(poly);
  }

  function scheduleBake() {
    if (bakePending) return;
    bakePending = true;
    idleSchedule(runBake); // many changes within one frame/tick coalesce into a single bake
  }

  async function runBake() {
    bakePending = false;
    const t0 = performance.now();
    try {
      if (dirtyBaseImage) {
        dirtyBaseImage = false;
        const img = customBaseImage ?? await loadEarthImage();
        const w = img.naturalWidth || img.width || 1600;
        const h = img.naturalHeight || img.height || 800;
        if (!baseCanvas || baseCanvas.width !== w || baseCanvas.height !== h) dirtyBorders = true; // re-project at the new size
        baseCanvas = baseCanvas ?? document.createElement('canvas');
        baseCanvas.width = w;
        baseCanvas.height = h;
        baseCanvas.getContext('2d').drawImage(img, 0, 0, w, h);
      }
      if (dirtyBorders && baseCanvas) {
        dirtyBorders = false;
        const w = baseCanvas.width, h = baseCanvas.height;
        bordersCanvas = bordersCanvas ?? document.createElement('canvas');
        bordersCanvas.width = w;
        bordersCanvas.height = h;
        const ctx = bordersCanvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = (PALETTES[currentTheme] ?? PALETTES.light).stroke;
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        for (const f of countryFeatures) {
          forEachRing(f, (ring) => {
            for (const seg of ringSegments(ring)) strokeSegment(ctx, seg, w, h);
          });
        }
      }
      compositeAndApply();
    } catch {
      // fail-open: an unbaked (borderless, unfilled) texture is still a usable globe
    }
    bakeMs = performance.now() - t0;
  }

  function compositeAndApply() {
    if (!baseCanvas) return;
    const w = baseCanvas.width, h = baseCanvas.height;
    bakedCanvas = bakedCanvas ?? document.createElement('canvas');
    bakedCanvas.width = w;
    bakedCanvas.height = h;
    const ctx = bakedCanvas.getContext('2d');
    ctx.drawImage(baseCanvas, 0, 0);
    if (countryFillMap?.size) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      for (const f of countryFeatures) {
        const color = countryFillMap.get(f.properties.iso2);
        if (color) { ctx.fillStyle = color; fillFeature(ctx, f, w, h); }
      }
      ctx.restore();
    }
    for (const overlay of textureOverlays.values()) {
      if (!overlay?.cells?.length) continue;
      ctx.save();
      ctx.fillStyle = overlay.color ?? '#30D158';
      for (const cell of overlay.cells) {
        const alpha = Math.max(0, Math.min(1, cell.v ?? 0));
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha;
        const x = (cell.lng + 180) / 360 * w, y = (90 - cell.lat) / 180 * h;
        const cw = Math.max(1, (cell.dLng ?? 1) / 360 * w), ch = Math.max(1, (cell.dLat ?? 1) / 180 * h);
        ctx.fillRect(x - cw / 2, y - ch / 2, cw, ch);
      }
      ctx.restore();
    }
    if (bordersCanvas) ctx.drawImage(bordersCanvas, 0, 0); // borders paint last, on top of fill + overlays
    const mat = instance.globeMaterial();
    if (mat?.map) {
      // Preferred path: swap the live THREE.Texture's image in place (see globe.gl UMD build,
      // THREE isn't global so we can't reference THREE.CanvasTexture directly).
      // three.js allocates GPU texture storage once at the first upload's size (immutable
      // storage) and silently ignores a later image of a different size. NASA layers are 2048x1024
      // vs the bundled 1600x800, so a size change must dispose() first to force a fresh upload -
      // without this, switching base maps "did nothing".
      // bakedCanvas is reused (and already resized above), so track the last UPLOADED size ourselves.
      const size = `${bakedCanvas.width}x${bakedCanvas.height}`;
      if (uploadedSize && uploadedSize !== size) mat.map.dispose();
      uploadedSize = size;
      mat.map.image = bakedCanvas;
      mat.map.needsUpdate = true;
    } else {
      // Fallback if the material/map isn't ready for some reason: re-supply the whole image.
      instance.globeImageUrl(bakedCanvas.toDataURL('image/jpeg', 0.92));
    }
    wake(WAKE_DEFAULT_MS);
  }

  function setBaseImage(img) {
    customBaseImage = img ?? null;
    dirtyBaseImage = true;
    scheduleBake();
  }
  function setCountryFill(map) {
    countryFillMap = map instanceof Map ? map : (map ? new Map(Object.entries(map)) : null);
    scheduleBake();
  }
  function setTextureOverlay(id, data) {
    if (data) textureOverlays.set(id, data); else textureOverlays.delete(id);
    scheduleBake();
  }

  scheduleBake(); // never blocks first globe paint (idle-scheduled)

  function applyPalette(t) {
    const mat = instance.globeMaterial();
    mat.shininess = 0; // matte, not glossy plastic
    mat.specular?.set?.('#000000');
    instance.atmosphereColor((PALETTES[t] ?? PALETTES.light).atmosphere);
    // Flatter light than globe.gl's default (ambient 0.8π + directional 0.6π) so the far half
    // keeps its true texture colors instead of sinking into grey: a matte, map-like look.
    const [ambient, directional] = instance.lights?.() ?? [];
    ambient?.color?.set?.('#FFFFFF');
    if (ambient) ambient.intensity = Math.PI;
    if (directional) directional.intensity = 0.25 * Math.PI;
  }
  applyPalette(theme);

  function setTheme(t) {
    if (t === currentTheme) return;
    currentTheme = t;
    applyPalette(t);
    dirtyBorders = true; // the baked stroke color depends on theme
    scheduleBake();
    wake();
  }

  function markerEntry(e) {
    let rec = markerCache.get(e.id);
    if (rec) {
      rec.isNew = false;
      return rec;
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ph-marker'; // globe.css sets pointer-events:auto here; RUNBOOK "Globe.gl Pitfalls Learned" #1
    const dot = document.createElement('span');
    dot.className = 'ph-dot';
    el.append(dot);
    rec = { el, dot, entity: e, isNew: true, kind: 'marker' };
    el.addEventListener('click', () => onSelect?.(rec.entity, el));
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect?.(rec.entity, el); }
    });
    markerCache.set(e.id, rec);
    return rec;
  }

  function decorateMarker(rec, cursorMs) {
    const e = rec.entity;
    const meta = CATEGORY_META?.[e.category];
    const year = typeof e.date === 'string' ? e.date.slice(0, 4) : '';
    rec.el.setAttribute('aria-label', `${e.title}, ${meta?.label ?? e.category}, ${year}`);
    rec.dot.style.setProperty('--marker-color', meta?.color ?? DEFAULT_COLOR);
    if (rec.isNew) {
      rec.el.classList.remove('pop');
      void rec.el.offsetWidth; // restart the keyframe animation deterministically
      rec.el.classList.add('pop');
    }
    const t = parseUtcDate(e.date);
    const fresh = Number.isFinite(t) && cursorMs - t >= 0 && cursorMs - t <= FRESH_MS;
    rec.el.classList.toggle('fresh', fresh && !reducedMotion());
  }

  function setPoints(list = [], cursorMs = currentCursor) {
    currentCursor = cursorMs;
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      const rec = markerEntry(e);
      rec.entity = e;
      rec.lat = e.institution.lat;
      rec.lng = e.institution.lng;
      decorateMarker(rec, cursorMs);
    }
    for (const [id, rec] of markerCache) {
      if (!seen.has(id)) { rec.el.remove(); markerCache.delete(id); }
    }
    rebuildHtmlLayer();
    wake(WAKE_POINTS_MS);
  }

  setPoints(entities, currentCursor);

  // --- Layer points: one merged mesh across every layer (see pointsMerge(true) above); this just
  // maintains the per-layer item lists that pickLayerItemAt walks and that get flattened into
  // pointsData whenever any layer's items change. ---
  function rebuildMergedPoints() {
    const merged = [];
    for (const [layerId, items] of layerPointsMap) for (const it of items) merged.push({ ...it, layerId });
    instance.pointsData(merged);
    wake(WAKE_POINTS_MS);
  }
  function setLayerPoints(layerId, items) {
    if (items?.length) layerPointsMap.set(layerId, items); else layerPointsMap.delete(layerId);
    rebuildMergedPoints();
  }

  // --- Objects (e.g. ISS): an HTML marker + dashed ground-track path per layer, ticking once a
  // second while the layer is on. wake(250) keeps the render loop otherwise free to sleep between
  // ticks rather than running continuously. ---
  function buildObjectMarkerEl(o) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ph-object-marker';
    el.setAttribute('aria-label', o.title ?? 'Object');
    el.appendChild(objectGlyph());
    const cap = document.createElement('span');
    cap.className = 'ph-object-marker-label';
    cap.textContent = o.title ?? '';
    el.appendChild(cap);
    const rect = () => el.getBoundingClientRect();
    const emit = () => {
      const r = rect(), c = container.getBoundingClientRect();
      onLayerItem?.(o, { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top });
    };
    el.addEventListener('click', emit);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); emit(); } });
    return el;
  }

  function refreshObjectPaths() {
    const paths = [equatorPath()];
    const t = Date.now();
    for (const rec of objectLayers.values()) {
      const trackPts = rec.data.track?.(t) ?? [];
      const pts = trackPts.map((p) => [p.lat, p.lng]);
      for (const o of rec.data.objects ?? []) paths.push({ pts, kind: 'object-track', color: o.color, id: o.id });
    }
    instance.pathsData(paths);
  }

  function setObjects(layerId, data) {
    const existing = objectLayers.get(layerId);
    if (existing) {
      clearInterval(existing.timer);
      for (const m of existing.markers.values()) m.el.remove();
      objectLayers.delete(layerId);
    }
    if (!data) {
      rebuildHtmlLayer();
      refreshObjectPaths();
      return;
    }
    const rec = { data, markers: new Map(), timer: null };
    objectLayers.set(layerId, rec);
    function tick() {
      const t = Date.now();
      const pos = data.positionAt?.(t) ?? {};
      for (const o of data.objects ?? []) {
        let m = rec.markers.get(o.id);
        if (!m) {
          m = { el: buildObjectMarkerEl(o), o, lat: pos.lat, lng: pos.lng };
          rec.markers.set(o.id, m);
        }
        m.lat = pos.lat;
        m.lng = pos.lng;
      }
      rebuildHtmlLayer();
      refreshObjectPaths();
      wake(250);
    }
    tick();
    rec.timer = setInterval(tick, 1000);
  }

  function setCountryCounts(map) {
    countryCounts = map instanceof Map ? map : new Map(Object.entries(map ?? {}));
    scheduleHtmlLayerRebuild();
  }

  function highlightCountry(iso2) {
    const f = countryFeatures.find((feat) => feat.properties.iso2 === iso2);
    selectedFeature = f ?? null;
    refreshPolygons();
  }

  function clearCountry() {
    selectedFeature = null;
    refreshPolygons();
  }

  function flyToCountry({ lat, lng } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Promise.resolve();
    const duration = reducedMotion() ? 0 : 1200;
    wake(duration + 200);
    instance.pointOfView({ lat, lng, altitude: 1.3 }, duration);
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  // Compass heading = where the globe's north axis points on screen, from camera vectors (see
  // computeNorthDeg). With globe.gl's OrbitControls (camera.up = +Y) this is 0deg - north up - at
  // every view; the math stays general in case the controls ever allow roll. The value is
  // unwrapped (shortest delta accumulated) so a CSS rotate never spins the long way past 360.
  let unwrappedNorth = 0;
  let unwrappedNorthSet = false;
  function normalizeAngle(deg) { return ((deg % 360) + 360) % 360; }
  function shortestDelta(fromDeg, toDeg) {
    let d = (toDeg - fromDeg) % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
  }
  function computeNorthDeg(pov) {
    try {
      // Pure vector math on camera.position + camera.up, NOT screen projection. getScreenCoords uses
      // matrices three.js only refreshes inside render(), and pointOfView() moves the position before
      // the orientation catches up - any read between the two mixed old and new camera state and made
      // the needle jump (the "spazzing compass"). Position and up are always current.
      // Screen-north = the globe's north axis (+Y) expressed in the camera's right/up basis.
      const cam = instance.camera?.();
      const p = cam?.position, u = cam?.up;
      if (!p || !u) return unwrappedNorth;
      const len = Math.hypot(p.x, p.y, p.z) || 1;
      const f = [-p.x / len, -p.y / len, -p.z / len]; // camera looks at the globe centre
      let r = [f[1] * u.z - f[2] * u.y, f[2] * u.x - f[0] * u.z, f[0] * u.y - f[1] * u.x]; // right = f × up
      const rl = Math.hypot(r[0], r[1], r[2]);
      if (rl < 1e-6) return unwrappedNorth; // looking straight down a pole: hold the last heading
      r = r.map((v) => v / rl);
      const trueUpY = r[2] * f[0] - r[0] * f[2]; // y-component of (right × forward)
      const raw = normalizeAngle(Math.atan2(r[1], trueUpY) * 180 / Math.PI);
      if (!unwrappedNorthSet) {
        unwrappedNorth = raw;
        unwrappedNorthSet = true;
      } else {
        unwrappedNorth += shortestDelta(normalizeAngle(unwrappedNorth), raw);
      }
      return unwrappedNorth;
    } catch {
      return unwrappedNorth; // deterministic fail-safe: hold rather than throw or snap to 0
    }
  }

  function getView() {
    const pov = instance.pointOfView();
    return { lat: pov.lat, lng: pov.lng, altitude: pov.altitude, northDeg: computeNorthDeg(pov) };
  }

  function flyTo(entity, { altitude = 0.8, ms = 1200 } = {}) { // 0.8 keeps regional context; closer exposes the 110m coastline
    const inst = entity?.institution;
    if (!inst) return Promise.resolve();
    const duration = reducedMotion() ? 0 : ms;
    wake(duration + 200);
    instance.pointOfView({ lat: inst.lat, lng: inst.lng, altitude }, duration);
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  function zoomBy(factor) {
    const pov = instance.pointOfView();
    const altitude = Math.min(MAX_ALTITUDE, Math.max(MIN_ALTITUDE, pov.altitude * factor));
    const duration = reducedMotion() ? 0 : 200;
    wake(duration + 200);
    instance.pointOfView({ altitude }, duration);
  }
  const zoomIn = () => zoomBy(0.6);
  const zoomOut = () => zoomBy(1.6);

  function resetView() {
    const duration = reducedMotion() ? 0 : 800;
    wake(duration + 200);
    instance.pointOfView(DEFAULT_VIEW, duration);
  }

  // Beyond the core stage API: GlobeControls needs a generic way to
  // nudge lat/lng (keyboard arrow-key rotation) without a fake "entity" target.
  function setView(view, ms = 150) {
    wake((reducedMotion() ? 0 : ms) + 200);
    instance.pointOfView(view, reducedMotion() ? 0 : ms);
  }

  function onViewChange(fn) {
    viewListeners.add(fn);
    return () => viewListeners.delete(fn);
  }

  function markerFor(id) {
    return markerCache.get(id)?.el;
  }

  // Search hook: markers matching the query get a highlight ring, the rest dim. Null clears both.
  function setSearchHighlight(idSet) {
    for (const [id, rec] of markerCache) {
      if (!idSet) { rec.el.classList.remove('match', 'dim'); continue; }
      const match = idSet.has(id);
      rec.el.classList.toggle('match', match);
      rec.el.classList.toggle('dim', !match);
    }
  }

  // Internal helper for GlobeControls' legend popover: how many currently-plotted markers fall
  // into each category. Not part of the documented stage API, but same file owner wires it up.
  function categoryCounts() {
    const counts = new Map();
    for (const rec of markerCache.values()) {
      counts.set(rec.entity.category, (counts.get(rec.entity.category) ?? 0) + 1);
    }
    return counts;
  }

  function destroy() {
    document.removeEventListener('visibilitychange', onVisibility);
    controls?.removeEventListener?.('start', onDragStart);
    controls?.removeEventListener?.('change', onControlsChange);
    controls?.removeEventListener?.('end', onDragEnd);
    container.removeEventListener('wheel', onContainerWake);
    container.removeEventListener('pointerdown', onContainerWake);
    container.removeEventListener('pointermove', onPointerMove);
    clearTimeout(idleTimer);
    clearTimeout(labelRestoreTimer);
    ro.disconnect();
    viewListeners.clear();
    instance.pauseAnimation?.();
    try {
      const scene = instance.scene?.();
      scene?.traverse?.((obj) => {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m?.dispose?.());
      });
      renderer?.dispose?.();
      renderer?.forceContextLoss?.();
      instance._destructor?.();
    } catch {
      // best-effort teardown; container removal below is the real cleanup
    }
    for (const rec of markerCache.values()) rec.el.remove();
    markerCache.clear();
    for (const rec of countryLabelCache.values()) rec.el.remove();
    countryLabelCache.clear();
    for (const rec of objectLayers.values()) {
      clearInterval(rec.timer);
      for (const m of rec.markers.values()) m.el.remove();
    }
    objectLayers.clear();
    layerPointsMap.clear();
    for (const cache of layerIconsMap.values()) for (const rec of cache.values()) rec.el.remove();
    layerIconsMap.clear();
    tooltipEl.remove();
    for (const d of poleItems) d.el.remove();
    equatorLabelItem.el.remove();
    container.replaceChildren();
    container.style.cursor = '';
    container.classList.remove('ph-dragging');
    document.querySelector(`link[href="${GLOBE_CSS_HREF}"]`)?.remove();
    cssPromise = undefined;
  }

  return {
    setPoints, setTheme, flyTo, zoomIn, zoomOut, resetView, setView, getView, onViewChange, markerFor,
    setCountryCounts, highlightCountry, clearCountry, flyToCountry, stats, setSearchHighlight,
    categoryCounts, destroy,
    setBaseImage, setCountryFill, setTextureOverlay, setLayerPoints, setLayerIcons, setObjects,
  };
}
