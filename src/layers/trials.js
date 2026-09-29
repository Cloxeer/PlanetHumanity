/** THIS FILE DOES: ClinicalTrials.gov recruiting-studies points layer + detail-sheet builder, ROLE: Data, MAINTAINER NOTE: one point per site (a study with N sites yields N items); fields= param keeps the payload small; details() does a single-study v2 fetch by NCTId (verified live field paths below). **/

import { fetchJson } from './util.js';

const BASE = 'https://clinicaltrials.gov/api/v2/studies';
const FIELDS = 'NCTId,BriefTitle,LocationFacility,LocationCity,LocationCountry,LocationGeoPoint';
const DETAIL_FIELDS = 'NCTId,BriefTitle,BriefSummary,Phase,OverallStatus,LeadSponsorName,EnrollmentCount,Condition';

export function normalize(json, filters = {}) {
  const maxSites = Number.isFinite(filters.maxSites) ? filters.maxSites : 500;
  const items = [];
  let skipped = 0;
  for (const study of json.studies || []) {
    const id = study.protocolSection?.identificationModule?.nctId;
    const title = study.protocolSection?.identificationModule?.briefTitle;
    const locations = study.protocolSection?.contactsLocationsModule?.locations || [];
    for (const loc of locations) {
      if (items.length >= maxSites) break;
      const lat = loc.geoPoint?.lat;
      const lng = loc.geoPoint?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) { skipped++; continue; }
      items.push({
        id: `trial-${id}-${items.length}`,
        layerId: 'trials',
        lat, lng,
        color: '#5e5ce6', size: 0.3,
        title: title || id,
        subtitle: [loc.facility, loc.city, loc.country].filter(Boolean).join(', '),
        time: Date.now(),
        nctId: id,
        url: `https://clinicaltrials.gov/study/${id}`,
      });
    }
  }
  return { items, skipped, fetchedAt: Date.now() };
}

export async function details(item, { signal } = {}) {
  if (!item.nctId) return { title: item.title, subtitle: item.subtitle, facts: [], images: [], links: item.url ? [{ label: 'Study page', url: item.url }] : [] };
  const json = await fetchJson(`${BASE}/${item.nctId}?fields=${encodeURIComponent(DETAIL_FIELDS)}`, { signal });
  const proto = json.protocolSection || {};
  const phases = proto.designModule?.phases || [];
  const facts = [
    ['Phase', phases.length ? phases.join(', ') : 'N/A'],
    ['Status', proto.statusModule?.overallStatus || '—'],
    ['Sponsor', proto.sponsorCollaboratorsModule?.leadSponsor?.name || '—'],
    ['Enrollment', Number.isFinite(proto.designModule?.enrollmentInfo?.count) ? String(proto.designModule.enrollmentInfo.count) : '—'],
    ['Conditions', (proto.conditionsModule?.conditions || []).join(', ') || '—'],
  ];
  return {
    title: proto.identificationModule?.briefTitle || item.title,
    subtitle: item.subtitle,
    summary: proto.descriptionModule?.briefSummary || '',
    facts,
    images: [],
    links: [{ label: 'View study on ClinicalTrials.gov', url: item.url }],
  };
}

export const trials = {
  id: 'trials',
  group: 'health',
  title: 'Clinical trials',
  description: 'Recruiting studies from ClinicalTrials.gov, one point per site.',
  source: { org: 'ClinicalTrials.gov (NIH / NLM)', domain: 'clinicaltrials.gov', homepage: 'https://clinicaltrials.gov/', license: 'Public domain (NIH)', trust: 'government' },
  render: 'points',
  approxBytes: 30000,
  refreshMs: 60 * 60 * 1000,
  filters: [
    { key: 'condition', type: 'text', label: 'Condition', default: '' },
    { key: 'maxSites', type: 'range', label: 'Max sites', min: 50, max: 500, step: 50, default: 500 },
  ],
  legend: [{ label: 'Recruiting site', color: '#5e5ce6', shape: 'dot' }],
  async load(filterValues = {}, { signal } = {}) {
    const params = new URLSearchParams({
      'filter.overallStatus': 'RECRUITING',
      pageSize: '100',
      fields: FIELDS,
    });
    if (filterValues.condition) params.set('query.cond', filterValues.condition);
    const json = await fetchJson(`${BASE}?${params.toString()}`, { signal });
    return normalize(json, filterValues);
  },
  details,
};
