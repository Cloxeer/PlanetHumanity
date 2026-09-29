/** THIS FILE DOES: Drag-to-resize / drag-to-dismiss gesture for mobile bottom sheets, ROLE: UI, MAINTAINER NOTE: Only active <=640px (matchMedia, re-checked live); drag position is written as an inline transform, which always beats the CSS class transform used for the open/closed states, so no visual fight between the two. Callers just add/remove the 'open' class as before - this module infers open/closed from that class via a MutationObserver instead of exposing its own open()/close(). **/

const MOBILE_QUERY = '(max-width: 640px)';
const DRAG_START_PX = 4; // ignore tiny jitter before committing to a drag vs. a tap/scroll
const CLOSE_HEIGHT_RATIO = 0.25; // dragged down past this fraction of the sheet's own height -> close
const CLOSE_VELOCITY_PX_MS = 0.5; // flung down faster than this -> close regardless of distance
const VELOCITY_WINDOW_MS = 80;

export function attachSheetGesture(sheetEl, { handleEl, onClose, detents = [0.5, 0.92], startDetent = 'auto' } = {}) {
  const mq = matchMedia(MOBILE_QUERY);
  let active = mq.matches;

  const grabber = document.createElement('button');
  grabber.type = 'button';
  grabber.className = 'sheet-grabber';
  grabber.setAttribute('aria-label', 'Expand sheet');
  const bar = document.createElement('span');
  bar.className = 'sheet-grabber-bar';
  bar.setAttribute('aria-hidden', 'true');
  grabber.appendChild(bar);
  sheetEl.prepend(grabber);

  const fullIndex = detents.length - 1;
  let detentIndex = 0;
  let sheetHeight = 0;
  let currentY = 0;
  let dragging = false; // a drag is actually underway (vs. just a pending pointerdown)
  let pending = null; // {x, y, fromHandle, id} while deciding whether a content-start drag is really a drag
  let samples = [];

  function measure() {
    sheetHeight = sheetEl.getBoundingClientRect().height;
  }

  function detentY(i) {
    return Math.max(0, sheetHeight - detents[i] * innerHeight);
  }

  function writeTransform(y, withTransition) {
    currentY = y;
    sheetEl.classList.toggle('sheet-dragging', !withTransition);
    sheetEl.style.transform = `translate3d(0, ${Math.max(0, y)}px, 0)`;
  }

  function settle(index) {
    detentIndex = Math.max(0, Math.min(index, fullIndex));
    sheetEl.classList.toggle('sheet-detent-full', detentIndex === fullIndex);
    measure();
    writeTransform(detentY(detentIndex), true);
    grabber.setAttribute('aria-label', detentIndex === fullIndex ? 'Collapse sheet' : 'Expand sheet');
  }

  // The sheet just became visible (caller added its own 'open' class, e.g. inspector.open):
  // pick the initial detent. Content taller than the smallest detent opens straight to full,
  // so nothing important starts hidden under the fold.
  function onOpened() {
    sheetEl.classList.add('sheet-detent-full'); // measure at max potential height first
    const fullHeight = sheetEl.scrollHeight;
    sheetEl.classList.remove('sheet-detent-full');
    // 'half' is for control sheets (Layers) whose effect must stay visible on the globe above them.
    const startIndex = startDetent === 'half' ? 0 : startDetent === 'full' ? fullIndex : fullHeight > detents[0] * innerHeight ? fullIndex : 0;
    settle(startIndex);
  }

  function onClosed() {
    sheetEl.classList.remove('sheet-dragging', 'sheet-detent-full');
    sheetEl.style.transform = '';
  }

  function isOpen() {
    return sheetEl.classList.contains('open');
  }

  let wasOpen = isOpen();
  const observer = new MutationObserver(() => {
    const open = isOpen();
    if (open === wasOpen) return;
    wasOpen = open;
    if (!active) return; // desktop: the caller's own CSS/JS positioning owns the transform, not us
    if (open) onOpened(); else onClosed();
  });
  observer.observe(sheetEl, { attributes: true, attributeFilter: ['class'] });
  if (wasOpen && active) onOpened();

  function sampleVelocity() {
    const now = performance.now();
    samples.push({ t: now, y: pending.lastY });
    while (samples.length > 1 && now - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
    if (samples.length < 2) return 0;
    const first = samples[0], last = samples[samples.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? (last.y - first.y) / dt : 0;
  }

  function beginDrag(e) {
    dragging = true;
    measure();
    pending.startTranslate = currentY;
    try { sheetEl.setPointerCapture?.(e.pointerId); } catch { /* synthetic/test pointers have no capture session */ }
  }

  function onPointerMove(e) {
    if (!pending || e.pointerId !== pending.id) return;
    const dy = e.clientY - pending.y;
    pending.lastY = e.clientY;
    if (!dragging) {
      if (Math.abs(dy) < DRAG_START_PX) return;
      // Content can only start a drag when scrolled to the top and pulling down; the
      // handle/header has no such restriction and drags both up (expand) and down (collapse/close).
      if (!pending.fromHandle && (sheetEl.scrollTop > 0 || dy < 0)) { pending = null; return; }
      beginDrag(e);
    }
    e.preventDefault();
    writeTransform(pending.startTranslate + dy, false);
    sampleVelocity();
  }

  function onPointerUp(e) {
    if (!pending || e.pointerId !== pending.id) return;
    const wasDragging = dragging;
    const velocity = wasDragging ? sampleVelocity() : 0;
    const draggedDown = wasDragging ? currentY - pending.startTranslate : 0;
    dragging = false;
    pending = null;
    samples = [];
    sheetEl.removeEventListener('pointermove', onPointerMove);
    sheetEl.removeEventListener('pointerup', onPointerUp);
    sheetEl.removeEventListener('pointercancel', onPointerUp);
    if (!wasDragging) return;
    lastDragEndAt = performance.now();
    measure();
    const shouldClose = velocity > CLOSE_VELOCITY_PX_MS || draggedDown > sheetHeight * CLOSE_HEIGHT_RATIO;
    if (shouldClose) { onClose?.(); return; }
    // Snap to whichever detent the release position is nearest to.
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < detents.length; i++) {
      const d = Math.abs(currentY - detentY(i));
      if (d < bestDist) { bestDist = d; best = i; }
    }
    settle(best);
  }

  function onPointerDown(e) {
    if (!active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!isOpen()) return;
    const fromHandle = grabber.contains(e.target) || (handleEl && handleEl.contains(e.target));
    pending = { id: e.pointerId, x: e.clientX, y: e.clientY, lastY: e.clientY, fromHandle, startTranslate: 0 };
    samples = [{ t: performance.now(), y: e.clientY }];
    sheetEl.addEventListener('pointermove', onPointerMove);
    sheetEl.addEventListener('pointerup', onPointerUp);
    sheetEl.addEventListener('pointercancel', onPointerUp);
    // Movement threshold decides drag-vs-tap for BOTH handle and content starts, so a plain
    // tap on the grabber reaches the click handler below instead of being eaten as a zero-distance drag.
  }

  // Clicking (not dragging) the grabber toggles between the smallest and largest detent -
  // the keyboard-accessible equivalent of a drag, and also usable with touch taps. A click
  // synthesized right after a real drag is ignored via the timestamp guard.
  let lastDragEndAt = 0;
  grabber.addEventListener('click', () => {
    if (!active || performance.now() - lastDragEndAt < 50) return;
    settle(detentIndex === fullIndex ? 0 : fullIndex);
  });

  sheetEl.addEventListener('pointerdown', onPointerDown);

  function onMqChange(e) {
    active = e.matches;
    if (!active) onClosed(); // hand control back to the desktop CSS transform
    else if (isOpen()) onOpened();
  }
  mq.addEventListener('change', onMqChange);

  function destroy() {
    observer.disconnect();
    mq.removeEventListener('change', onMqChange);
    sheetEl.removeEventListener('pointerdown', onPointerDown);
    sheetEl.removeEventListener('pointermove', onPointerMove);
    sheetEl.removeEventListener('pointerup', onPointerUp);
    sheetEl.removeEventListener('pointercancel', onPointerUp);
    grabber.remove();
  }

  return { destroy };
}
