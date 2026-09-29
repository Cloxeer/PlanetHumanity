/** THIS FILE DOES: unit tests for every layer's trust metadata and normalize() against recorded fixtures, ROLE: Automation, MAINTAINER NOTE: network lives only in load(); everything here is pure, so it needs no live connection. **/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAYER_GROUPS, LAYERS } from '../src/layers/registry.js';
import { normalize as normalizeQuakes } from '../src/layers/quakes.js';
import { normalize as normalizeEonet, shortName, clampBbox, buildWorldviewUrl } from '../src/layers/eonet.js';
import { normalize as normalizeAurora } from '../src/layers/aurora.js';
import { normalize as normalizeOutbreaks } from '../src/layers/outbreaks.js';
import { normalize as normalizeTrials } from '../src/layers/trials.js';
import { normalize as normalizeWorldBank } from '../src/layers/worldbank.js';
import { normalize as normalizeIss } from '../src/layers/iss.js';
import { interpolateEci, eciToLatLngAlt } from '../src/layers/iss-propagate.js';
import { buildCountryIndex, resolveCountry, extractOutbreakLocation } from '../src/layers/country-geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, 'fixtures', 'layers');
const GEO = path.join(__dirname, '..', 'data', 'geo', 'countries-110m.geojson');

function fx(name) { return JSON.parse(readFileSync(path.join(FIX, `${name}.json`), 'utf8')); }
const geojson = JSON.parse(readFileSync(GEO, 'utf8'));
const countryIndex = buildCountryIndex(geojson);
const geoIso2Set = new Set(countryIndex.keys());

// ---------- Trust rule ----------
const GOV_SUFFIXES = ['nasa.gov', 'noaa.gov', 'usgs.gov', 'nih.gov', 'clinicaltrials.gov'];
const INTERGOV_DOMAINS = ['who.int', 'worldbank.org', 'eumetsat.int', 'esa.int'];

function isOfficialDomain(domain, trust) {
  if (typeof domain !== 'string') return false;
  if (trust === 'government') {
    return GOV_SUFFIXES.some((s) => domain === s || domain.endsWith(`.${s}`))
      || domain.endsWith('.gov') || /\.gov\.[a-z]{2,3}$/i.test(domain);
  }
  if (trust === 'intergovernmental') {
    return INTERGOV_DOMAINS.some((s) => domain === s || domain.endsWith(`.${s}`));
  }
  if (trust === 'academic') {
    return domain.endsWith('.edu') || /\.ac\.[a-z]{2,3}$/i.test(domain);
  }
  return false;
}

test('every layer belongs to a declared group', () => {
  const groupIds = new Set(LAYER_GROUPS.map((g) => g.id));
  for (const layer of LAYERS) assert.ok(groupIds.has(layer.group), `${layer.id}: unknown group "${layer.group}"`);
});

test('every layer source is official (trust rule)', () => {
  for (const layer of LAYERS) {
    const s = layer.source;
    assert.ok(s, `${layer.id}: missing source`);
    assert.ok(['government', 'intergovernmental', 'academic'].includes(s.trust), `${layer.id}: bad trust value "${s.trust}"`);
    assert.ok(s.org && s.homepage && s.license, `${layer.id}: source missing org/homepage/license`);
    assert.match(s.homepage, /^https:\/\//, `${layer.id}: homepage must be https`);
    assert.ok(isOfficialDomain(s.domain, s.trust), `${layer.id}: domain "${s.domain}" is not official for trust "${s.trust}"`);
  }
});

test('every layer has a load() function and render type', () => {
  const RENDERS = new Set(['base', 'points', 'texture', 'objects', 'country-fill', 'icons']);
  for (const layer of LAYERS) {
    assert.equal(typeof layer.load, 'function', `${layer.id}: load() missing`);
    assert.ok(RENDERS.has(layer.render), `${layer.id}: bad render "${layer.render}"`);
  }
});

// ---------- quakes ----------
test('quakes.normalize: fixture yields valid points', () => {
  const out = normalizeQuakes(fx('quakes'), { minMagnitude: 0 });
  assert.ok(out.items.length > 0);
  for (const it of out.items) {
    assert.ok(it.lat >= -90 && it.lat <= 90);
    assert.ok(it.lng >= -180 && it.lng <= 180);
    assert.ok(!Number.isNaN(it.lat) && !Number.isNaN(it.lng));
    assert.ok(it.id && it.title && it.color);
  }
});

test('quakes.normalize: minMagnitude filters', () => {
  const all = normalizeQuakes(fx('quakes'), { minMagnitude: 0 });
  const strict = normalizeQuakes(fx('quakes'), { minMagnitude: 5 });
  assert.ok(strict.items.length <= all.items.length);
});

// ---------- eonet ----------
test('eonet.normalize: fixture yields valid points', () => {
  const out = normalizeEonet(fx('eonet'), { days: 90 });
  assert.ok(out.items.length > 0);
  for (const it of out.items) {
    assert.ok(it.lat >= -90 && it.lat <= 90);
    assert.ok(it.lng >= -180 && it.lng <= 180);
    assert.ok(!Number.isNaN(it.lat) && !Number.isNaN(it.lng));
    assert.ok(it.id && it.title);
  }
});

test('eonet.normalize: every item gets an icon, and named-event categories keep their label + showLabel', () => {
  const out = normalizeEonet(fx('eonet'), { days: 90 });
  assert.ok(out.items.length > 0);
  for (const it of out.items) {
    assert.ok(it.icon && typeof it.icon === 'string', `${it.id}: missing icon`);
    assert.equal(typeof it.showLabel, 'boolean');
    assert.ok(it.label && typeof it.label === 'string');
    if (it.categoryId === 'severeStorms' || it.categoryId === 'volcanoes') {
      assert.equal(it.showLabel, true);
      assert.equal(it.label, it.title);
    }
  }
});

test('eonet.shortName: strips category boilerplate but keeps named-storm titles intact', () => {
  // Real EONET wildfire titles have no separator at all (verified live).
  assert.equal(shortName('Wildfire Merit Creek, Greene, Mississippi', 'wildfires'), 'Merit Creek, Greene, Mississippi');
  assert.equal(shortName('Prescribed Fire CRAWFORD CORRAL RX, Tulare, California', 'wildfires'), 'CRAWFORD CORRAL RX, Tulare, California');
  assert.equal(shortName('Wildfire - Palisades, California', 'wildfires'), 'Palisades, California');
  assert.equal(shortName('Hurricane Erin', 'severeStorms'), 'Hurricane Erin');
  assert.equal(shortName('Nevados del Chillan Volcano, Chile', 'volcanoes'), 'Nevados del Chillan Volcano, Chile');
  assert.equal(shortName('Landslide - Kerala, India', 'landslides'), 'Kerala, India');
});

test('eonet.clampBbox: clamps latitude to the poles and wraps longitude at the antimeridian', () => {
  const nearPole = clampBbox(89, 0);
  assert.equal(nearPole.north, 90);
  assert.ok(nearPole.south < 90);

  const southPole = clampBbox(-89, 0);
  assert.equal(southPole.south, -90);

  const wrapped = clampBbox(0, 179);
  assert.ok(wrapped.east < 0, `east should wrap past 180, got ${wrapped.east}`);
  assert.ok(wrapped.east >= -180 && wrapped.east <= 180);

  const wrappedNeg = clampBbox(0, -179);
  assert.ok(wrappedNeg.west > 0, `west should wrap past -180, got ${wrappedNeg.west}`);
  assert.ok(wrappedNeg.west >= -180 && wrappedNeg.west <= 180);
});

test('eonet.buildWorldviewUrl: one WRAP entry per comma-separated layer, valid bbox order', () => {
  const single = buildWorldviewUrl({ lat: 40, lng: -120, date: '2026-01-01', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor' });
  const u1 = new URL(single);
  assert.equal(u1.searchParams.get('WRAP'), 'x');
  assert.equal(u1.searchParams.get('WIDTH'), '640');

  const stacked = buildWorldviewUrl({ lat: 40, lng: -120, date: '2026-01-01', layer: 'A,B' });
  const u2 = new URL(stacked);
  assert.equal(u2.searchParams.get('WRAP'), 'x,x');

  // Lat-first axis order (south,west,north,east): lon-first gave NASA an invalid latitude -> black image.
  const [south, west, north, east] = u1.searchParams.get('BBOX').split(',').map(Number);
  assert.ok(west < east && south < north);
  assert.ok(Math.abs(south) <= 90 && Math.abs(north) <= 90);
  const far = new URL(buildWorldviewUrl({ lat: 31, lng: -88.8, date: '2026-01-01', layer: 'A' }));
  assert.deepEqual(far.searchParams.get('BBOX').split(',').map(Number), [28, -91.8, 34, -85.8]);
});

// ---------- aurora ----------
test('aurora.normalize: fixture yields valid cells + kp', () => {
  const out = normalizeAurora(fx('ovation'), fx('kp'));
  assert.ok(out.cells.length > 0);
  for (const c of out.cells) {
    assert.ok(c.lat >= -90 && c.lat <= 90);
    assert.ok(c.lng >= -180 && c.lng <= 180);
    assert.ok(c.v >= 0 && c.v <= 1);
  }
  assert.ok(Number.isFinite(out.extra.kp));
});

// ---------- outbreaks / WHO title parsing ----------
test('extractOutbreakLocation parses >=5 real WHO titles to a resolvable country', () => {
  const titles = fx('who-don').value.map((v) => v.Title);
  let resolved = 0;
  for (const title of titles) {
    const loc = extractOutbreakLocation(title);
    if (loc && resolveCountry(loc, countryIndex)) resolved++;
  }
  assert.ok(resolved >= 5, `only resolved ${resolved} of ${titles.length} titles`);
});

test('resolveCountry handles alias-table names', () => {
  assert.equal(resolveCountry('Democratic Republic of the Congo', countryIndex).iso2, 'CD');
  assert.equal(resolveCountry('United States of America', countryIndex).iso2, 'US');
  assert.equal(resolveCountry('Türkiye', countryIndex).iso2, 'TR');
});

test('outbreaks.normalize: multi-country/global titles are skipped and counted', () => {
  const out = normalizeOutbreaks(fx('who-don'), { months: 60 }, countryIndex);
  assert.ok(out.items.length > 0);
  assert.ok(out.skipped >= 0);
  for (const it of out.items) {
    assert.ok(it.lat >= -90 && it.lat <= 90);
    assert.ok(it.lng >= -180 && it.lng <= 180);
  }
});

// ---------- trials ----------
test('trials.normalize: fixture yields one point per site', () => {
  const out = normalizeTrials(fx('trials'), { maxSites: 500 });
  assert.ok(out.items.length > 0);
  for (const it of out.items) {
    assert.ok(it.lat >= -90 && it.lat <= 90);
    assert.ok(it.lng >= -180 && it.lng <= 180);
    assert.ok(it.url.startsWith('https://clinicaltrials.gov/study/'));
  }
});

// ---------- World Bank ----------
test('worldbank.normalize: drops aggregates, keeps only geojson iso2 codes', () => {
  const out = normalizeWorldBank(fx('worldbank'), geoIso2Set);
  assert.ok(out.values.size > 0);
  for (const iso2 of out.values.keys()) {
    assert.ok(geoIso2Set.has(iso2), `${iso2} should have been dropped as an aggregate`);
    assert.equal(iso2.length, 2);
  }
  assert.ok(out.min <= out.max);
});

// ---------- ISS propagation ----------
test('iss.normalize + propagation: known OEM sample gives plausible lat/lng and 380-450km altitude', () => {
  const records = normalizeIss(fx('iss-oem'));
  assert.ok(records.length >= 2);
  const t = records[0].t;
  const rec = interpolateEci(records, t);
  const { lat, lng, altKm } = eciToLatLngAlt(rec.r, t);
  assert.ok(lat >= -90 && lat <= 90);
  assert.ok(lng >= -180 && lng <= 180);
  assert.ok(altKm >= 380 && altKm <= 450, `altKm=${altKm} out of ISS range`);
});

test('iss propagation interpolates between two records without diverging', () => {
  const records = normalizeIss(fx('iss-oem'));
  const mid = (records[0].t + records[1].t) / 2;
  const rec = interpolateEci(records, mid);
  const { altKm } = eciToLatLngAlt(rec.r, mid);
  assert.ok(altKm >= 380 && altKm <= 450);
});
