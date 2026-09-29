/** THIS FILE DOES: Right-side glass sheet listing every catalogued paper from a clicked globe country, ROLE: UI, MAINTAINER NOTE: Lazy-imported from main.js on the first globe country click; shares FilterPanel's motion/focus-trap/a11y pattern. Only main.js calls stage.clearCountry() (on close, via the optional onClose hook) since this module never touches the globe stage directly. **/
import { CATEGORY_META } from './categories.js';
import { parseUtcDate } from '../core/SpatialStore.js';
import { flagImg } from './flags.js';
import { attachSheetGesture } from './SheetGesture.js';

export function createCountryPanel(root, { store, engine, onSelectPaper, onClose } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'country-backdrop';

  const panel = document.createElement('div');
  panel.className = 'country-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'country-title');

  const header = document.createElement('div');
  header.className = 'country-header';
  const heading = document.createElement('div');
  heading.className = 'country-heading';
  const flagEl = document.createElement('span');
  flagEl.className = 'country-flag';
  flagEl.setAttribute('aria-hidden', 'true');
  const titleWrap = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'country-title';
  title.id = 'country-title';
  const total = document.createElement('p');
  total.className = 'country-total';
  titleWrap.append(title, total);
  heading.append(flagEl, titleWrap);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';
  header.append(heading, closeBtn);

  const body = document.createElement('div');
  body.className = 'country-body';

  const footer = document.createElement('div');
  footer.className = 'country-footer';
  const footerLink = document.createElement('a');
  footerLink.target = '_blank';
  footerLink.rel = 'noopener noreferrer';
  footer.appendChild(footerLink);

  panel.append(header, body, footer);
  root.append(backdrop, panel);

  // Regional-indicator flag emoji from an ISO 3166-1 alpha-2 code; anything else renders no flag.
  function flagEmoji(iso2) {
    if (!iso2 || iso2.length !== 2) return '';
    const cc = iso2.toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...[...cc].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
  }

  let isOpen = false;
  let opener = null;
  let offChange = null;
  let current = null; // { iso2, name }

  function papersFor(iso2) {
    return store.all().filter((e) => e.institution?.country === iso2).slice().reverse(); // store is date-asc; panel wants newest first
  }

  function renderBreakdown(papers) {
    const counts = new Map();
    for (const e of papers) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    const bar = document.createElement('div');
    bar.className = 'country-breakdown';
    const legend = document.createElement('ul');
    legend.className = 'country-legend';
    const total_ = papers.length || 1;
    for (const [catId, count] of counts) {
      const meta = CATEGORY_META[catId];
      const seg = document.createElement('div');
      seg.className = 'country-breakdown-seg';
      seg.style.width = `${(count / total_) * 100}%`;
      seg.style.background = meta?.color ?? '#8E8E93';
      bar.appendChild(seg);
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = meta?.color ?? '#8E8E93';
      li.append(swatch, document.createTextNode(`${meta?.label ?? catId} (${count})`));
      legend.appendChild(li);
    }
    return { bar, legend };
  }

  function renderPapers(papers) {
    const list = document.createElement('ul');
    list.className = 'country-papers';
    const cursor = engine.cursor;
    for (const e of papers) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'country-paper';
      const isFuture = parseUtcDate(e.date) > cursor;
      btn.classList.toggle('future', isFuture);

      const meta = document.createElement('div');
      meta.className = 'country-paper-meta';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = CATEGORY_META[e.category]?.color ?? '#8E8E93';
      meta.append(document.createTextNode(e.date + ' '), swatch);

      const titleEl = document.createElement('p');
      titleEl.className = 'country-paper-title';
      titleEl.textContent = e.title;

      const instEl = document.createElement('p');
      instEl.className = 'country-paper-inst';
      instEl.textContent = e.institution?.name ?? '';

      btn.append(meta, titleEl, instEl);
      if (isFuture) {
        const note = document.createElement('p');
        note.className = 'country-paper-future-note';
        note.textContent = 'after current timeline date';
        btn.appendChild(note);
      }
      btn.addEventListener('click', () => onSelectPaper?.(e));
      li.appendChild(btn);
      list.appendChild(li);
    }
    return list;
  }

  function render() {
    if (!current) return;
    const { iso2, name } = current;
    const papers = papersFor(iso2);
    flagEl.replaceChildren();
    const img = flagImg(iso2, { w: 32, h: 24 });
    if (img) flagEl.appendChild(img); else flagEl.textContent = flagEmoji(iso2); // slow connection/unknown iso2: emoji fallback
    title.textContent = name;
    total.textContent = `${papers.length} paper${papers.length === 1 ? '' : 's'}`;
    body.replaceChildren();
    if (!papers.length) {
      const empty = document.createElement('p');
      empty.className = 'country-empty';
      empty.textContent = `No papers from ${name} in this catalog yet.`;
      body.appendChild(empty);
    } else {
      const { bar, legend } = renderBreakdown(papers);
      body.append(bar, legend, renderPapers(papers));
    }
    footerLink.textContent = `Search PubMed for research from ${name}`;
    footerLink.href = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(name)}%5BAffiliation%5D`;
  }

  function focusables() {
    return Array.from(panel.querySelectorAll('button, a[href]')).filter((el) => !el.hidden && !el.disabled);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const els = focusables();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function open({ iso2, name }) {
    current = { iso2, name };
    render();
    opener = document.activeElement;
    isOpen = true;
    backdrop.classList.add('open');
    panel.classList.add('open');
    document.addEventListener('keydown', onKeydown, true);
    // Live-update the "future" flags/note as the timeline is scrubbed while the panel is open.
    offChange?.();
    offChange = engine.on('change', () => render());
    closeBtn.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    backdrop.classList.remove('open');
    panel.classList.remove('open');
    document.removeEventListener('keydown', onKeydown, true);
    offChange?.();
    offChange = null;
    if (opener && typeof opener.focus === 'function') opener.focus();
    onClose?.();
  }

  function toggle() { isOpen ? close() : open(current ?? {}); }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  // Mobile-only: lets the sheet be dragged between half/full detents or down to dismiss.
  const sheetGesture = attachSheetGesture(panel, { handleEl: header, onClose: close });

  function destroy() {
    offChange?.();
    document.removeEventListener('keydown', onKeydown, true);
    sheetGesture.destroy();
    backdrop.remove();
    panel.remove();
  }

  return { open, close, toggle, get isOpen() { return isOpen; }, destroy };
}
