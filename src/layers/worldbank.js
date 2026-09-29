/** THIS FILE DOES: World Bank WDI country-fill layers (life expectancy, u5 mortality, health spend, physicians), ROLE: Data, MAINTAINER NOTE: one small factory instead of 4 near-duplicate files; normalize(json, geoIso2Set) is pure and shared, only the indicator/labels/units differ per exported layer. **/

import { fetchJson } from './util.js';

const BASE = 'https://api.worldbank.org/v2/country/all/indicator';

// World Bank's `country.id` is a real ISO2 for actual countries but an aggregate code
// (regions, income groups, "World") for rollups; those aggregates never appear in our
// geojson, so intersecting with it drops them without a separate blocklist.
export function normalize(json, geoIso2Set) {
  const rows = Array.isArray(json) ? json[1] || [] : [];
  const values = new Map();
  const years = new Map();
  for (const row of rows) {
    const iso2 = row.country?.id;
    if (!iso2 || !geoIso2Set.has(iso2)) continue;
    if (!Number.isFinite(row.value)) continue;
    if (values.has(iso2)) continue; // mrnev=1 already gives most-recent-non-empty; first wins on dupes
    values.set(iso2, row.value);
    years.set(iso2, Number(row.date));
  }
  const nums = [...values.values()];
  return { values, years, min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0 };
}

let geoIso2Cache = null;
async function loadGeoIso2Set(signal) {
  if (geoIso2Cache) return geoIso2Cache;
  const geojson = await fetchJson('data/geo/countries-110m.geojson', { signal });
  geoIso2Cache = new Set((geojson.features || []).map((f) => f.properties?.iso2).filter(Boolean));
  return geoIso2Cache;
}

function makeWbLayer({ id, title, description, indicator, unit, higherIsBetter, format }) {
  return {
    id, group: 'country', title, description,
    source: { org: 'World Bank', domain: 'worldbank.org', homepage: 'https://data.worldbank.org/', license: 'CC BY-4.0 (World Bank)', trust: 'intergovernmental' },
    render: 'country-fill',
    approxBytes: 60000,
    refreshMs: null,
    filters: [],
    legend: [{ label: unit, shape: 'gradient' }],
    higherIsBetter, unit, format,
    async load(_filters, { signal } = {}) {
      const [json, geoIso2Set] = await Promise.all([
        fetchJson(`${BASE}/${indicator}?format=json&mrnev=1&per_page=400`, { signal }),
        loadGeoIso2Set(signal),
      ]);
      const result = normalize(json, geoIso2Set);
      return { ...result, higherIsBetter, unit, format };
    },
  };
}

export const wbLifeExp = makeWbLayer({
  id: 'wb-lifeexp', title: 'Life expectancy', description: 'Life expectancy at birth, total years.',
  indicator: 'SP.DYN.LE00.IN', unit: 'years', higherIsBetter: true, format: (v) => `${v.toFixed(1)} yrs`,
});
export const wbU5Mort = makeWbLayer({
  id: 'wb-u5mort', title: 'Under-5 mortality', description: 'Deaths per 1,000 live births before age 5.',
  indicator: 'SH.DYN.MORT', unit: 'per 1,000', higherIsBetter: false, format: (v) => `${v.toFixed(1)} / 1,000`,
});
export const wbHealthExp = makeWbLayer({
  id: 'wb-healthexp', title: 'Health spending', description: 'Current health expenditure, % of GDP.',
  indicator: 'SH.XPD.CHEX.GD.ZS', unit: '% of GDP', higherIsBetter: true, format: (v) => `${v.toFixed(1)}%`,
});
export const wbPhysicians = makeWbLayer({
  id: 'wb-physicians', title: 'Physicians', description: 'Physicians per 1,000 people.',
  indicator: 'SH.MED.PHYS.ZS', unit: 'per 1,000', higherIsBetter: true, format: (v) => `${v.toFixed(2)} / 1,000`,
});
