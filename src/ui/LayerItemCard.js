/** THIS FILE DOES: Rich detail sheet for a clicked layer item (quake, EONET event, WHO outbreak, trial site, ISS) - immediate title/subtitle/trust badge, then a shimmer while the owning layer's details() loads in, photos, facts, summary and links, ROLE: UI, MAINTAINER NOTE: Unlike PointCard this anchors to a fixed screen point, not a moving marker element, so it positions once on open instead of running an rAF tracking loop; reuses PointCard's mobile mini-sheet pattern via SheetGesture for consistency. layerdetail.css is lazy-injected like refimage.css. **/
import { icon } from './icons.js';
import { attachSheetGesture } from './SheetGesture.js';
import { LAYERS } from '../layers/registry.js';

const MOBILE_MAX_WIDTH = 640;
const MARGIN = 12;
const CSS_HREF = 'src/ui/layerdetail.css';

const layersById = new Map(LAYERS.map((l) => [l.id, l]));

let cssPromise;
function loadStylesheet() {
  return cssPromise ??= new Promise((resolve) => {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.append(link);
  });
}

function isMobile() {
  return innerWidth <= MOBILE_MAX_WIDTH;
}

function relativeTime(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '';
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
    ['hour', 3600000], ['minute', 60000],
  ];
  for (const [unit, size] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      return diff >= 0 ? `${n} ${unit}${n === 1 ? '' : 's'} ago` : `in ${n} ${unit}${n === 1 ? '' : 's'}`;
    }
  }
  return 'just now';
}

function buildShimmer() {
  const wrap = document.createElement('div');
  wrap.className = 'ph-layer-detail-shimmer';
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.className = 'ph-layer-detail-shimmer-row';
    wrap.appendChild(row);
  }
  return wrap;
}

export function createLayerItemCard(root) {
  loadStylesheet();

  const card = document.createElement('div');
  card.className = 'ph-point-card ph-layer-item-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Selected layer item');
  card.hidden = true;
  // The stage already ignores non-canvas targets, but a pointerdown here must never bubble to
  // whatever globe/document listeners sit above it (drag-to-pan, outside-click handlers, etc).
  card.addEventListener('pointerdown', (e) => e.stopPropagation());

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ph-point-card-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(icon('close'));

  const head = document.createElement('div');
  head.className = 'ph-point-card-head layer-item-head';
  const trust = document.createElement('a');
  trust.className = 'layer-trust-badge';
  trust.target = '_blank';
  trust.rel = 'noopener noreferrer';
  head.append(trust);

  const title = document.createElement('h3');
  title.className = 'ph-point-card-title';

  const subtitle = document.createElement('div');
  subtitle.className = 'ph-point-card-meta layer-item-subtitle';

  const time = document.createElement('div');
  time.className = 'ph-point-card-meta layer-item-time';

  // Rich body: shimmer -> photos / facts / summary / links, filled in once details() resolves.
  const body = document.createElement('div');
  body.className = 'ph-layer-detail-body';
  body.hidden = true;

  const lightbox = document.createElement('div');
  lightbox.className = 'ph-layer-detail-lightbox';
  lightbox.hidden = true;
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-label', 'Photo, full size');
  const lightboxImg = document.createElement('img');
  lightboxImg.alt = '';
  lightbox.appendChild(lightboxImg);

  const linkRow = document.createElement('div');
  linkRow.className = 'ph-point-card-actions';
  const link = document.createElement('a');
  link.className = 'ph-point-card-zoom layer-item-link';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.appendChild(icon('external'));
  const linkLabel = document.createElement('span');
  linkLabel.textContent = 'View official record';
  link.appendChild(linkLabel);
  linkRow.appendChild(link);

  card.append(closeBtn, head, title, subtitle, time, body, lightbox, linkRow);
  root.appendChild(card);

  let current = null;
  let opener = null;
  let controller = null;

  function place(x, y) {
    card.classList.remove('ph-point-card-out');
    if (isMobile()) { card.style.transform = 'translate3d(0,0,0)'; return; }
    const rect = card.getBoundingClientRect();
    const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + MARGIN;
    const bottom = (document.querySelector('.hud')?.getBoundingClientRect().top ?? innerHeight) - MARGIN;
    let px = Math.max(MARGIN, Math.min(x + MARGIN, innerWidth - rect.width - MARGIN));
    let py = Math.max(top, Math.min(y - rect.height / 2, bottom - rect.height));
    card.style.transform = `translate3d(${px}px, ${py}px, 0)`;
  }

  function openLightbox(url, alt) {
    lightboxImg.src = url;
    lightboxImg.alt = alt || '';
    lightbox.hidden = false;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = '';
  }

  lightbox.addEventListener('click', closeLightbox);

  function buildPhotos(images) {
    if (!images?.length) return null;
    const strip = document.createElement('div');
    strip.className = 'ph-layer-detail-photos';
    for (const img of images) {
      if (!img?.url) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ph-layer-detail-photo';
      const el = document.createElement('img');
      el.loading = 'lazy';
      el.decoding = 'async';
      el.referrerPolicy = 'no-referrer';
      el.src = img.url;
      el.alt = img.caption || '';
      el.addEventListener('error', () => btn.remove(), { once: true });
      btn.appendChild(el);
      btn.addEventListener('click', () => openLightbox(img.url, img.caption));

      if (img.caption || img.credit) {
        const cap = document.createElement('p');
        cap.className = 'ph-layer-detail-photo-caption';
        if (img.credit && img.link) {
          const a = document.createElement('a');
          a.href = img.link;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = img.caption ? `${img.caption} — ${img.credit}` : img.credit;
          a.addEventListener('click', (e) => e.stopPropagation());
          cap.appendChild(a);
        } else {
          cap.textContent = [img.caption, img.credit].filter(Boolean).join(' — ');
        }
        btn.appendChild(cap);
      }
      strip.appendChild(btn);
    }
    return strip.childElementCount ? strip : null;
  }

  function buildFacts(facts) {
    if (!facts?.length) return null;
    const grid = document.createElement('div');
    grid.className = 'ph-layer-detail-facts';
    for (const [label, value] of facts) {
      if (value == null || value === '') continue;
      const cell = document.createElement('div');
      cell.className = 'ph-layer-detail-fact';
      const l = document.createElement('span');
      l.className = 'ph-layer-detail-fact-label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'ph-layer-detail-fact-value';
      v.textContent = String(value);
      cell.append(l, v);
      grid.appendChild(cell);
    }
    return grid.childElementCount ? grid : null;
  }

  function buildLinks(links) {
    if (!links?.length) return null;
    const list = document.createElement('div');
    list.className = 'ph-layer-detail-links';
    for (const l of links) {
      if (!l?.url) continue;
      const a = document.createElement('a');
      a.className = 'ph-layer-detail-link';
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = l.label || l.url;
      list.appendChild(a);
    }
    return list.childElementCount ? list : null;
  }

  function renderDetail(detail) {
    body.replaceChildren();
    const photos = buildPhotos(detail.images);
    if (photos) body.appendChild(photos);
    const facts = buildFacts(detail.facts);
    if (facts) body.appendChild(facts);
    if (detail.summary) {
      const p = document.createElement('p');
      p.className = 'ph-layer-detail-summary';
      p.textContent = detail.summary;
      body.appendChild(p);
    }
    const links = buildLinks(detail.links);
    if (links) body.appendChild(links);
    body.hidden = body.childElementCount === 0;
  }

  async function loadDetails(item) {
    const layer = item.layerId ? layersById.get(item.layerId) : null;
    if (!layer?.details) { body.hidden = true; return; }
    body.hidden = false;
    body.replaceChildren(buildShimmer());
    controller = new AbortController();
    try {
      const detail = await layer.details(item, { signal: controller.signal });
      if (current !== item) return; // sheet closed or moved on to another item meanwhile
      if (detail) renderDetail(detail); else body.hidden = true;
    } catch (err) {
      if (err?.name === 'AbortError' || current !== item) return;
      // Fail soft: the sheet still shows title/subtitle/official link without the rich body.
      console.warn('[LayerItemCard] details() failed', err);
      body.hidden = true;
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!lightbox.hidden) { closeLightbox(); return; }
      close();
    }
  }

  function onOutsideClick(e) {
    if (!card.contains(e.target)) close();
  }

  function open(item, pos = {}) {
    current = item;
    opener = document.activeElement;
    closeLightbox();
    controller?.abort();
    controller = null;
    trust.textContent = item.trustLabel ?? 'Official record';
    trust.href = item.url ?? '#';
    title.textContent = item.title ?? '';
    subtitle.textContent = item.subtitle ?? '';
    time.textContent = relativeTime(item.time);
    time.hidden = !item.time;
    link.href = item.url ?? '#';
    linkRow.hidden = !item.url;
    body.hidden = true;
    body.replaceChildren();
    card.hidden = false;
    card.classList.add('open');
    card.classList.add('ph-point-card-enter');
    requestAnimationFrame(() => card.classList.remove('ph-point-card-enter'));
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('pointerdown', onOutsideClick, true);
    if (!isMobile()) requestAnimationFrame(() => place(pos.x ?? innerWidth / 2, pos.y ?? innerHeight / 2));
    card.setAttribute('tabindex', '-1');
    card.focus();
    loadDetails(item);
  }

  function close() {
    if (!current) return;
    current = null;
    controller?.abort();
    controller = null;
    closeLightbox();
    card.hidden = true;
    card.classList.remove('open', 'ph-point-card-out');
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onOutsideClick, true);
    if (opener && typeof opener.focus === 'function') opener.focus();
    opener = null;
  }

  closeBtn.addEventListener('click', close);

  const sheetGesture = attachSheetGesture(card, { handleEl: head, onClose: close });

  function destroy() {
    close();
    sheetGesture.destroy();
    card.remove();
  }

  return { open, close, get isOpen() { return current !== null; }, destroy };
}
