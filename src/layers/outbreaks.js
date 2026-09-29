/** THIS FILE DOES: WHO Disease Outbreak News points layer + detail-sheet builder, ROLE: Data, MAINTAINER NOTE: geojson is loaded once and cached module-side; normalize(json, filters, index) takes the country index as a parameter so tests stay pure (no fetch inside normalize); details() does its own single-record fetch (verified live: filtering by UrlName returns the full Summary/Overview fields the list endpoint's $select omits). **/

import { fetchJson } from './util.js';
import { buildCountryIndex, resolveCountry, extractOutbreakLocation } from './country-geo.js';
import { flagUrl } from '../ui/flags.js';

const BASE = 'https://www.who.int/api/emergencies/diseaseoutbreaknews';
const SELECT = 'Title,PublicationDateAndTime,UrlName';

// WHO's Summary field is already plain text; Overview/Response are rich HTML. Stripped only for
// display text (assigned via textContent downstream, never innerHTML, per repo law either way).
export function stripHtml(html) {
  if (!html) return '';
  if (typeof document !== 'undefined') {
    const tpl = document.createElement('template');
    tpl.innerHTML = html; // detached: never attached to the live document
    return (tpl.content.textContent || '').replace(/\s+/g, ' ').trim();
  }
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalize(json, filters = {}, countryIndex) {
  const months = Number.isFinite(filters.months) ? filters.months : 6;
  const cutoff = Date.now() - months * 30 * 86400000;
  const items = [];
  let skipped = 0;
  for (const v of json.value || []) {
    const t = Date.parse(v.PublicationDateAndTime);
    if (Number.isFinite(t) && t < cutoff) continue;
    const loc = extractOutbreakLocation(v.Title);
    const hit = loc && countryIndex ? resolveCountry(loc, countryIndex) : null;
    if (!hit) { skipped++; continue; }
    items.push({
      id: `who-${v.UrlName}`,
      layerId: 'outbreaks',
      lat: hit.lat, lng: hit.lng,
      color: '#ff375f', size: 0.4,
      title: v.Title,
      subtitle: 'WHO Disease Outbreak News',
      time: Number.isFinite(t) ? t : Date.now(),
      countryIso2: hit.iso2,
      countryName: hit.name,
      urlName: v.UrlName,
      url: `https://www.who.int/emergencies/disease-outbreak-news/item/${v.UrlName}`,
    });
  }
  return { items, skipped, fetchedAt: Date.now() };
}

let countryIndexCache = null;
async function loadCountryIndex(signal) {
  if (countryIndexCache) return countryIndexCache;
  const geojson = await fetchJson('data/geo/countries-110m.geojson', { signal });
  countryIndexCache = buildCountryIndex(geojson);
  return countryIndexCache;
}

function donDetailUrl(urlName) {
  const params = new URLSearchParams({
    sf_provider: 'dynamicProvider372', sf_culture: 'en',
    '$filter': `UrlName eq '${urlName}'`, '$format': 'json',
  });
  return `${BASE}?${params.toString()}`;
}

export async function details(item, { signal } = {}) {
  const facts = [
    ['Country', item.countryName || '—'],
    ['Date', new Date(item.time).toISOString().slice(0, 10)],
  ];
  const images = [];
  const flag = flagUrl(item.countryIso2);
  if (flag) images.push({ url: flag, caption: item.countryName || 'Affected country', credit: 'Flag icon', link: null });
  let summary = '';
  if (item.urlName) {
    try {
      const json = await fetchJson(donDetailUrl(item.urlName), { signal });
      const rec = json.value?.[0];
      summary = stripHtml(rec?.Summary) || stripHtml(rec?.Overview);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // fail soft: the sheet still shows title/facts/link without a summary
    }
  }
  return {
    title: item.title,
    subtitle: item.subtitle,
    summary,
    facts,
    images,
    links: [{ label: 'WHO Disease Outbreak News', url: item.url }],
  };
}

export const outbreaks = {
  id: 'outbreaks',
  group: 'health',
  title: 'Disease outbreaks',
  description: 'WHO Disease Outbreak News, placed at each country’s label point.',
  source: { org: 'World Health Organization', domain: 'who.int', homepage: 'https://www.who.int/emergencies/disease-outbreak-news', license: 'WHO terms of use', trust: 'intergovernmental' },
  render: 'points',
  approxBytes: 3000,
  refreshMs: 60 * 60 * 1000,
  filters: [
    { key: 'months', type: 'select', label: 'Window', options: [{ value: 3, label: '3 months' }, { value: 6, label: '6 months' }, { value: 12, label: '12 months' }], default: 6 },
  ],
  legend: [{ label: 'Outbreak', color: '#ff375f', shape: 'dot' }],
  async load(filterValues = {}, { signal } = {}) {
    const top = filterValues.months && filterValues.months > 6 ? 60 : 30;
    const url = `${BASE}?sf_provider=dynamicProvider372&sf_culture=en&%24orderby=PublicationDateAndTime%20desc&%24select=${SELECT}&%24format=json&%24top=${top}`;
    const [json, countryIndex] = await Promise.all([fetchJson(url, { signal }), loadCountryIndex(signal)]);
    return normalize(json, filterValues, countryIndex);
  },
  details,
};
