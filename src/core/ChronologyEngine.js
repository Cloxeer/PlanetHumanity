/** THIS FILE DOES: Drives the timeline cursor, time-range mode (all/year/month), category filter and autoplay over a SpatialStore, ROLE: Engine, MAINTAINER NOTE: visible() must stay cheap - only recompute on (lo, hi, filter) change; keep DOM-free for Node tests. All three range modes funnel through rangeIndices(start,end): 'all' is just [domainMin, cursor], so the existing cheap no-op path (unchanged bounds -> no emit) covers every mode for free. **/

import { CATEGORIES } from './SpatialStore.js';

const CATEGORY_INDEX = new Map(CATEGORIES.map((c, i) => [c, i]));

export class ChronologyEngine {
  constructor(store, { durationMs = 20000, raf = globalThis.requestAnimationFrame?.bind(globalThis), caf = globalThis.cancelAnimationFrame?.bind(globalThis), now = () => performance.now() } = {}) {
    this._store = store;
    this._times = store.times();
    this._codes = store.categoryCodes();
    this._all = store.all();
    this._durationMs = durationMs;
    this._raf = raf;
    this._caf = caf;
    this._now = now;

    const n = this._times.length;
    this._domainMin = n ? this._times[0] : 0;
    this._domainMax = n ? this._times[n - 1] : 0;
    this._cursor = this._domainMax;
    this._filter = null; // null = all categories; else Set of category ids
    this._rangeMode = 'all'; // 'all' | 'year' | 'month'
    this._playing = false;
    this._rafHandle = null;
    this._playStartT = 0;
    this._playStartCursor = 0;

    this._range = this._computeRange(this._rangeMode, this._cursor);
    [this._lo, this._hi] = this.rangeIndices(this._range.start, this._range.end);
    this._visible = this._computeVisibleRange(this._lo, this._hi);
    this._listeners = new Map([['change', new Set()], ['cursor', new Set()], ['play', new Set()], ['pause', new Set()]]);
  }

  get domain() { return { min: this._domainMin, max: this._domainMax }; }
  get cursor() { return this._cursor; }
  get playing() { return this._playing; }
  get range() { return this._range; }

  // Binary search: count of entities with time <= t.
  upperIndex(t) {
    const times = this._times;
    let lo = 0, hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // [lo, hi) of entities with t0 <= time <= t1.
  rangeIndices(t0, t1) {
    const times = this._times;
    let lo = 0, hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] < t0) lo = mid + 1; else hi = mid;
    }
    let lo2 = lo, hi2 = times.length;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2) >>> 1;
      if (times[mid] <= t1) lo2 = mid + 1; else hi2 = mid;
    }
    return [lo, hi2];
  }

  // Derives the active [start,end] window from the range mode + a cursor. 'all' keeps today's
  // cumulative behavior (start pinned at domainMin); 'year'/'month' use the cursor's own calendar
  // period regardless of where in it the cursor sits. Always UTC - never locale Date parsing.
  _computeRange(mode, cursor) {
    if (mode === 'year') {
      const y = new Date(cursor).getUTCFullYear();
      return { mode, start: Date.UTC(y, 0, 1, 0, 0, 0, 0), end: Date.UTC(y, 11, 31, 23, 59, 59, 999) };
    }
    if (mode === 'month') {
      const d = new Date(cursor);
      const y = d.getUTCFullYear(), m = d.getUTCMonth();
      return { mode, start: Date.UTC(y, m, 1, 0, 0, 0, 0), end: Date.UTC(y, m + 1, 1, 0, 0, 0, 0) - 1 };
    }
    return { mode: 'all', start: this._domainMin, end: cursor };
  }

  _computeVisibleRange(lo, hi) {
    if (this._filter === null) return Object.freeze(this._all.slice(lo, hi));
    const filterCodes = this._filter;
    const out = [];
    const codes = this._codes;
    const all = this._all;
    for (let i = lo; i < hi; i++) {
      if (filterCodes.has(codes[i])) out.push(all[i]);
    }
    return Object.freeze(out);
  }

  setCursor(t) {
    const clamped = Math.min(this._domainMax, Math.max(this._domainMin, t));
    const moved = clamped !== this._cursor;
    this._cursor = clamped;
    // 'cursor' fires on every move, even when the visible set is unchanged (e.g. anywhere inside the
    // same Year/Month period): the timeline thumb must follow the cursor, not just the data.
    if (moved) this._emit('cursor', { cursor: clamped });
    const range = this._computeRange(this._rangeMode, clamped);
    const [lo, hi] = this.rangeIndices(range.start, range.end);
    this._range = range;
    if (lo === this._lo && hi === this._hi) return; // cheap no-op path: same [lo,hi), filter unchanged here
    this._lo = lo; this._hi = hi;
    this._visible = this._computeVisibleRange(lo, hi);
    this._emit('change', { cursor: this._cursor, visible: this._visible, count: this._visible.length, range: this._range });
  }

  // 'all' | 'year' | 'month'. Unknown input is a deterministic fail-safe -> 'all' (never throws, never blocks).
  setRange(mode) {
    const next = (mode === 'year' || mode === 'month') ? mode : 'all';
    if (next === this._rangeMode) return;
    this._rangeMode = next;
    const range = this._computeRange(next, this._cursor);
    const [lo, hi] = this.rangeIndices(range.start, range.end);
    this._range = range; this._lo = lo; this._hi = hi;
    this._visible = this._computeVisibleRange(lo, hi);
    this._emit('change', { cursor: this._cursor, visible: this._visible, count: this._visible.length, range: this._range });
  }

  setCategories(setOrNull) {
    const next = setOrNull === null ? null : new Set([...setOrNull].map((c) => CATEGORY_INDEX.get(c)).filter((v) => v !== undefined));
    const prevKey = this._filter === null ? null : [...this._filter].sort().join(',');
    const nextKey = next === null ? null : [...next].sort().join(',');
    if (prevKey === nextKey) return;
    this._filter = next;
    this._visible = this._computeVisibleRange(this._lo, this._hi);
    this._emit('change', { cursor: this._cursor, visible: this._visible, count: this._visible.length, range: this._range });
  }

  visible() { return this._visible; }

  play() {
    if (this._playing) return;
    if (this._cursor >= this._domainMax) this.setCursor(this._domainMin);
    this._playing = true;
    this._playStartT = this._now();
    this._playStartCursor = this._cursor;
    const step = () => {
      if (!this._playing) return;
      const elapsed = this._now() - this._playStartT;
      const span = this._domainMax - this._domainMin;
      const frac = span > 0 ? elapsed / this._durationMs : 1;
      const t = this._playStartCursor + frac * span;
      if (t >= this._domainMax) {
        this.setCursor(this._domainMax);
        this._playing = false;
        this._rafHandle = null;
        this._emit('pause', undefined);
        return;
      }
      this.setCursor(t);
      this._rafHandle = this._raf(step);
    };
    this._rafHandle = this._raf(step);
    this._emit('play', undefined);
  }

  pause() {
    if (!this._playing) return;
    this._playing = false;
    if (this._rafHandle !== null) { this._caf?.(this._rafHandle); this._rafHandle = null; }
    this._emit('pause', undefined);
  }

  toggle() { this._playing ? this.pause() : this.play(); }

  on(evt, fn) {
    const set = this._listeners.get(evt);
    if (!set) throw new Error(`unknown event: ${evt}`);
    set.add(fn);
    return () => set.delete(fn);
  }

  _emit(evt, payload) {
    for (const fn of this._listeners.get(evt)) fn(payload);
  }

  destroy() {
    if (this._rafHandle !== null) { this._caf?.(this._rafHandle); this._rafHandle = null; }
    this._playing = false;
    for (const set of this._listeners.values()) set.clear();
  }
}
