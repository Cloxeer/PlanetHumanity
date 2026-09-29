/** THIS FILE DOES: NASA EONET open natural-events icons layer + detail-sheet builder, ROLE: Data, MAINTAINER NOTE: category chip options come from the live /categories endpoint, fetched once and cached module-side; load()/details() stay pure-callable via normalize()/buildWorldviewUrl()/shortName(). **/

import { fetchJson } from './util.js';

const BASE = 'https://eonet.gsfc.nasa.gov/api/v3';
const WORLDVIEW_BASE = 'https://wvs.earthdata.nasa.gov/api/v1/snapshot';
const CATEGORY_COLORS = {
  wildfires: '#ff453a', severeStorms: '#0a84ff', volcanoes: '#ff9f0a',
  floods: '#30d5ff', seaLakeIce: '#64d2ff', drought: '#c9a227',
  dustHaze: '#a68a64', landslides: '#8e8e93', snow: '#ffffff', tempExtremes: '#ff375f',
};

// EONET category id -> eventIcons.js glyph name (GLOBE owns the actual glyphs).
const CATEGORY_ICONS = {
  wildfires: 'wildfire', severeStorms: 'storm', volcanoes: 'volcano', floods: 'flood',
  seaLakeIce: 'ice', drought: 'drought', dustHaze: 'dust', landslides: 'landslide',
  snow: 'snow', tempExtremes: 'heat',
};

// Named events (storms, volcanoes) keep their EONET title as-is ("Hurricane Erin"); other
// categories arrive as "Wildfire - Some Place" boilerplate that adds nothing over the category chip.
const NAMED_CATEGORIES = new Set(['severeStorms', 'volcanoes']);
// Verified live (2026-09-25): EONET wildfire/prescribed-fire titles have no separator at all
// ("Wildfire Merit Creek, Greene, Mississippi", "Prescribed Fire CRAWFORD CORRAL RX, Tulare, ..."),
// so the separator is optional; other categories (floods/drought/etc.) had zero live events to
// confirm against, so this stays a best-effort prefix strip.
const BOILERPLATE_PREFIX = /^(prescribed fire|wildfires?|floods?|icebergs?|droughts?|dust\s*(and|&)?\s*haze|landslides?|snow\s*storms?|snow|extreme\s*temperature(\s*events?)?|temperature\s*extremes?)\s*[-:]?\s*/i;

export function shortName(title, categoryId) {
  const t = (title || '').trim();
  if (NAMED_CATEGORIES.has(categoryId)) return t;
  return t.replace(BOILERPLATE_PREFIX, '').trim() || t;
}

// EONET's category ids are stable; a static list keeps the panel instant (no extra request).
const CATEGORY_OPTIONS = [
  ['wildfires', 'Wildfires'], ['severeStorms', 'Severe storms'], ['volcanoes', 'Volcanoes'], ['floods', 'Floods'],
  ['seaLakeIce', 'Sea & lake ice'], ['drought', 'Drought'], ['dustHaze', 'Dust & haze'], ['landslides', 'Landslides'],
  ['snow', 'Snow'], ['tempExtremes', 'Temperature extremes'],
].map(([value, label]) => ({ value, label }));

export function normalize(json, filters = {}) {
  const days = Number.isFinite(filters.days) ? filters.days : 30;
  const cutoff = Date.now() - days * 86400000;
  // Chips arrive as an array from the panel (or a Set from tests); empty/none selected = show all.
  const sel = filters.categories;
  const chips = sel instanceof Set ? (sel.size ? sel : null) : Array.isArray(sel) && sel.length ? new Set(sel) : null;
  const items = [];
  let skipped = 0;
  for (const ev of json.events || []) {
    // Most EONET events are Points (tracks use the latest point); a few are Polygons
    // (e.g. large ice/drought extents), which have no single marker point and are skipped.
    const geom = ev.geometry?.[ev.geometry.length - 1];
    if (!geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates)) { skipped++; continue; }
    const [lng, lat] = geom.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { skipped++; continue; }
    const t = Date.parse(geom.date);
    if (Number.isFinite(t) && t < cutoff) continue;
    const cat = ev.categories?.[0]?.id;
    if (chips && cat && !chips.has(cat)) continue;
    const catTitle = ev.categories?.map((c) => c.title).join(', ') || 'Natural event';
    items.push({
      id: `eonet-${ev.id}`,
      layerId: 'eonet',
      lat, lng,
      color: CATEGORY_COLORS[cat] || '#8e8e93',
      size: 0.5,
      icon: CATEGORY_ICONS[cat] || 'default',
      label: shortName(ev.title, cat),
      showLabel: NAMED_CATEGORIES.has(cat),
      title: ev.title,
      subtitle: catTitle,
      categoryId: cat,
      categoryTitle: catTitle,
      time: Number.isFinite(t) ? t : Date.now(),
      magnitudeValue: Number.isFinite(geom.magnitudeValue) ? geom.magnitudeValue : null,
      magnitudeUnit: geom.magnitudeUnit || null,
      bbox: clampBbox(lat, lng),
      sources: (ev.sources || []).map((s) => ({ label: s.id || 'Source', url: s.url })),
      url: ev.sources?.[0]?.url || `https://eonet.gsfc.nasa.gov/api/v3/events/${ev.id}`,
    });
  }
  return { items, skipped, fetchedAt: Date.now() };
}

// Point ±3deg, clamped to valid lat/lng ranges (lat can't exceed the poles; lng wraps at
// the antimeridian instead of clamping, so an event near +/-180 still gets a full-width box).
export function clampBbox(lat, lng, delta = 3) {
  const wrapLng = (v) => (((v + 180) % 360 + 360) % 360) - 180;
  return {
    south: Math.max(-90, lat - delta),
    north: Math.min(90, lat + delta),
    west: wrapLng(lng - delta),
    east: wrapLng(lng + delta),
  };
}

// `layer` may be a single Worldview layer id or a comma-separated stack (e.g. true-color + a fire
// overlay); WRAP needs exactly one entry per layer or the API rejects the whole request.
export function buildWorldviewUrl({ lat, lng, date, layer, width = 640, height = 640 }) {
  const { west, south, east, north } = clampBbox(lat, lng);
  // EPSG:4326 in Worldview Snapshots is LAT-first (WMS 1.3 axis order): south,west,north,east.
  // Lon-first asked for latitude -91.8 and NASA returned an all-black image.
  const bbox = [south, west, north, east].map((v) => v.toFixed(1)).join(',');
  const wrap = layer.split(',').map(() => 'x').join(',');
  const time = date || new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    REQUEST: 'GetSnapshot', LAYERS: layer, CRS: 'EPSG:4326', TIME: time, WRAP: wrap,
    BBOX: bbox, FORMAT: 'image/jpeg', WIDTH: String(width), HEIGHT: String(height),
  });
  return `${WORLDVIEW_BASE}?${params.toString()}`;
}

export async function details(item) {
  const dateStr = new Date(item.time).toISOString().slice(0, 10);
  const images = [
    {
      url: buildWorldviewUrl({ lat: item.lat, lng: item.lng, date: dateStr, layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor' }),
      caption: 'True-color satellite view',
      credit: 'NASA Worldview Snapshots',
      link: 'https://wvs.earthdata.nasa.gov/',
    },
  ];
  if (item.categoryId === 'wildfires') {
    images.push({
      url: buildWorldviewUrl({ lat: item.lat, lng: item.lng, date: dateStr, layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor,MODIS_Terra_Thermal_Anomalies_All' }),
      caption: 'True-color with active-fire detections overlaid',
      credit: 'NASA Worldview Snapshots',
      link: 'https://wvs.earthdata.nasa.gov/',
    });
  }
  const facts = [
    ['Category', item.categoryTitle || item.subtitle],
    ['Date', dateStr],
  ];
  if (Number.isFinite(item.magnitudeValue)) {
    facts.push(['Magnitude', `${item.magnitudeValue}${item.magnitudeUnit ? ` ${item.magnitudeUnit}` : ''}`]);
  }
  facts.push(['Coordinates', `${item.lat.toFixed(2)}, ${item.lng.toFixed(2)}`]);
  const links = (item.sources?.length ? item.sources : [{ label: 'EONET', url: item.url }])
    .filter((s) => s.url)
    .map((s) => ({ label: s.label || 'Source', url: s.url }));
  return { title: item.title, subtitle: item.subtitle, facts, images, links };
}

let categoryOptionsCache = null;
async function categoryOptions(signal) {
  if (categoryOptionsCache) return categoryOptionsCache;
  const json = await fetchJson(`${BASE}/categories`, { signal });
  categoryOptionsCache = (json.categories || []).map((c) => ({ value: c.id, label: c.title }));
  return categoryOptionsCache;
}

export const eonet = {
  id: 'eonet',
  group: 'events',
  title: 'Natural events',
  description: 'Open wildfires, storms, volcanoes and other events from NASA EONET.',
  source: { org: 'NASA EONET', domain: 'eonet.gsfc.nasa.gov', homepage: 'https://eonet.gsfc.nasa.gov/', license: 'Public domain (NASA)', trust: 'government' },
  render: 'icons',
  approxBytes: 45000,
  refreshMs: 30 * 60 * 1000,
  filters: [
    { key: 'days', type: 'select', label: 'Window', options: [{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }], default: 30 },
    { key: 'categories', type: 'chips', label: 'Show only (none selected = all)', options: CATEGORY_OPTIONS, default: [] },
  ],
  legend: Object.entries(CATEGORY_COLORS).slice(0, 6).map(([id, color]) => ({ label: id, color, shape: 'dot' })),
  categoryOptions,
  async load(filterValues = {}, { signal } = {}) {
    const days = filterValues.days || 30;
    const json = await fetchJson(`${BASE}/events?status=open&days=${days}&limit=200`, { signal });
    return normalize(json, filterValues);
  },
  details,
};
