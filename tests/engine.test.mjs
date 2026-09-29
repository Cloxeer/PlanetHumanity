/** THIS FILE DOES: Unit + perf-budget tests for SpatialStore and ChronologyEngine using 10k synthetic entities, ROLE: Automation, MAINTAINER NOTE: Fixed-seed PRNG keeps runs deterministic; warm up before timing and read engine goals from budgets.json, never hardcode. **/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { SpatialStore, CATEGORIES, parseUtcDate } from '../src/core/SpatialStore.js';
import { ChronologyEngine } from '../src/core/ChronologyEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const budgets = JSON.parse(readFileSync(path.join(__dirname, 'budgets.json'), 'utf8'));
const GOALS = budgets.engine;

// mulberry32 fixed-seed PRNG for deterministic synthetic data.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSyntheticEntities(n, seed = 42) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const year = 2015 + Math.floor(rnd() * 10);
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pmid = String(10000000 + i);
    const cat = CATEGORIES[Math.floor(rnd() * CATEGORIES.length)];
    out.push({
      id: `pmid-${pmid}`,
      title: `Synthetic study number ${i} on ${cat}`,
      date,
      category: cat,
      summary: `Synthetic plain-language summary for entity ${i}, generated for deterministic engine performance testing purposes.`,
      authors: ['A. Researcher'],
      authorsTruncated: false,
      journal: 'Synthetic Journal',
      ids: { pmid },
      institution: { name: 'Synthetic Institute', city: 'Testville', country: 'US', lat: (rnd() * 180) - 90, lng: (rnd() * 360) - 180 },
      sources: { pubmed: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, archive: `https://web.archive.org/web/2/https://pubmed.ncbi.nlm.nih.gov/${pmid}/` },
      verified: { method: 'ncbi-esummary', date: '2026-01-01' },
    });
  }
  return out;
}

function percentile(sortedAsc, p) {
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

function makeFakeClock() {
  let t = 0;
  let queue = [];
  return {
    now: () => t,
    raf: (fn) => { queue.push(fn); return queue.length; },
    caf: (id) => { queue[id - 1] = null; },
    tick: (deltaMs) => {
      t += deltaMs;
      const due = queue; queue = [];
      for (const fn of due) if (fn) fn();
    },
  };
}

// ---------- SpatialStore unit tests ----------

test('SpatialStore: drops entities missing id/date/lat/lng and records errors', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 1, lng: 2 } },
    { id: 'pmid-2', date: '2020-01-01' }, // missing institution
    { date: '2020-01-01', institution: { lat: 1, lng: 2 } }, // missing id
  ]);
  assert.equal(store.size, 1);
  assert.equal(store.errors.length, 2);
});

test('SpatialStore: dedupes by id (first wins) and sorts by date asc', () => {
  const store = new SpatialStore([
    { id: 'pmid-2', date: '2021-05-01', institution: { lat: 0, lng: 0 }, category: 'genomics', tag: 'first' },
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2021-05-01', institution: { lat: 0, lng: 0 }, category: 'genomics', tag: 'second' },
  ]);
  assert.equal(store.size, 2);
  assert.equal(store.all()[0].id, 'pmid-1');
  assert.equal(store.all()[1].tag, 'first');
});

test('SpatialStore: freezes entities and the all() array', () => {
  const store = new SpatialStore([{ id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' }]);
  assert.ok(Object.isFrozen(store.all()));
  assert.ok(Object.isFrozen(store.all()[0]));
});

test('SpatialStore: categoryCodes maps unknown category to 255', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2020-01-02', institution: { lat: 0, lng: 0 }, category: 'not-a-real-category' },
  ]);
  const codes = store.categoryCodes();
  assert.equal(codes[0], CATEGORIES.indexOf('genomics'));
  assert.equal(codes[1], 255);
});

test('SpatialStore: byCategory and categoryCounts', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2020-01-02', institution: { lat: 0, lng: 0 }, category: 'oncology' },
  ]);
  assert.equal(store.byCategory('genomics').length, 1);
  const counts = store.categoryCounts();
  assert.equal(counts.find((c) => c.id === 'genomics').count, 1);
  assert.equal(counts.find((c) => c.id === 'oncology').count, 1);
});

test('parseUtcDate: valid and invalid inputs', () => {
  assert.equal(parseUtcDate('2020-01-01'), Date.UTC(2020, 0, 1));
  assert.ok(Number.isNaN(parseUtcDate('not-a-date')));
  assert.ok(Number.isNaN(parseUtcDate(undefined)));
});

// ---------- ChronologyEngine unit tests ----------

test('ChronologyEngine: domain and initial cursor at max', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2021-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  assert.equal(engine.domain.min, Date.UTC(2020, 0, 1));
  assert.equal(engine.domain.max, Date.UTC(2021, 0, 1));
  assert.equal(engine.cursor, engine.domain.max);
  assert.equal(engine.visible().length, 2);
});

test('ChronologyEngine: setCursor clamps and filters cumulatively', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2021-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setCursor(Date.UTC(2020, 5, 1));
  assert.equal(engine.visible().length, 1);
  engine.setCursor(Date.UTC(3000, 0, 1));
  assert.equal(engine.cursor, engine.domain.max);
});

test('ChronologyEngine: setCursor no-op when upperIndex/filter unchanged does not emit', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2021-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setCursor(Date.UTC(2020, 6, 1));
  let emits = 0;
  engine.on('change', () => emits++);
  engine.setCursor(Date.UTC(2020, 7, 1)); // still upperIndex=1, no change
  assert.equal(emits, 0);
  engine.setCursor(Date.UTC(2021, 0, 1)); // upperIndex changes to 2
  assert.equal(emits, 1);
});

test('ChronologyEngine: setCategories filters visible and emits change', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2020-01-02', institution: { lat: 0, lng: 0 }, category: 'oncology' },
  ]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setCategories(new Set(['genomics']));
  assert.equal(engine.visible().length, 1);
  assert.equal(engine.visible()[0].category, 'genomics');
  engine.setCategories(null);
  assert.equal(engine.visible().length, 2);
});

test('ChronologyEngine: play/pause/toggle drives cursor via injected fake clock', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2020-12-31', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const clock = makeFakeClock();
  const engine = new ChronologyEngine(store, { durationMs: 1000, now: clock.now, raf: clock.raf, caf: clock.caf });
  let playFired = false, pauseFired = false;
  engine.on('play', () => { playFired = true; });
  engine.on('pause', () => { pauseFired = true; });
  engine.play();
  assert.ok(playFired);
  assert.equal(engine.playing, true);
  assert.equal(engine.cursor, engine.domain.min);
  clock.tick(1100); // exceed duration -> should reach max and auto-pause
  assert.equal(engine.playing, false);
  assert.ok(pauseFired);
  assert.equal(engine.cursor, engine.domain.max);
});

test('ChronologyEngine: pause stops autoplay before completion', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2020-12-31', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const clock = makeFakeClock();
  const engine = new ChronologyEngine(store, { durationMs: 1000, now: clock.now, raf: clock.raf, caf: clock.caf });
  engine.play();
  clock.tick(500);
  engine.pause();
  assert.equal(engine.playing, false);
  const cursorAtPause = engine.cursor;
  clock.tick(500);
  assert.equal(engine.cursor, cursorAtPause);
});

test('ChronologyEngine: destroy stops autoplay and clears listeners', () => {
  const store = new SpatialStore([{ id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' }]);
  const clock = makeFakeClock();
  const engine = new ChronologyEngine(store, { now: clock.now, raf: clock.raf, caf: clock.caf });
  engine.destroy();
  assert.equal(engine.playing, false);
});

// ---------- setRange (all/year/month) ----------

test('ChronologyEngine: setRange default is all, and switching modes recomputes visible + range getter', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2024-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2024-06-15', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-3', date: '2024-12-31', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-4', date: '2025-01-15', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  assert.equal(engine.range.mode, 'all');
  engine.setCursor(Date.UTC(2024, 5, 15)); // mid-2024
  assert.equal(engine.visible().length, 2); // cumulative: pmid-1, pmid-2

  engine.setRange('year'); // cursor's calendar year 2024, regardless of cursor position within it
  assert.equal(engine.range.mode, 'year');
  assert.equal(engine.visible().length, 3); // pmid-1, pmid-2, pmid-3 (all of 2024)

  engine.setRange('month');
  assert.equal(engine.visible().length, 1); // just June 2024 -> pmid-2

  engine.setRange('all');
  assert.equal(engine.visible().length, 2);
});

test('ChronologyEngine: setRange with unknown mode falls back to "all" deterministically', () => {
  const store = new SpatialStore([{ id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' }]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setRange('bogus');
  assert.equal(engine.range.mode, 'all');
});

test('ChronologyEngine: year mode boundary - Dec 31 vs Jan 1 UTC land in different years', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2024-12-31', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2025-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setRange('year');
  engine.setCursor(Date.UTC(2024, 11, 31, 23, 59, 59, 999));
  assert.equal(engine.visible().length, 1);
  assert.equal(engine.visible()[0].id, 'pmid-1');
  assert.equal(engine.range.start, Date.UTC(2024, 0, 1));
  assert.equal(engine.range.end, Date.UTC(2024, 11, 31, 23, 59, 59, 999));

  engine.setCursor(Date.UTC(2025, 0, 1, 0, 0, 0, 0));
  assert.equal(engine.visible().length, 1);
  assert.equal(engine.visible()[0].id, 'pmid-2');
  assert.equal(engine.range.start, Date.UTC(2025, 0, 1));
  assert.equal(engine.range.end, Date.UTC(2025, 11, 31, 23, 59, 59, 999));
});

test('ChronologyEngine: month mode boundary - Feb 2024 (leap year) includes Feb 29, excludes Mar 1', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2024-02-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2024-02-29', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-3', date: '2024-03-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setRange('month');
  engine.setCursor(Date.UTC(2024, 1, 15)); // mid-February
  assert.equal(engine.visible().length, 2);
  assert.deepEqual(engine.visible().map((e) => e.id), ['pmid-1', 'pmid-2']);
  assert.equal(engine.range.start, Date.UTC(2024, 1, 1));
  assert.equal(engine.range.end, Date.UTC(2024, 2, 1) - 1); // last ms of Feb 29 23:59:59.999
});

test('ChronologyEngine: month mode boundary - non-leap Feb 2025 ends at the 28th', () => {
  const store = new SpatialStore([
    { id: 'pmid-1', date: '2025-02-28', institution: { lat: 0, lng: 0 }, category: 'genomics' },
    { id: 'pmid-2', date: '2025-03-01', institution: { lat: 0, lng: 0 }, category: 'genomics' },
  ]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setRange('month');
  engine.setCursor(Date.UTC(2025, 1, 28));
  assert.equal(engine.visible().length, 1);
  assert.equal(engine.visible()[0].id, 'pmid-1');
});

test('ChronologyEngine: setRange is a no-op (no emit) when the mode does not change', () => {
  const store = new SpatialStore([{ id: 'pmid-1', date: '2020-01-01', institution: { lat: 0, lng: 0 }, category: 'genomics' }]);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  let emits = 0;
  engine.on('change', () => emits++);
  engine.setRange('all'); // already 'all'
  assert.equal(emits, 0);
  engine.setRange('year');
  assert.equal(emits, 1);
});

// ---------- performance budgets (10k synthetic entities) ----------

test(`perf: indexBuild p95 under ${GOALS.indexBuildMsMax}ms for ${GOALS.syntheticEntities} entities`, () => {
  const raw = makeSyntheticEntities(GOALS.syntheticEntities);
  // warm up
  for (let i = 0; i < 3; i++) new SpatialStore(raw);
  const samples = [];
  const runs = 10;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    new SpatialStore(raw);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p95 = percentile(samples, 0.95);
  assert.ok(p95 < GOALS.indexBuildMsMax, `indexBuild p95=${p95}ms exceeds ${GOALS.indexBuildMsMax}ms`);
});

test(`perf: scrub (setCursor) p95/max under budget over ${GOALS.scrubSamples} samples`, () => {
  const raw = makeSyntheticEntities(GOALS.syntheticEntities);
  const store = new SpatialStore(raw);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  const { min, max } = engine.domain;
  const rnd = mulberry32(7);
  const cursors = Array.from({ length: GOALS.scrubSamples }, () => min + rnd() * (max - min));

  // warm up
  for (let i = 0; i < 200; i++) engine.setCursor(cursors[i % cursors.length]);

  const samples = [];
  for (const t of cursors) {
    const t0 = performance.now();
    engine.setCursor(t);
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  const max95 = sorted[sorted.length - 1];
  assert.ok(p95 < GOALS.scrubP95MsMax, `scrub p95=${p95}ms exceeds ${GOALS.scrubP95MsMax}ms`);
  assert.ok(max95 < GOALS.scrubMaxMsMax, `scrub max=${max95}ms exceeds ${GOALS.scrubMaxMsMax}ms`);
});

test(`perf: category toggle under ${GOALS.categoryToggleMsMax}ms`, () => {
  const raw = makeSyntheticEntities(GOALS.syntheticEntities);
  const store = new SpatialStore(raw);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setCursor(engine.domain.max);

  // warm up
  engine.setCategories(new Set(['genomics']));
  engine.setCategories(null);

  const filters = [new Set(['genomics']), new Set(['oncology', 'neuroscience']), null];
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const f = filters[i % filters.length];
    const t0 = performance.now();
    engine.setCategories(f);
    samples.push(performance.now() - t0);
  }
  sortedMax(samples, GOALS.categoryToggleMsMax);
});

test(`perf: setRange mode switch under ${GOALS.categoryToggleMsMax}ms for ${GOALS.syntheticEntities} entities`, () => {
  const raw = makeSyntheticEntities(GOALS.syntheticEntities);
  const store = new SpatialStore(raw);
  const engine = new ChronologyEngine(store, { now: () => 0 });
  engine.setCursor(engine.domain.max);

  // warm up
  engine.setRange('year'); engine.setRange('month'); engine.setRange('all');

  const modes = ['year', 'month', 'all'];
  const samples = [];
  for (let i = 0; i < 60; i++) {
    const m = modes[i % modes.length];
    const t0 = performance.now();
    engine.setRange(m);
    samples.push(performance.now() - t0);
  }
  sortedMax(samples, GOALS.categoryToggleMsMax);
});

function sortedMax(samples, budgetMs) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  assert.ok(p95 < budgetMs, `category toggle p95=${p95}ms exceeds ${budgetMs}ms`);
}
