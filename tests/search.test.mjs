/** THIS FILE DOES: Correctness + performance tests for SearchPanel's pure matching functions, ROLE: Automation, MAINTAINER NOTE: Fixed-seed PRNG keeps the synthetic perf corpus deterministic; real-shard queries assert lower bounds only, so they don't go brittle as the catalog grows. **/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildIndex, search, highlightRanges, buildHighlightFragment, fold, groupResults } from '../src/ui/SearchPanel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const budgets = JSON.parse(readFileSync(path.join(__dirname, 'budgets.json'), 'utf8'));
const GOALS = budgets.search;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function entity(overrides = {}) {
  return {
    id: 'pmid-1',
    title: 'A study of something',
    date: '2025-01-01',
    category: 'genomics',
    summary: 'A plain-language summary.',
    authors: ['A. Researcher'],
    authorsTruncated: false,
    journal: 'Some Journal',
    ids: { pmid: '1', doi: '10.1/x', pmcid: 'PMC1' },
    institution: { name: 'Some Institute', city: 'Somewhere', country: 'US', lat: 0, lng: 0 },
    sources: { pubmed: 'https://pubmed.ncbi.nlm.nih.gov/1/', archive: 'https://web.archive.org/web/2/x' },
    verified: { method: 'ncbi-esummary', date: '2026-01-01' },
    ...overrides,
  };
}

// ---------- correctness ----------

test('AND semantics: every term must match, in any field', () => {
  const idx = buildIndex([
    entity({ id: 'pmid-1', title: 'Gene editing for rare disease', summary: 'therapy in mice' }),
    entity({ id: 'pmid-2', title: 'Gene therapy trial', summary: 'editing not mentioned here' }),
    entity({ id: 'pmid-3', title: 'Unrelated cardiology study', summary: 'no overlap at all' }),
  ]);
  const results = search(idx, 'gene editing');
  const ids = results.map((r) => r.entity.id).sort();
  // AND is per-term-across-any-field, not per-field: pmid-1 has both terms in its title; pmid-2 has
  // "gene" in its title and "editing" in its summary, which still satisfies "every term matches
  // somewhere" -- only pmid-3, which has neither term anywhere, is excluded.
  assert.deepEqual(ids, ['pmid-1', 'pmid-2']);
});

test('diacritic folding: "sao paulo" matches "São Paulo"', () => {
  const idx = buildIndex([
    entity({ id: 'pmid-br', institution: { name: 'USP', city: 'São Paulo', country: 'BR', lat: -23.5, lng: -46.6 } }),
    entity({ id: 'pmid-other', institution: { name: 'MIT', city: 'Cambridge', country: 'US', lat: 42.4, lng: -71.1 } }),
  ]);
  const results = search(idx, 'sao paulo');
  assert.deepEqual(results.map((r) => r.entity.id), ['pmid-br']);
});

test('country-name match: "south africa" finds ZA entities via the English region name', () => {
  const idx = buildIndex([
    entity({ id: 'pmid-za', institution: { name: 'UCT', city: 'Cape Town', country: 'ZA', lat: -33.9, lng: 18.4 } }),
    entity({ id: 'pmid-us', institution: { name: 'MIT', city: 'Cambridge', country: 'US', lat: 42.4, lng: -71.1 } }),
  ]);
  const results = search(idx, 'south africa');
  assert.deepEqual(results.map((r) => r.entity.id), ['pmid-za']);
});

test('PMID exact match finds only that entity', () => {
  const idx = buildIndex([
    entity({ id: 'pmid-1', ids: { pmid: '39798579' } }),
    entity({ id: 'pmid-2', ids: { pmid: '12345678' } }),
  ]);
  const results = search(idx, '39798579');
  assert.deepEqual(results.map((r) => r.entity.id), ['pmid-1']);
});

test('title matches outrank other-field matches for the same term', () => {
  const idx = buildIndex([
    entity({ id: 'pmid-title', title: 'Lenacapavir prevents HIV' }),
    entity({ id: 'pmid-summary', title: 'Unrelated', summary: 'discusses lenacapavir briefly' }),
  ]);
  const results = search(idx, 'lenacapavir');
  assert.equal(results[0].entity.id, 'pmid-title');
});

test('highlightRanges finds folded matches and merges overlapping/touching ranges', () => {
  assert.deepEqual(highlightRanges('São Paulo research', ['sao', 'paulo']), [[0, 3], [4, 9]]);
  // "abcabc" contains "bca"@1-4 and "abc"@0-3 and @3-6; all three chain-overlap into one span.
  assert.deepEqual(highlightRanges('abcabc', ['bca', 'abc']), [[0, 6]]);
  assert.deepEqual(highlightRanges('nothing matches', ['zzz']), []);
});

test('buildHighlightFragment builds text nodes + <mark class="ph-hl"> with a fake document (no innerHTML)', () => {
  // Minimal fake DOM: just enough for buildHighlightFragment to exercise its node-building path.
  function makeNode(kind) {
    return {
      kind,
      className: '',
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      get textContent() {
        return this.kind === 'text' ? this.value : this.children.map((c) => c.textContent).join('');
      },
    };
  }
  const fakeDoc = {
    createDocumentFragment: () => makeNode('fragment'),
    createElement: (tag) => makeNode(tag),
    createTextNode: (v) => { const n = makeNode('text'); n.value = v; return n; },
  };
  const frag = buildHighlightFragment('gene editing works', [[5, 12]], fakeDoc);
  assert.equal(frag.children.length, 3);
  assert.equal(frag.children[0].kind, 'text');
  assert.equal(frag.children[0].value, 'gene ');
  assert.equal(frag.children[1].kind, 'mark');
  assert.equal(frag.children[1].className, 'ph-hl');
  assert.equal(frag.children[1].textContent, 'editing');
  assert.equal(frag.children[2].value, ' works');
  assert.equal(frag.textContent, 'gene editing works');
});

test('fold() is case- and diacritic-insensitive and length-stable for common Latin text', () => {
  assert.equal(fold('São Paulo'), 'sao paulo');
  assert.equal(fold('São Paulo').length, 'São Paulo'.length);
});

test('groupResults groups by category, truncates to perGroup, and orders groups by best score', () => {
  const idx = buildIndex([
    entity({ id: 'g1', title: 'trial trial trial one', category: 'genomics' }),
    entity({ id: 'g2', title: 'unrelated', summary: 'a trial happened', category: 'genomics' }),
    entity({ id: 'g3', title: 'unrelated', summary: 'a trial happened', category: 'genomics' }),
    entity({ id: 'g4', title: 'unrelated', summary: 'a trial happened', category: 'genomics' }),
    entity({ id: 'o1', title: 'trial trial', category: 'oncology' }),
  ]);
  const results = search(idx, 'trial');
  const groups = groupResults(results, { perGroup: 3 });

  assert.equal(groups.length, 2, 'one group per distinct category present in the results');
  const genomics = groups.find((g) => g.id === 'genomics');
  const oncology = groups.find((g) => g.id === 'oncology');
  assert.equal(genomics.count, 4);
  assert.equal(genomics.shown.length, 3, 'shown is capped at perGroup even though count is higher');
  assert.equal(oncology.count, 1);
  assert.equal(oncology.shown.length, 1);
  // Groups are ordered by best (i.e. first, since results arrive pre-sorted) score, descending.
  assert.ok(groups[0].bestScore >= groups[1].bestScore);
  // Every result in a group actually belongs to that category (title match doesn't leak groups).
  for (const g of groups) for (const r of g.results) assert.equal(r.entity.category, g.id);
});

test('groupResults defaults perGroup to 3 and never drops a result from `results`', () => {
  const idx = buildIndex([
    entity({ id: 'p1', title: 'protein study one', category: 'oncology' }),
    entity({ id: 'p2', title: 'protein study two', category: 'oncology' }),
    entity({ id: 'p3', title: 'protein study three', category: 'oncology' }),
    entity({ id: 'p4', title: 'protein study four', category: 'oncology' }),
  ]);
  const results = search(idx, 'protein');
  const groups = groupResults(results);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shown.length, 3);
  assert.equal(groups[0].results.length, 4, 'the full set is kept for "Show all" to reveal');
});

// ---------- performance: synthetic corpus ----------

const TOPICS = ['genomics', 'oncology', 'neuroscience', 'infectious disease', 'immunology', 'cardiometabolic', 'regenerative medicine', 'public health', 'ai in medicine', 'rare disease'];
const CITIES = [
  ['Cambridge', 'US'], ['São Paulo', 'BR'], ['Cape Town', 'ZA'], ['Paris', 'FR'], ['Tokyo', 'JP'],
  ['Berlin', 'DE'], ['Nairobi', 'KE'], ['Mumbai', 'IN'], ['Toronto', 'CA'], ['Zürich', 'CH'],
];
const WORDS = ['trial', 'therapy', 'vaccine', 'biomarker', 'protein', 'variant', 'cohort', 'outcome', 'placebo', 'genome', 'lenacapavir', 'crispr'];

function makeSyntheticEntities(n, seed = 7) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const topic = TOPICS[Math.floor(rnd() * TOPICS.length)];
    const [city, country] = CITIES[Math.floor(rnd() * CITIES.length)];
    const w1 = WORDS[Math.floor(rnd() * WORDS.length)];
    const w2 = WORDS[Math.floor(rnd() * WORDS.length)];
    const year = 2015 + Math.floor(rnd() * 10);
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    out.push(entity({
      id: `pmid-${10000000 + i}`,
      title: `Synthetic ${w1} study ${i} on ${topic}: a ${w2} analysis`,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      category: topic === 'ai in medicine' ? 'ai-in-medicine' : topic.replace(/ /g, '-'),
      summary: `A synthetic ${w2} summary discussing ${topic} and ${w1} in entity ${i}.`,
      authors: [`Author${i % 500} Researcher`],
      journal: `Synthetic Journal ${i % 40}`,
      ids: { pmid: String(10000000 + i), doi: `10.1/${i}`, pmcid: `PMC${i}` },
      institution: { name: `Synthetic Institute ${i % 200}`, city, country, lat: (rnd() * 180) - 90, lng: (rnd() * 360) - 180 },
    }));
  }
  return out;
}

function percentile(sortedAsc, p) {
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

test(`search stays within queryP95MsMax over ${GOALS.syntheticEntities} synthetic entities`, () => {
  const entities = makeSyntheticEntities(GOALS.syntheticEntities);
  const idx = buildIndex(entities);

  const queryRnd = mulberry32(99);
  const queries = [];
  for (let i = 0; i < 200; i++) {
    const kind = Math.floor(queryRnd() * 5);
    if (kind === 0) queries.push(WORDS[Math.floor(queryRnd() * WORDS.length)]);
    else if (kind === 1) queries.push(`${WORDS[Math.floor(queryRnd() * WORDS.length)]} ${WORDS[Math.floor(queryRnd() * WORDS.length)]}`);
    else if (kind === 2) queries.push(CITIES[Math.floor(queryRnd() * CITIES.length)][1].toLowerCase());
    else if (kind === 3) queries.push(String(10000000 + Math.floor(queryRnd() * GOALS.syntheticEntities)));
    else queries.push(TOPICS[Math.floor(queryRnd() * TOPICS.length)]);
  }

  // Warm up (JIT + megamorphic shape settling) before timing, same discipline as engine.test.mjs.
  for (const q of queries.slice(0, 20)) search(idx, q);

  // Best p95 of 3 rounds: `node --test` runs every test file in parallel, so a single round can be
  // inflated by other suites competing for the CPU. A genuine regression still fails all 3 rounds.
  let p95 = Infinity;
  for (let round = 0; round < 3; round++) {
    const timings = [];
    for (const q of queries) {
      const t0 = performance.now();
      search(idx, q);
      timings.push(performance.now() - t0);
    }
    timings.sort((a, b) => a - b);
    p95 = Math.min(p95, percentile(timings, 0.95));
  }
  assert.ok(p95 <= GOALS.queryP95MsMax, `p95 ${p95.toFixed(3)}ms exceeds budget ${GOALS.queryP95MsMax}ms`);
});

// ---------- real shards ----------

function loadRealEntities() {
  const shardsDir = path.join(__dirname, '..', 'data', 'shards');
  const entities = [];
  for (const year of readdirSync(shardsDir)) {
    const shardPath = path.join(shardsDir, year, 'research_pubmed.json');
    try {
      const json = JSON.parse(readFileSync(shardPath, 'utf8'));
      if (Array.isArray(json.entities)) entities.push(...json.entities);
    } catch { /* not a year directory (e.g. manifest.json) or unreadable; skip */ }
  }
  return entities;
}

test('real shards: "lenacapavir", "gene editing" and "brazil" return sensible hit counts', () => {
  const entities = loadRealEntities();
  assert.ok(entities.length > 0, 'expected real shard entities to load');
  const idx = buildIndex(entities);

  const lena = search(idx, 'lenacapavir');
  assert.ok(lena.length >= 2, `expected at least 2 lenacapavir hits, got ${lena.length}`);

  const gene = search(idx, 'gene editing');
  assert.ok(gene.length >= 3, `expected at least 3 gene-editing hits, got ${gene.length}`);

  const brazil = search(idx, 'brazil');
  assert.ok(brazil.length >= 2, `expected at least 2 brazil hits (BR institutions), got ${brazil.length}`);
  for (const r of brazil) assert.equal(r.entity.institution.country, 'BR');
});
