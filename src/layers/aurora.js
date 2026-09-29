/** THIS FILE DOES: NOAA SWPC OVATION aurora probability texture layer, ROLE: Data, MAINTAINER NOTE: two independent NOAA endpoints are fetched (ovation cells + planetary K index for the status line); each failure is independent so one missing feed doesn't blank the other. **/

import { fetchJson, clamp01 } from './util.js';

const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const MIN_PROB_PCT = 10;

export function normalize(ovationJson, kIndexJson) {
  const cells = [];
  for (const [lon, lat, prob] of ovationJson.coordinates || []) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(prob)) continue;
    if (prob < MIN_PROB_PCT) continue;
    const lng = lon > 180 ? lon - 360 : lon; // OVATION lon is 0..360
    cells.push({ lat, lng, v: clamp01(prob / 100), dLat: 1, dLng: 1 });
  }
  let kp = null;
  if (Array.isArray(kIndexJson) && kIndexJson.length > 0) {
    const last = kIndexJson[kIndexJson.length - 1];
    kp = Number.isFinite(last?.Kp) ? last.Kp : null;
  }
  return { cells, color: '#34c759', fetchedAt: Date.now(), extra: { kp } };
}

export const aurora = {
  id: 'aurora',
  group: 'space',
  title: 'Aurora forecast',
  description: 'NOAA OVATION aurora visibility probability, updated every 30 minutes.',
  source: { org: 'NOAA SWPC', domain: 'swpc.noaa.gov', homepage: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast', license: 'Public domain (NOAA)', trust: 'government' },
  render: 'texture',
  approxBytes: 4500,
  refreshMs: 30 * 60 * 1000,
  filters: [],
  legend: [{ label: 'Visibility probability', shape: 'gradient', stops: ['#34c75920', '#34c759'] }],
  async load(_filters, { signal } = {}) {
    const [ovation, kIndex] = await Promise.all([
      fetchJson(OVATION_URL, { signal }),
      fetchJson(KP_URL, { signal }).catch(() => null),
    ]);
    return normalize(ovation, kIndex);
  },
};
