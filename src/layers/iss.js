/** THIS FILE DOES: ISS position/ground-track objects layer from a committed OEM ephemeris snapshot, ROLE: Data, MAINTAINER NOTE: NASA's OEM (nasa-public-data S3) has no CORS header (confirmed 2026-09-25: Access-Control-Allow-Origin absent), so scripts/fetch-iss.mjs + a 12h cron commit data/live/iss-oem.json, loaded here same-origin; details() hits NASA EPIC directly (small, cacheable, same pattern as LayersPanel's bonus card). **/

import { fetchJson } from './util.js';
import { interpolateEci, eciToLatLngAlt } from './iss-propagate.js';

const TRACK_HALF_SPAN_MS = 45 * 60 * 1000;
const TRACK_STEP_MS = 2 * 60 * 1000;
const ISS_SPEED_KMS = 7.66;

export function normalize(oem) {
  const records = (oem.records || []).map((rec) => ({ t: Date.parse(rec.epoch), r: rec.r, v: rec.v }));
  records.sort((a, b) => a.t - b.t);
  return records;
}

function makePositionAt(records) {
  return (tMs) => {
    const rec = interpolateEci(records, tMs);
    if (!rec) return null;
    return eciToLatLngAlt(rec.r, tMs);
  };
}

function makeTrack(records) {
  return (tMs) => {
    const pts = [];
    for (let t = tMs - TRACK_HALF_SPAN_MS; t <= tMs + TRACK_HALF_SPAN_MS; t += TRACK_STEP_MS) {
      const rec = interpolateEci(records, t);
      if (!rec) continue;
      const { lat, lng } = eciToLatLngAlt(rec.r, t);
      pts.push({ lat, lng });
    }
    return pts;
  };
}

let epicCache = null;
async function latestEpicImage(signal) {
  if (epicCache) return epicCache;
  const list = await fetchJson('https://epic.gsfc.nasa.gov/api/natural', { signal });
  const latest = Array.isArray(list) ? list[list.length - 1] : null;
  if (!latest) return null;
  const [y, m, d] = latest.date.split(' ')[0].split('-');
  epicCache = { url: `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/jpg/${latest.image}.jpg`, date: latest.date };
  return epicCache;
}

export async function details(item, { signal } = {}) {
  const facts = [
    ['Altitude', Number.isFinite(item.altKm) ? `${item.altKm.toFixed(0)} km` : '—'],
    ['Speed', `≈ ${ISS_SPEED_KMS} km/s`],
    ['Latitude', Number.isFinite(item.lat) ? item.lat.toFixed(2) : '—'],
    ['Longitude', Number.isFinite(item.lng) ? item.lng.toFixed(2) : '—'],
  ];
  const images = [];
  try {
    const epic = await latestEpicImage(signal);
    if (epic) images.push({ url: epic.url, caption: `Earth, ${epic.date} UTC`, credit: 'NASA EPIC', link: 'https://epic.gsfc.nasa.gov/' });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // decorative image only: a failed EPIC fetch just leaves the sheet without a photo
  }
  return {
    title: item.title,
    subtitle: 'Current position, propagated locally from NASA OEM ephemeris',
    facts,
    images,
    links: [{ label: 'NASA Spot the Station', url: item.url }],
  };
}

export const iss = {
  id: 'iss',
  group: 'space',
  title: 'International Space Station',
  description: 'Current ISS position and ±45-minute ground track, propagated locally.',
  source: { org: 'NASA', domain: 'nasa.gov', homepage: 'https://spotthestation.nasa.gov/', license: 'Public domain (NASA)', trust: 'government' },
  render: 'objects',
  approxBytes: 20000,
  refreshMs: null, // position ticks locally every 1s (GlobeStage wake); ephemeris itself refreshes via the 12h cron, not client polling
  filters: [],
  legend: [{ label: 'ISS', color: '#ffd60a', shape: 'dot' }],
  async load(_filters, { signal } = {}) {
    const oem = await fetchJson('data/live/iss-oem.json', { signal });
    const records = normalize(oem);
    if (!records.length) throw new Error('iss-oem.json has no usable records');
    const positionAt = makePositionAt(records);
    return {
      objects: [{
        id: 'iss', layerId: 'iss', title: 'International Space Station',
        url: 'https://spotthestation.nasa.gov/', color: '#ffd60a',
        get lat() { return positionAt(Date.now())?.lat; },
        get lng() { return positionAt(Date.now())?.lng; },
        get altKm() { return positionAt(Date.now())?.altKm; },
      }],
      positionAt,
      track: makeTrack(records),
      fetchedAt: Date.now(),
    };
  },
  details,
};
