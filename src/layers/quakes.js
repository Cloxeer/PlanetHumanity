/** THIS FILE DOES: USGS live earthquake points layer + detail-sheet builder, ROLE: Data, MAINTAINER NOTE: normalize() is pure (tested against tests/fixtures/layers/quakes.json); load() only fetches and filters by minMagnitude client-side (USGS feeds are pre-bucketed by period+magnitude, not queryable); details() fetches the per-event detail GeoJSON (item.detailUrl), which is a live network call so it stays out of normalize(). **/

import { fetchJson } from './util.js';
import { buildWorldviewUrl } from './eonet.js';

const FEEDS = { hour: 'all_hour', day: '2.5_day', week: '2.5_week' };
const BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';

function colorFor(mag) {
  if (mag >= 6) return '#ff3b30';
  if (mag >= 4.5) return '#ff9500';
  if (mag >= 3) return '#ffcc00';
  return '#34c759';
}

export function normalize(geojson, filters = {}) {
  const minMag = Number.isFinite(filters.minMagnitude) ? filters.minMagnitude : 2.5;
  const items = [];
  for (const f of geojson.features || []) {
    const [lng, lat] = f.geometry?.coordinates || [];
    const mag = f.properties?.mag;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(mag)) continue;
    if (mag < minMag) continue;
    items.push({
      id: `quake-${f.id}`,
      layerId: 'quakes',
      lat, lng,
      color: colorFor(mag),
      size: Math.max(0, Math.min(1, mag / 8)),
      title: `M${mag.toFixed(1)} — ${f.properties.place || 'Unknown location'}`,
      subtitle: 'USGS earthquake',
      time: f.properties.time,
      url: f.properties.url,
      detailUrl: f.properties.detail || null,
    });
  }
  return { items, skipped: (geojson.features || []).length - items.length, fetchedAt: Date.now() };
}

export async function details(item, { signal } = {}) {
  if (!item.detailUrl) return { title: item.title, subtitle: item.subtitle, facts: [], images: [], links: item.url ? [{ label: 'USGS event page', url: item.url }] : [] };
  const json = await fetchJson(item.detailUrl, { signal });
  const p = json.properties || {};
  const dateStr = new Date(p.time).toISOString().slice(0, 10);
  const facts = [
    ['Magnitude', Number.isFinite(p.mag) ? `M ${p.mag}${p.magType ? ` (${p.magType})` : ''}` : '—'],
    ['Depth', Number.isFinite(json.geometry?.coordinates?.[2]) ? `${json.geometry.coordinates[2]} km` : '—'],
    ['Place', p.place || '—'],
    ['Time', new Date(p.time).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
    ['Felt reports', Number.isFinite(p.felt) ? String(p.felt) : 'None reported'],
    ['Tsunami', p.tsunami ? 'Possible' : 'None'],
    ['Alert level', p.alert || 'None'],
  ];
  const images = [];
  const shakemap = p.products?.shakemap?.[0]?.contents?.['download/intensity.jpg'];
  if (shakemap?.url) {
    images.push({ url: shakemap.url, caption: 'ShakeMap intensity', credit: 'USGS ShakeMap', link: p.url });
  }
  const [lng, lat] = json.geometry?.coordinates || [];
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    images.push({
      url: buildWorldviewUrl({ lat, lng, date: dateStr, layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor' }),
      caption: 'True-color satellite view',
      credit: 'NASA Worldview Snapshots',
      link: 'https://wvs.earthdata.nasa.gov/',
    });
  }
  return {
    title: item.title,
    subtitle: item.subtitle,
    facts,
    images,
    links: p.url ? [{ label: 'USGS event page', url: p.url }] : [],
  };
}

export const quakes = {
  id: 'quakes',
  group: 'events',
  title: 'Earthquakes',
  description: 'Recent earthquakes from the USGS real-time feed.',
  source: { org: 'USGS', domain: 'usgs.gov', homepage: 'https://earthquake.usgs.gov/', license: 'Public domain (USGS)', trust: 'government' },
  render: 'points',
  approxBytes: 20000,
  refreshMs: 5 * 60 * 1000,
  filters: [
    { key: 'period', type: 'select', label: 'Period', options: [{ value: 'hour', label: 'Past hour' }, { value: 'day', label: 'Past day' }, { value: 'week', label: 'Past week' }], default: 'day' },
    { key: 'minMagnitude', type: 'range', label: 'Min magnitude', min: 0, max: 7, step: 0.5, default: 2.5 },
  ],
  legend: [
    { label: 'M < 3', color: '#34c759', shape: 'dot' },
    { label: 'M 3–4.5', color: '#ffcc00', shape: 'dot' },
    { label: 'M 4.5–6', color: '#ff9500', shape: 'dot' },
    { label: 'M 6+', color: '#ff3b30', shape: 'dot' },
  ],
  async load(filterValues = {}, { signal } = {}) {
    const feed = FEEDS[filterValues.period] || FEEDS.day;
    const json = await fetchJson(`${BASE}/${feed}.geojson`, { signal });
    return normalize(json, filterValues);
  },
  details,
};
