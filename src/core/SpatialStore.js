/** THIS FILE DOES: Loads/normalizes entity shards into typed-array-indexed spatial+temporal storage, ROLE: Engine, MAINTAINER NOTE: Keep browser+Node compatible, no DOM APIs here. **/

export const CATEGORIES = [
  'genomics', 'oncology', 'neuroscience', 'infectious-disease', 'immunology',
  'cardiometabolic', 'regenerative-medicine', 'public-health', 'ai-in-medicine', 'rare-disease',
];

const CATEGORY_CODE = new Map(CATEGORIES.map((c, i) => [c, i]));
const UNKNOWN_CATEGORY_CODE = 255;

export function parseUtcDate(s) {
  if (typeof s !== 'string') return NaN;
  const m = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.exec(s);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export class SpatialStore {
  // Fetches manifest then all shards in parallel; malformed/failed shard entries are skipped and recorded, never thrown (manifest failure is the sole throw path).
  static async load(manifestUrl, { fetchImpl = fetch, signal } = {}) {
    const manifestRes = await fetchImpl(manifestUrl, { signal });
    if (!manifestRes.ok) throw new Error(`manifest fetch failed: ${manifestRes.status}`);
    const manifest = await manifestRes.json();
    const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
    const shardNames = Array.isArray(manifest.shards) ? manifest.shards : [];
    const errors = [];
    const results = await Promise.allSettled(shardNames.map(async (name) => {
      const res = await fetchImpl(base + name, { signal });
      if (!res.ok) throw new Error(`shard fetch failed: ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.entities)) throw new Error('malformed shard: no entities array');
      return json.entities;
    }));
    const entities = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') entities.push(...r.value);
      else errors.push({ shard: shardNames[i], message: String(r.reason?.message || r.reason) });
    });
    return new SpatialStore(entities, errors);
  }

  constructor(entities, errors = []) {
    this.errors = [...errors];
    const seen = new Map();
    for (const e of entities || []) {
      if (!e || !e.id || !e.date || !e.institution || typeof e.institution.lat !== 'number' || typeof e.institution.lng !== 'number') {
        this.errors.push({ shard: null, message: `dropped entity missing id/date/lat/lng: ${e?.id ?? '(no id)'}` });
        continue;
      }
      const t = parseUtcDate(e.date);
      if (Number.isNaN(t)) {
        this.errors.push({ shard: null, message: `dropped entity with invalid date: ${e.id}` });
        continue;
      }
      if (!seen.has(e.id)) seen.set(e.id, { e, t }); // dedupe by id, first wins; cache parsed time once
    }
    const pairs = [...seen.values()];
    pairs.sort((a, b) => (a.t !== b.t ? a.t - b.t : (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0)));

    const n = pairs.length;
    const arr = new Array(n);
    const times = new Float64Array(n);
    const codes = new Uint8Array(n);
    this._byId = new Map();
    const byCat = new Map(CATEGORIES.map((c) => [c, []]));
    for (let i = 0; i < n; i++) {
      const e = pairs[i].e;
      Object.freeze(e);
      arr[i] = e;
      times[i] = pairs[i].t;
      const code = CATEGORY_CODE.has(e.category) ? CATEGORY_CODE.get(e.category) : UNKNOWN_CATEGORY_CODE;
      codes[i] = code;
      this._byId.set(e.id, e);
      if (byCat.has(e.category)) byCat.get(e.category).push(e);
    }
    this._all = Object.freeze(arr);
    this._times = times;
    this._codes = codes;
    this._byCategory = new Map();
    for (const [cat, list] of byCat) this._byCategory.set(cat, Object.freeze(list));
  }

  get size() { return this._all.length; }
  all() { return this._all; }
  times() { return this._times; }
  categoryCodes() { return this._codes; }
  byId(id) { return this._byId.get(id); }
  byCategory(cat) { return this._byCategory.get(cat) ?? Object.freeze([]); }
  categoryCounts() {
    return CATEGORIES.map((id) => ({ id, count: this._byCategory.get(id)?.length ?? 0 }));
  }
}
