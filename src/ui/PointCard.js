/** THIS FILE DOES: Small glass "document" card anchored beside a globe marker, with Zoom in / Details actions, ROLE: UI, MAINTAINER NOTE: Position is read from anchorEl.getBoundingClientRect() once per rAF (one layout read), then written as a single translate3d - never read+write interleaved per frame. **/
import { icon } from './icons.js';
import { CATEGORY_META } from './categories.js';
import { flagImg } from './flags.js';
import { attachSheetGesture } from './SheetGesture.js';

const MOBILE_MAX_WIDTH = 640;
const MARGIN = 12;

export function createPointCard(root, { onZoom, onDetails } = {}) {
  const card = document.createElement('div');
  card.className = 'ph-point-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Selected paper');
  card.hidden = true;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ph-point-card-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(icon('close'));

  const imageSlot = document.createElement('div');
  imageSlot.className = 'ph-point-card-image';

  const head = document.createElement('div');
  head.className = 'ph-point-card-head';
  const swatch = document.createElement('span');
  swatch.className = 'ph-point-card-swatch';
  const catLabel = document.createElement('span');
  catLabel.className = 'ph-point-card-cat';
  head.append(swatch, catLabel);

  const title = document.createElement('h3');
  title.className = 'ph-point-card-title';

  const meta = document.createElement('div');
  meta.className = 'ph-point-card-meta';

  const inst = document.createElement('div');
  inst.className = 'ph-point-card-inst';

  const loc = document.createElement('div');
  loc.className = 'ph-point-card-loc';

  const actions = document.createElement('div');
  actions.className = 'ph-point-card-actions';
  const zoomBtn = document.createElement('button');
  zoomBtn.type = 'button';
  zoomBtn.className = 'ph-point-card-zoom';
  zoomBtn.appendChild(icon('zoom'));
  const zoomLabel = document.createElement('span');
  zoomLabel.textContent = 'Zoom in';
  zoomBtn.appendChild(zoomLabel);
  const detailsBtn = document.createElement('button');
  detailsBtn.type = 'button';
  detailsBtn.className = 'ph-point-card-details';
  detailsBtn.textContent = 'Details';
  actions.append(zoomBtn, detailsBtn);

  card.append(closeBtn, imageSlot, head, title, meta, inst, loc, actions);
  root.appendChild(card);

  let current = null;
  let anchorEl = null;
  let opener = null;
  let rafId = null;
  let flipped = false;
  let refImage = null;

  function isMobile() {
    return innerWidth <= MOBILE_MAX_WIDTH;
  }

  function render(entity) {
    const catMeta = CATEGORY_META?.[entity.category];
    swatch.style.background = catMeta?.color ?? '#8E8E93';
    catLabel.textContent = catMeta?.label ?? entity.category;
    title.textContent = entity.title;
    const dateLabel = typeof entity.date === 'string'
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${entity.date}T00:00:00Z`))
      : '';
    meta.textContent = [dateLabel, entity.journal].filter(Boolean).join(' · ');
    inst.textContent = entity.institution?.name ?? '';
    loc.replaceChildren();
    const img = flagImg(entity.institution?.country, { w: 16, h: 12 });
    if (img) loc.appendChild(img);
    loc.appendChild(document.createTextNode([entity.institution?.city, entity.institution?.country].filter(Boolean).join(', ')));
  }

  function place() {
    rafId = null;
    if (!current || !anchorEl || anchorEl.classList.contains('ph-hidden') || !anchorEl.isConnected) {
      card.classList.add('ph-point-card-out');
      return;
    }
    card.classList.remove('ph-point-card-out');
    const rect = anchorEl.getBoundingClientRect();
    if (isMobile()) {
      card.style.transform = 'translate3d(0,0,0)';
      return;
    }
    const cardRect = card.getBoundingClientRect();
    let x = rect.right + MARGIN;
    let y = rect.top - cardRect.height / 2 + rect.height / 2;
    const overflowsRight = x + cardRect.width > innerWidth - MARGIN;
    flipped = overflowsRight;
    if (overflowsRight) x = rect.left - MARGIN - cardRect.width;
    x = Math.max(MARGIN, Math.min(x, innerWidth - cardRect.width - MARGIN));
    // Keep clear of the nav bar and the timeline HUD, not just the window edges.
    const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + MARGIN;
    const bottom = (document.querySelector('.hud')?.getBoundingClientRect().top ?? innerHeight) - MARGIN;
    y = Math.max(top, Math.min(y, bottom - cardRect.height));
    card.classList.toggle('ph-point-card-flipped', flipped);
    card.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function loop() {
    place();
    if (current) rafId = requestAnimationFrame(loop);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function onOutsideClick(e) {
    if (!card.contains(e.target) && e.target !== anchorEl) close();
  }

  function open(entity, el) {
    current = entity;
    anchorEl = el;
    opener = document.activeElement;
    render(entity);
    refImage?.destroy();
    imageSlot.replaceChildren();
    import('./RefImage.js')
      .then((mod) => { if (current === entity) refImage = mod.mountRefImage(imageSlot, entity); })
      .catch(() => {}); // decorative: a failed dynamic import just leaves the frame empty
    card.hidden = false;
    card.classList.add('open'); // bookkeeping only (no CSS hooks this); lets SheetGesture know the mobile mini-sheet is showing
    card.classList.add('ph-point-card-enter');
    requestAnimationFrame(() => card.classList.remove('ph-point-card-enter'));
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('pointerdown', onOutsideClick, true);
    // On mobile the card is a fixed mini-sheet (SheetGesture owns its transform for drag), not
    // anchor-tracked, so skip the rAF placement loop there - it would otherwise fight the drag.
    if (!isMobile()) { place(); if (rafId === null) rafId = requestAnimationFrame(loop); }
    card.setAttribute('tabindex', '-1');
    card.focus();
  }

  function close() {
    if (!current) return;
    current = null;
    anchorEl = null;
    refImage?.destroy();
    refImage = null;
    imageSlot.replaceChildren();
    card.hidden = true;
    card.classList.remove('open', 'ph-point-card-flipped', 'ph-point-card-out');
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onOutsideClick, true);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (opener && typeof opener.focus === 'function') opener.focus();
    opener = null;
  }

  zoomBtn.addEventListener('click', () => { const e = current; if (e) onZoom?.(e); });
  detailsBtn.addEventListener('click', () => { const e = current; if (e) onDetails?.(e); });
  closeBtn.addEventListener('click', close);

  // Mobile-only: drag the mini-sheet between detents or down to dismiss (head area is the drag handle).
  const sheetGesture = attachSheetGesture(card, { handleEl: head, onClose: close });

  function destroy() {
    close();
    refImage?.destroy();
    sheetGesture.destroy();
    card.remove();
  }

  return { open, close, get isOpen() { return current !== null; }, destroy };
}
