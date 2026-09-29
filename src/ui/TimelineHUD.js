/** THIS FILE DOES: Editor-style bottom timeline (canvas track + DOM liquid-glass thumb) driving engine.setCursor/setRange, ROLE: UI, MAINTAINER NOTE: Pointer/keyboard handlers only call engine.setCursor/setRange and schedule one rAF redraw; nothing in this module may change any element's size/width/hidden state as a function of the cursor or mode (that was the root cause of the reported far-right jitter: a toggled "Now" pill changed the track's flex width, which changed the pointer->time mapping, which retoggled the pill). The end labels are fixed-width buttons (CSS min-width/tabular-nums) whose text may change with mode/period but whose box never does; time<->x mapping is a pure function of trackWrap width + the constant THUMB_W + the current view domain (viewDomain(): the full data domain in All-time, the cursor's calendar year/month in Year/Month mode, so that period fills the track), insetting the usable range so the thumb can never overflow either end. **/
import { CATEGORY_META } from './categories.js';
import { parseUtcDate } from '../core/SpatialStore.js';

const SNAP_PX = 6; // hover-only preview snap; press/drag never snaps (that was the other jitter contributor)
const DRAG_THRESHOLD_PX = 3; // pointer must move this far before we call it a drag (vs. a click/tap)
const THUMB_W = 22;
const DEFAULT_COLOR = '#8E8E93';
const fmtDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const fmtMonthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtMonthShort = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const RANGE_MODES = [['all', 'All time'], ['year', 'Year'], ['month', 'Month']];

export function createTimelineHUD(container, engine, { store }) {
  const { min, max } = engine.domain;
  const span = Math.max(1, max - min);

  const all = store.all();
  const times = store.times();
  const codes = store.categoryCodes();
  const catList = Object.keys(CATEGORY_META);

  const wrap = document.createElement('div');
  wrap.className = 'hud timeline-hud';

  const row = document.createElement('div');
  row.className = 'timeline-row';

  // Segmented range control: fixed width (its label text never changes), so switching modes
  // cannot itself perturb the track's layout - same jitter-proofing rule as the jump buttons below.
  const rangeSeg = document.createElement('div');
  rangeSeg.className = 'segmented range-segmented';
  rangeSeg.setAttribute('role', 'group');
  rangeSeg.setAttribute('aria-label', 'Time range');
  const rangeButtons = new Map();
  for (const [mode, label] of RANGE_MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(mode === 'all'));
    b.addEventListener('click', () => setRangeMode(mode));
    rangeSeg.appendChild(b);
    rangeButtons.set(mode, b);
  }

  // Fixed-width end buttons. In All-time mode they jump to the data domain's start/end; in
  // Year/Month mode they become period-nav buttons ("‹ 2024" / "2026 ›"). Their CSS box
  // (min-width/tabular-nums) never changes even though the text does - see updateEndButtons().
  const oldestBtn = document.createElement('button');
  oldestBtn.type = 'button';
  oldestBtn.className = 'timeline-date timeline-date-oldest';

  const newestBtn = document.createElement('button');
  newestBtn.type = 'button';
  newestBtn.className = 'timeline-date timeline-date-newest';

  const trackWrap = document.createElement('div');
  trackWrap.className = 'timeline-track-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'timeline-canvas';
  const ctx = canvas.getContext('2d');

  const track = document.createElement('div');
  track.className = 'timeline-track';
  track.setAttribute('role', 'slider');
  track.tabIndex = 0;
  track.setAttribute('aria-valuemin', String(min));
  track.setAttribute('aria-valuemax', String(max));
  track.setAttribute('aria-label', 'Timeline');

  const hoverLine = document.createElement('div');
  hoverLine.className = 'timeline-hover-line';
  hoverLine.hidden = true;
  const hoverTip = document.createElement('div');
  hoverTip.className = 'timeline-tooltip';
  hoverTip.hidden = true;

  // Liquid-glass thumb: a plain DOM rect, positioned/scaled purely via transform (never layout).
  const thumb = document.createElement('div');
  thumb.className = 'timeline-thumb';
  const bubble = document.createElement('div');
  bubble.className = 'timeline-bubble';

  trackWrap.append(canvas, hoverLine, hoverTip, thumb, bubble);
  track.appendChild(trackWrap);

  row.append(rangeSeg, oldestBtn, track, newestBtn);
  wrap.appendChild(row);
  container.replaceChildren(wrap);

  // Publish the HUD's real footprint (distance from its top edge to the viewport bottom) as
  // --hud-clearance so the globe controls and mobile cards sit above it at ANY width. Fixed pixel
  // offsets broke every time the HUD grew a row. The HUD's height never depends on the cursor.
  const publishClearance = () => document.documentElement.style.setProperty('--hud-clearance', `${Math.ceil(innerHeight - wrap.getBoundingClientRect().top)}px`);
  const hudRO = new ResizeObserver(publishClearance);
  hudRO.observe(wrap);
  addEventListener('resize', publishClearance);

  // --- category pool times (per-category, sorted asc) for cheap hidden-category detection ---
  const catTimes = new Map(catList.map((c) => [c, store.byCategory(c).map((e) => parseUtcDate(e.date))]));
  function poolCount(catId, t) {
    const arr = catTimes.get(catId);
    if (!arr || !arr.length) return 0;
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }

  let cursor = engine.cursor;
  let visibleCount = engine.visible().length;
  let currentRange = engine.range;
  let hidden = new Set();

  function setRangeMode(mode) {
    engine.setRange(mode); // engine emits 'change' synchronously, updating currentRange below
    for (const [m, b] of rangeButtons) b.setAttribute('aria-pressed', String(m === mode));
    updateEndButtons();
    triggerCrossfade();
  }

  function bubbleText() {
    if (currentRange.mode === 'year') {
      const y = new Date(currentRange.start).getUTCFullYear();
      return `${y} · ${visibleCount} paper${visibleCount === 1 ? '' : 's'}`;
    }
    if (currentRange.mode === 'month') {
      return `${fmtMonthYear.format(currentRange.start)} · ${visibleCount} paper${visibleCount === 1 ? '' : 's'}`;
    }
    return `${fmtDate.format(cursor)} · ${visibleCount} paper${visibleCount === 1 ? '' : 's'}`;
  }

  function recomputeHidden(visible) {
    const present = new Set();
    for (const e of visible) present.add(e.category);
    const next = new Set();
    for (const c of catList) {
      if (poolCount(c, cursor) > 0 && !present.has(c)) next.add(c);
    }
    hidden = next;
  }

  let raf = 0;
  function scheduleDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  // The active view domain: 'all' spans the whole data domain (unchanged behavior). Year/Month zoom
  // the view to the calendar period containing the cursor, so that period fills the entire track
  // width - the whole point of this mode. timeToX/xToTime are the ONLY two functions that read this,
  // so canvas ticks/bars, paper bars and the thumb/pointer mapping automatically stay in lockstep.
  function viewDomain() {
    if (currentRange.mode === 'all') return { vMin: min, vMax: max };
    return { vMin: currentRange.start, vMax: currentRange.end };
  }

  // Inset time<->x mapping: the usable pixel range is [THUMB_W/2, width-THUMB_W/2], a function
  // only of the track's own width, the constant thumb size and the current view domain - never of
  // drag state. Canvas ticks/bars and the thumb/pointer share this exact mapping, so they always agree.
  function timeToX(t, width) {
    const { vMin, vMax } = viewDomain();
    const vSpan = Math.max(1, vMax - vMin);
    const usable = Math.max(1, width - THUMB_W);
    return THUMB_W / 2 + ((t - vMin) / vSpan) * usable;
  }
  function xToTime(x, width) {
    const { vMin, vMax } = viewDomain();
    const vSpan = Math.max(1, vMax - vMin);
    const usable = Math.max(1, width - THUMB_W);
    const clamped = Math.max(0, Math.min(usable, x - THUMB_W / 2));
    return vMin + (clamped / usable) * vSpan;
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = trackWrap.clientWidth || 1;
    const h = trackWrap.clientHeight || 44;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scheduleDraw();
  }

  // Canvas ticks are a pure function of the current view domain (see timeToX above): in All-time
  // mode they mark years/months as before; in Year mode they mark the twelve months of the active
  // year ("Jan" … "Dec"); in Month mode they mark the days of the active month, with a full-height
  // rule + label roughly every 7 days ("1" … "31").
  function drawTicks(w, h, hairline, text) {
    ctx.strokeStyle = hairline;
    ctx.fillStyle = text;
    ctx.font = '10px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    ctx.lineWidth = 1;

    if (currentRange.mode === 'all') {
      const minYear = new Date(min).getUTCFullYear();
      const maxYear = new Date(max).getUTCFullYear();
      for (let y = minYear; y <= maxYear; y++) {
        const t = Date.UTC(y, 0, 1);
        if (t < min || t > max) continue;
        const x = timeToX(t, w);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.fillText(String(y), x + 4, 11);
        for (let m = 1; m < 12; m++) {
          const mt = Date.UTC(y, m, 1);
          if (mt < min || mt > max) continue;
          const mx = timeToX(mt, w);
          ctx.beginPath(); ctx.moveTo(mx, h - 6); ctx.lineTo(mx, h); ctx.stroke();
        }
      }
      return;
    }

    if (currentRange.mode === 'year') {
      const y = new Date(currentRange.start).getUTCFullYear();
      for (let m = 0; m < 12; m++) {
        const mt = Date.UTC(y, m, 1);
        const x = timeToX(mt, w);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.fillText(fmtMonthShort.format(mt), x + 4, 11);
      }
      return;
    }

    // month: a tick per day, a full-height rule + label roughly every 7 days
    const d0 = new Date(currentRange.start);
    const y = d0.getUTCFullYear();
    const m = d0.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const t = Date.UTC(y, m, day);
      const x = timeToX(t, w);
      const isWeekMark = day === 1 || (day - 1) % 7 === 0;
      ctx.beginPath(); ctx.moveTo(x, isWeekMark ? 0 : h - 6); ctx.lineTo(x, h); ctx.stroke();
      if (isWeekMark) ctx.fillText(String(day), x + 4, 11);
    }
  }

  function draw() {
    const w = trackWrap.clientWidth || 1;
    const h = trackWrap.clientHeight || 44;
    ctx.clearRect(0, 0, w, h);
    const styles = getComputedStyle(wrap);
    const hairline = styles.getPropertyValue('--hairline').trim() || 'rgba(128,128,128,.3)';
    const accent = styles.getPropertyValue('--accent').trim() || '#0071E3';
    const text = styles.getPropertyValue('--text-dim').trim() || '#888';

    const cx = timeToX(cursor, w);
    if (currentRange.mode === 'all') {
      // elapsed tint: everything up to the cursor has already been "revealed"
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(0, 0, cx, h);
      ctx.globalAlpha = 1;
    }
    // Year/Month: the view domain IS the active period now, so it already fills the whole track -
    // there is no separate band left to shade (that used to be a partial highlight on the full-domain
    // track; now the period itself is the track). Only the cursor position matters, via the thumb.

    drawTicks(w, h, hairline, text);

    // paper bars
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const x = timeToX(t, w);
      if (x < -4 || x > w + 4) continue; // off-canvas in the current view domain - skip the draw call
      const code = codes[i];
      const catId = catList[code] ?? null;
      const color = catId ? (CATEGORY_META[catId]?.color ?? DEFAULT_COLOR) : DEFAULT_COLOR;
      const isHidden = catId && hidden.has(catId);
      // In 'all' mode, dim anything after the cursor (not yet revealed). In Year/Month mode the
      // reveal concept doesn't apply - dim anything outside the active period instead (mostly moot
      // now that the period fills the track, but guards the exact boundary instants).
      const isFuture = currentRange.mode === 'all' && t > cursor;
      const isOutOfRange = currentRange.mode !== 'all' && (t < currentRange.start || t > currentRange.end);
      ctx.globalAlpha = (isHidden || isFuture || isOutOfRange) ? 0.25 : 1;
      ctx.fillStyle = color;
      ctx.fillRect(x - 1.5, h * 0.3, 3, h * 0.5);
    }
    ctx.globalAlpha = 1;

    updateThumb(cx, w);
  }

  function updateThumb(cx, w) {
    const scale = pressed ? 1.18 : 1;
    thumb.style.transform = `translate3d(${cx - THUMB_W / 2}px,0,0) scale(${scale})`;
    bubble.textContent = bubbleText();
    placeFloat(bubble, cx, w, 0);
  }

  function setCursorAndSchedule(t) {
    engine.setCursor(t);
    scheduleDraw();
  }

  function updateAria() {
    track.setAttribute('aria-valuenow', String(Math.round(cursor)));
    track.setAttribute('aria-valuetext', `${fmtDate.format(cursor)} — ${visibleCount} papers visible`);
  }

  // Mirrors ChronologyEngine's own _computeRange for a hypothetical cursor, so the nav buttons and
  // PageUp/PageDown can preview/target a period's bounds without reaching into engine internals.
  function periodBoundsFor(mode, t) {
    if (mode === 'year') {
      const y = new Date(t).getUTCFullYear();
      return { start: Date.UTC(y, 0, 1, 0, 0, 0, 0), end: Date.UTC(y, 11, 31, 23, 59, 59, 999) };
    }
    const d = new Date(t);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    return { start: Date.UTC(y, m, 1, 0, 0, 0, 0), end: Date.UTC(y, m + 1, 1, 0, 0, 0, 0) - 1 };
  }

  // Period navigation is clamped to the years/months actually present in the data domain - the
  // buttons disable rather than jump into an all-empty period past either end.
  function isPeriodNavDisabled(dir) {
    const mode = currentRange.mode;
    if (mode === 'year') {
      const curYear = new Date(currentRange.start).getUTCFullYear();
      const minYear = new Date(min).getUTCFullYear();
      const maxYear = new Date(max).getUTCFullYear();
      return dir < 0 ? curYear <= minYear : curYear >= maxYear;
    }
    if (mode === 'month') {
      const key = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
      const curKey = key(currentRange.start);
      return dir < 0 ? curKey <= key(min) : curKey >= key(max);
    }
    return true;
  }

  function jumpPeriod(dir) {
    const mode = currentRange.mode;
    if (mode !== 'year' && mode !== 'month') return;
    if (isPeriodNavDisabled(dir)) return;
    const curStart = currentRange.start;
    const curSpan = Math.max(1, currentRange.end - curStart);
    const frac = Math.min(1, Math.max(0, (cursor - curStart) / curSpan));
    const anchor = mode === 'year' ? addUtcYears(cursor, dir) : addUtcMonths(cursor, dir);
    const next = periodBoundsFor(mode, anchor);
    let target = next.start + frac * (next.end - next.start);
    // Keep the cursor's relative position in the new period, unless that lands past the last paper
    // in it (e.g. jumping from late December into a mostly-empty January) - then land on that paper.
    const hiIdx = engine.upperIndex(Math.min(next.end, max));
    const lastPaperInPeriod = hiIdx > 0 ? times[hiIdx - 1] : -Infinity;
    if (lastPaperInPeriod >= next.start && target > lastPaperInPeriod) target = lastPaperInPeriod;
    triggerCrossfade();
    jumpTo(Math.min(max, Math.max(min, target)));
  }

  // Fixed-width period-nav buttons in Year/Month mode (replacing the old static start/end labels
  // there); only their text/disabled state change, never their box (min-width/tabular-nums in
  // styles.css), so switching period can't itself perturb the track's layout.
  function updateEndButtons() {
    const mode = currentRange.mode;
    if (mode === 'all') {
      oldestBtn.textContent = fmtDate.format(min);
      oldestBtn.setAttribute('aria-label', `Jump to start: ${fmtDate.format(min)}`);
      oldestBtn.disabled = false;
      newestBtn.textContent = fmtDate.format(max);
      newestBtn.setAttribute('aria-label', `Jump to latest: ${fmtDate.format(max)}`);
      newestBtn.disabled = false;
      return;
    }
    if (mode === 'year') {
      const y = new Date(currentRange.start).getUTCFullYear();
      oldestBtn.textContent = `‹ ${y - 1}`;
      newestBtn.textContent = `${y + 1} ›`;
      oldestBtn.setAttribute('aria-label', `Previous year: ${y - 1}`);
      newestBtn.setAttribute('aria-label', `Next year: ${y + 1}`);
    } else {
      const prevLabel = fmtMonthShort.format(addUtcMonths(currentRange.start, -1));
      const nextLabel = fmtMonthShort.format(addUtcMonths(currentRange.start, 1));
      oldestBtn.textContent = `‹ ${prevLabel}`;
      newestBtn.textContent = `${nextLabel} ›`;
      oldestBtn.setAttribute('aria-label', `Previous month: ${prevLabel}`);
      newestBtn.setAttribute('aria-label', `Next month: ${nextLabel}`);
    }
    oldestBtn.disabled = isPeriodNavDisabled(-1);
    newestBtn.disabled = isPeriodNavDisabled(1);
  }

  // Quick opacity-only crossfade on mode switches and period jumps (see the reduced-motion rules in
  // styles.css). Only ever touches the canvas's own opacity via a CSS animation class - never width
  // or layout. Removing then re-adding the class forces a reflow so the animation replays each time.
  function triggerCrossfade() {
    canvas.classList.remove('timeline-crossfade');
    void canvas.offsetWidth;
    canvas.classList.add('timeline-crossfade');
  }

  let pressed = false; // pointer is down (drives the lens-lift scale)
  let dragging = false; // pointer has moved past the threshold (drives the no-transition 1:1 follow)
  let downX = 0;

  function handlePointerDown(e) {
    performance.mark('ph:scrub-start');
    try { track.setPointerCapture(e.pointerId); } catch { /* synthetic/test pointer events have no capture session */ }
    pressed = true;
    dragging = false;
    thumb.classList.add('pressed');
    thumb.classList.remove('dragging');
    hoverLine.hidden = true;
    hoverTip.hidden = true;
    const rect = trackWrap.getBoundingClientRect();
    downX = e.clientX - rect.left;
    const t = xToTime(downX, rect.width);
    cursor = t;
    setCursorAndSchedule(t);
    updateAria();
    performance.mark('ph:scrub-end');
    performance.measure('ph:scrub', 'ph:scrub-start', 'ph:scrub-end');
  }

  function handlePointerMove(e) {
    const rect = trackWrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (pressed) {
      if (!dragging && Math.abs(x - downX) >= DRAG_THRESHOLD_PX) {
        dragging = true;
        thumb.classList.add('dragging'); // removes the transition so the thumb follows 1:1
      }
      performance.mark('ph:scrub-start');
      const t = xToTime(x, rect.width); // no snapping: pointer x maps linearly to time, always
      cursor = t;
      setCursorAndSchedule(t);
      updateAria();
      performance.mark('ph:scrub-end');
      performance.measure('ph:scrub', 'ph:scrub-start', 'ph:scrub-end');
      return;
    }
    // hover preview: does not move the cursor, hidden entirely while pressed/dragging
    if (x < 0 || x > rect.width) { hoverLine.hidden = true; hoverTip.hidden = true; return; }
    const t = xToTime(x, rect.width);
    hoverLine.hidden = false;
    hoverLine.style.transform = `translate3d(${x}px,0,0)`;
    let label = fmtDate.format(t);
    const idx = engine.upperIndex(t);
    const near = [];
    if (idx < times.length && Math.abs(timeToX(times[idx], rect.width) - x) < SNAP_PX) near.push(idx);
    if (idx > 0 && Math.abs(timeToX(times[idx - 1], rect.width) - x) < SNAP_PX) near.push(idx - 1);
    if (near.length) {
      const e0 = all[near[0]];
      label += ` · ${near.length} paper${near.length > 1 ? 's' : ''} · ${e0.title.slice(0, 60)}`;
    }
    hoverTip.hidden = false;
    hoverTip.textContent = label;
    placeFloat(hoverTip, x, rect.width, 0);
  }

  // Centre a floating label on x but keep it fully inside the track; transform-only, no reflow.
  function placeFloat(el, x, w) {
    const bw = el.offsetWidth;
    const left = Math.max(0, Math.min(x - bw / 2, w - bw));
    el.style.transform = `translate3d(${left}px,0,0)`;
  }

  function handlePointerUp(e) {
    pressed = false;
    dragging = false;
    thumb.classList.remove('pressed', 'dragging');
    try { track.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    scheduleDraw(); // settle the lens-lift scale back to 1 with the 220ms transition
  }

  function handlePointerLeave() {
    if (!pressed) { hoverLine.hidden = true; hoverTip.hidden = true; }
  }

  function stepToNearestPaper(dir) {
    const idx = engine.upperIndex(cursor);
    let target;
    if (dir > 0) target = idx < times.length ? times[idx] : max;
    else target = idx > 0 ? times[idx - 1] : min;
    if (target === cursor) {
      // already sitting on a paper date; move to the next distinct one
      let i = idx;
      if (dir > 0) { while (i < times.length && times[i] <= cursor) i++; target = i < times.length ? times[i] : max; }
      else { i = idx - 1; while (i >= 0 && times[i] >= cursor) i--; target = i >= 0 ? times[i] : min; }
    }
    return target;
  }

  function addUtcMonths(t, n) {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
  }

  function addUtcYears(t, n) {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate());
  }

  function jumpTo(t) {
    // A discrete jump (click/keyboard), not a drag: the thumb's default transition (220ms) applies.
    cursor = Math.min(max, Math.max(min, t));
    setCursorAndSchedule(cursor);
    updateAria();
  }

  function handleKeydown(e) {
    const mode = currentRange.mode;
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      if (mode === 'all') return; // All-time has no periods to page between
      e.preventDefault();
      jumpPeriod(e.key === 'PageUp' ? 1 : -1);
      return;
    }
    let t = null;
    if (e.key === 'ArrowLeft') {
      if (mode === 'year') t = addUtcYears(cursor, -1);
      else if (mode === 'month') t = addUtcMonths(cursor, -1);
      else t = e.shiftKey ? addUtcMonths(cursor, -1) : stepToNearestPaper(-1);
    } else if (e.key === 'ArrowRight') {
      if (mode === 'year') t = addUtcYears(cursor, 1);
      else if (mode === 'month') t = addUtcMonths(cursor, 1);
      else t = e.shiftKey ? addUtcMonths(cursor, 1) : stepToNearestPaper(1);
    }
    else if (e.key === 'Home') t = min;
    else if (e.key === 'End') t = max;
    if (t === null) return;
    e.preventDefault();
    performance.mark('ph:scrub-start');
    jumpTo(t);
    performance.mark('ph:scrub-end');
    performance.measure('ph:scrub', 'ph:scrub-start', 'ph:scrub-end');
  }

  track.addEventListener('pointerdown', handlePointerDown);
  track.addEventListener('pointermove', handlePointerMove);
  track.addEventListener('pointerup', handlePointerUp);
  track.addEventListener('pointercancel', handlePointerUp);
  track.addEventListener('pointerleave', handlePointerLeave);
  track.addEventListener('keydown', handleKeydown);
  oldestBtn.addEventListener('click', () => {
    if (currentRange.mode === 'all') jumpTo(min);
    else if (!oldestBtn.disabled) jumpPeriod(-1);
  });
  newestBtn.addEventListener('click', () => {
    if (currentRange.mode === 'all') jumpTo(max);
    else if (!newestBtn.disabled) jumpPeriod(1);
  });

  const ro = new ResizeObserver(resize);
  ro.observe(trackWrap);

  const offChange = engine.on('change', ({ cursor: c, visible, count, range }) => {
    cursor = c;
    visibleCount = count;
    currentRange = range ?? engine.range;
    recomputeHidden(visible);
    updateAria();
    updateEndButtons();
    scheduleDraw();
  });

  // Cursor moves that don't change the visible set (anywhere inside one Year/Month period) emit
  // only 'cursor', so the thumb, aria value and period buttons must follow that event too.
  const offCursor = engine.on('cursor', ({ cursor: c }) => {
    cursor = c;
    currentRange = engine.range;
    updateAria();
    updateEndButtons();
    scheduleDraw();
  });

  recomputeHidden(engine.visible());
  updateAria();
  updateEndButtons();
  resize();

  function destroy() {
    offChange();
    offCursor();
    ro.disconnect();
    hudRO.disconnect();
    removeEventListener('resize', publishClearance);
    if (raf) cancelAnimationFrame(raf);
    container.replaceChildren();
  }

  return { destroy };
}
